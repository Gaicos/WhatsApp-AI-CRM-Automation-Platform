import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import {
  lerGrupos, salvarGrupos, lerAgendamentos, salvarAgendamentos, lerEnvios, lerHistorico,
  lerConfig, salvarConfig, lerContatos, salvarContatos, lerListasContatos, salvarListasContatos
} from "./services/configService.js";
import {
  garantirUsuarioPadrao, criarSessao, obterSessao, encerrarSessao,
  aposTrocaDeSenha, verificarBloqueio, registrarFalha, limparFalhas, encerrarSessoesDoTenant
} from "./services/authService.js";
import {
  conectarWhatsApp, ligarBot, desligarBot, sairDoWhatsapp, statusConexao, getQrAtual,
  getGruposRecebidos, gerarNovoQr, enviarMensagemGrupos, enviarMensagemDireta,
  listarStatusSessoesWhatsapp, solicitarCodigoPareamento, getSock
} from "./whatsapp/whatsappService.js";
import { enviarEmailVerificacao } from "./services/emailService.js";
import { iniciarScheduler } from "./scheduler/scheduler.js";
import { reiniciarProcesso, statusProcesso } from "./services/processoService.js";
import {
  lerTriagem, salvarTriagem, validarTriagem, sincronizarSiteNaTriagem,
  simularAtendimentoTriagem, listarPausasHumano, reativarAtendimentoBot,
  listarDadosAprendizado, ensinarRespostaAoBot, removerExemploAprendizado, limparInteracoesRecentes
} from "./services/triagemService.js";
import { resolverDestinos } from "./services/destinosService.js";
import { selecionarMidiasParaEnvio } from "./services/midiaSelecaoService.js";
import {
  lerConfigSupabase, salvarConfigSupabase, verificarConexaoSupabase,
  sincronizarTudoComSupabase, enviarMidiaParaSupabaseStorage,
  publicarStatusVivoNoSupabase, iniciarMonitoramentoComandosSupabase
} from "./services/supabaseService.js";
import { tenantTemCredsNoSupabase } from "./services/supabaseAuthStateService.js";
import {
  lerConfigWebhook, salvarConfigWebhook, regenerarSegredoWebhook,
  validarSegredoWebhook, extrairTokenRequisicao, normalizarTelefoneWhatsapp,
  lerEventosWebhook, limparEventosWebhook, processarWebhookSite
} from "./services/webhookService.js";
import {
  executarNoTenant, TENANT_PADRAO, normalizarTenantId, prefixoAuthWhatsappTenant
} from "./services/tenantContext.js";
import {
  garantirTenantsIniciais, verificarCredenciaisTenant, trocarSenhaTenant,
  registrarContaGratuita, obterTenantPorId, listarTenants, sanitizarTenantPublico,
  avaliarAcessoTenant, obterLimitesPlano, criarClienteAdmin, atualizarClienteAdmin,
  renovarClienteAdmin, resetarSenhaClienteAdmin, excluirClienteAdmin,
  validarAgendamentosNoPlano, validarTriagemNoPlano,
  listarTenantsAtivosParaScheduler, listarTenantsElegiveisAutoConexao,
  verificarEmailPorCodigoOuToken, regenerarCodigoVerificacaoEmail,
  aprovarEmailManualAdmin, marcarAvisoDemoVisto
} from "./services/tenantService.js";

process.on("unhandledRejection", (err) => {
  console.error("⚠️ Unhandled rejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught exception:", err?.message || err);
});

const syncInicial = await Promise.race([
  sincronizarTudoComSupabase(),
  new Promise(resolve => setTimeout(() => resolve({ ok: false, erro: "timeout" }), 6000))
]).catch(err => ({ ok: false, erro: err?.message || "falha na sincronização inicial" }));

if (syncInicial?.ok) {
  console.log(`☁️ Supabase sincronizado (${syncInicial.enviadosParaNuvem || 0} enviado(s), ${syncInicial.baixadosDaNuvem || 0} recebido(s)).`);
} else if (syncInicial?.erro) {
  console.log(`⚠️ Supabase: ${syncInicial.erro}`);
}

await garantirUsuarioPadrao();
await garantirTenantsIniciais();

const app = express();
app.set("trust proxy", 1);
const PORTA = Number(process.env.PORT || 3000);
app.use(express.json({ limit: "2mb" }));
app.use("/midia", express.static("./midia"));
app.use(express.static("./public"));

const upload = multer({ dest: "./midia", limits: { fileSize: 25 * 1024 * 1024 } });
const registrosPorIp = new Map();

function cookieToken(req) {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)sessao=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function definirCookieSessao(req, res, token) {
  const ehHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `sessao=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${ehHttps ? "; Secure" : ""}`
  );
}

function exigirLogin(req, res, next) {
  const token = cookieToken(req);
  const sessao = obterSessao(token);
  if (!sessao) return res.status(401).json({ logado: false });

  const tenant = obterTenantPorId(sessao.tenantId || TENANT_PADRAO);
  if (!tenant) {
    encerrarSessao(token);
    return res.status(401).json({ logado: false });
  }

  req.sessao = sessao;
  req.tenant = tenant;
  req.acesso = avaliarAcessoTenant(tenant);
  return executarNoTenant(tenant.id, () => next());
}

function exigirAssinaturaAtiva(req, res, next) {
  if (!req.acesso?.liberado) {
    return res.status(403).json({
      ok: false,
      bloqueado: true,
      motivo: req.acesso?.motivo || "assinatura_vencida",
      erro: req.acesso?.mensagem || "Assinatura vencida ou suspensa."
    });
  }
  return next();
}

function exigirSuperAdmin(req, res, next) {
  if (req.tenant?.papel !== "superadmin") {
    return res.status(403).json({ ok: false, erro: "Acesso restrito ao administrador do sistema." });
  }
  return next();
}

function montarMensagemAgendamento(agendamento) {
  const midiasSelecionadas = selecionarMidiasParaEnvio(agendamento);
  return {
    texto: agendamento.texto || "",
    midias: midiasSelecionadas
  };
}

// ----------------- AUTENTICAÇÃO E AUTO-CADASTRO GRÁTIS -----------------
const reenviosEmailPorIp = new Map();

function urlBaseRequisicao(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

app.post("/api/login", async (req, res) => {
  const ip = req.ip || "ip";
  const bloqueio = verificarBloqueio(ip);
  if (bloqueio.bloqueado) return res.status(429).json({ ok: false, erro: `Muitas tentativas. Aguarde ${bloqueio.segundos}s.` });

  const resultado = await verificarCredenciaisTenant(req.body?.usuario, req.body?.senha);
  if (!resultado.ok) {
    registrarFalha(ip);
    return res.status(401).json({ ok: false, erro: "Usuário ou senha inválidos." });
  }

  limparFalhas(ip);
  const { tenant } = resultado;

  if (tenant.emailVerificado === false) {
    return res.status(403).json({
      ok: false,
      precisaVerificarEmail: true,
      usuario: tenant.usuario,
      email: tenant.email,
      erro: "Confirme seu e-mail com o código ou link enviado antes do primeiro login."
    });
  }

  const token = criarSessao(tenant.usuario, resultado.precisaTrocarSenha, {
    tenantId: tenant.id,
    papel: tenant.papel
  });
  definirCookieSessao(req, res, token);
  res.json({
    ok: true,
    precisaTrocarSenha: resultado.precisaTrocarSenha,
    papel: tenant.papel,
    plano: tenant.plano,
    avisoDemo: tenant.plano === "free" && tenant.avisoDemoVisto !== true
  });
});

app.post("/api/registrar-gratis", async (req, res) => {
  const ip = req.ip || "ip";
  const agora = Date.now();
  const janela = (registrosPorIp.get(ip) || []).filter(ts => agora - ts < 60 * 60 * 1000);
  if (janela.length >= 3) {
    return res.status(429).json({ ok: false, erro: "Muitos cadastros realizados recentemente. Tente mais tarde." });
  }

  const resultado = await registrarContaGratuita({
    nome: req.body?.nome,
    usuario: req.body?.usuario,
    email: req.body?.email,
    senha: req.body?.senha
  });

  if (!resultado.ok) {
    return res.status(400).json(resultado);
  }

  janela.push(agora);
  registrosPorIp.set(ip, janela);

  const { tenant, verificacao } = resultado;
  const linkVerificacao = `${urlBaseRequisicao(req)}/login.html?verificar=${encodeURIComponent(verificacao.token)}`;
  let envio = { enviado: false, motivo: "" };
  try {
    envio = await enviarEmailVerificacao({
      para: tenant.email,
      nome: tenant.nome,
      codigo: verificacao.codigo,
      linkVerificacao,
      codigoUnico: tenant.codigoUnico
    });
  } catch (err) {
    envio = { enviado: false, motivo: err.message };
  }

  res.status(201).json({
    ok: true,
    precisaVerificarEmail: true,
    usuario: tenant.usuario,
    email: tenant.email,
    codigoUnico: tenant.codigoUnico,
    emailEnviado: !!envio.enviado,
    avisoEmail: envio.enviado
      ? null
      : "O envio automático de e-mail ainda não está ativado no servidor (configure BREVO_API_KEY) — peça ao administrador para validar seu e-mail no painel Admin."
  });
});

app.post("/api/verificar-email", (req, res) => {
  const resultado = verificarEmailPorCodigoOuToken({
    usuarioOuEmail: req.body?.usuario,
    codigo: req.body?.codigo,
    token: req.body?.token
  });
  if (!resultado.ok) {
    return res.status(400).json(resultado);
  }

  const { tenant } = resultado;
  const tokenSessao = criarSessao(tenant.usuario, false, {
    tenantId: tenant.id,
    papel: tenant.papel
  });
  definirCookieSessao(req, res, tokenSessao);

  return res.json({
    ok: true,
    tenant,
    avisoDemo: tenant.plano === "free" && tenant.avisoDemoVisto !== true
  });
});

app.get("/api/verificar-email", (req, res) => {
  const tokenUrl = String(req.query?.token || "").trim();
  const resultado = verificarEmailPorCodigoOuToken({ token: tokenUrl });
  if (!resultado.ok) {
    return res.redirect("./login.html?erro=link_invalido");
  }
  const { tenant } = resultado;
  const tokenSessao = criarSessao(tenant.usuario, false, {
    tenantId: tenant.id,
    papel: tenant.papel
  });
  definirCookieSessao(req, res, tokenSessao);
  return res.redirect("./conectar.html");
});

app.post("/api/reenviar-codigo-email", async (req, res) => {
  const ip = req.ip || "ip";
  const ultimo = reenviosEmailPorIp.get(ip) || 0;
  if (Date.now() - ultimo < 60 * 1000) {
    return res.status(429).json({ ok: false, erro: "Aguarde 1 minuto antes de reenviar o código." });
  }

  const resultado = regenerarCodigoVerificacaoEmail(req.body?.usuario);
  if (!resultado.ok) {
    return res.status(400).json(resultado);
  }

  reenviosEmailPorIp.set(ip, Date.now());
  const { tenant, verificacao } = resultado;
  const linkVerificacao = `${urlBaseRequisicao(req)}/login.html?verificar=${encodeURIComponent(verificacao.token)}`;

  try {
    const envio = await enviarEmailVerificacao({
      para: tenant.email,
      nome: tenant.nome,
      codigo: verificacao.codigo,
      linkVerificacao,
      codigoUnico: tenant.codigoUnico
    });
    return res.json({
      ok: true,
      emailEnviado: !!envio.enviado,
      avisoEmail: envio.enviado
        ? null
        : "Envio automático de e-mail não configurado no servidor; solicite liberação ao administrador."
    });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message || "Falha ao enviar e-mail." });
  }
});

app.post("/api/conta/confirmar-aviso-demo", exigirLogin, (req, res) => {
  marcarAvisoDemoVisto(req.tenant.id);
  res.json({ ok: true });
});

app.post("/api/logout", exigirLogin, (req, res) => {
  encerrarSessao(cookieToken(req));
  res.json({ ok: true });
});

app.get("/api/sessao", (req, res) => {
  const s = obterSessao(cookieToken(req));
  if (!s) return res.json({ logado: false });
  const tenant = obterTenantPorId(s.tenantId || TENANT_PADRAO);
  if (!tenant) return res.json({ logado: false });
  const acesso = avaliarAcessoTenant(tenant);
  return res.json({
    logado: true,
    precisaTrocarSenha: !!tenant.precisaTrocarSenha,
    tenant: sanitizarTenantPublico(tenant),
    acesso
  });
});

app.post("/api/trocar-senha", exigirLogin, async (req, res) => {
  const result = await trocarSenhaTenant(req.tenant.id, req.body?.senhaAtual, req.body?.novaSenha);
  if (!result.ok) return res.status(400).json(result);
  aposTrocaDeSenha(cookieToken(req));
  res.json(result);
});

// ----------------- GRUPOS, CONTATOS, LISTAS E AGENDAMENTOS -----------------
app.get("/api/grupos", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerGrupos()));
app.post("/api/grupos", exigirLogin, exigirAssinaturaAtiva, (req, res) => { salvarGrupos(req.body); res.json({ ok: true }); });
app.get("/api/grupos-whatsapp", exigirLogin, exigirAssinaturaAtiva, async (_req, res) => {
  const grupos = getGruposRecebidos();
  res.json(Object.entries(grupos).map(([id, grupo]) => ({ id, nome: grupo.subject || id })));
});

app.get("/api/contatos", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerContatos()));
app.post("/api/contatos/adicionar", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  const contatos = lerContatos();
  const nome = String(req.body?.nome || "").trim();
  const telefone = normalizarTelefoneWhatsapp(req.body?.telefone);
  if (!nome || !telefone) {
    return res.status(400).json({ erro: "Nome e telefone válidos são obrigatórios (ex: 5511999999999)." });
  }
  const id = `${telefone}@s.whatsapp.net`;
  const duplicado = contatos.some(c => c.id === id || normalizarTelefoneWhatsapp(c.telefone) === telefone);
  if (duplicado) {
    return res.status(400).json({ erro: "Este contato já está cadastrado." });
  }
  const contato = { id, nome, telefone, ativo: req.body?.ativo !== false };
  contatos.unshift(contato);
  salvarContatos(contatos);
  res.json({ ok: true, contato });
});
app.post("/api/contatos", exigirLogin, exigirAssinaturaAtiva, (req, res) => { salvarContatos(req.body); res.json({ ok: true }); });

app.get("/api/listas-contatos", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerListasContatos()));
app.post("/api/listas-contatos", exigirLogin, exigirAssinaturaAtiva, (req, res) => { salvarListasContatos(req.body); res.json({ ok: true }); });

app.get("/api/agendamentos", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerAgendamentos()));
app.post("/api/agendamentos", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  const check = validarAgendamentosNoPlano(req.body, req.tenant);
  if (!check.ok) {
    return res.status(403).json(check);
  }
  salvarAgendamentos(req.body);
  res.json({ ok: true });
});

app.post("/api/testar/:id", exigirLogin, exigirAssinaturaAtiva, async (req, res) => {
  const agendamento = lerAgendamentos().find(item => item.id === req.params.id);
  if (!agendamento) return res.status(404).json({ erro: "Agendamento nao encontrado." });

  const checkPlano = validarAgendamentosNoPlano([agendamento], req.tenant);
  if (!checkPlano.ok) return res.status(403).json(checkPlano);

  const destinos = resolverDestinos(agendamento);
  if (destinos.length === 0) {
    return res.status(400).json({ erro: "Este agendamento nao possui destinos ativos. Selecione grupos ou contatos ativos." });
  }

  try {
    const mensagem = montarMensagemAgendamento(agendamento);
    const resultadoEnvio = await enviarMensagemGrupos(destinos, mensagem, {
      horario: agendamento.horario,
      origem: "teste manual"
    });
    if (resultadoEnvio?.enviados === 0) {
      return res.status(400).json({ erro: "Nenhuma mensagem foi enviada. Verifique se o WhatsApp esta conectado." });
    }
    const totalMidias = (agendamento.midias || []).length;
    const detalheSorteio = agendamento.midiasAleatorias && totalMidias > 0
      ? ` (${mensagem.midias.length}/${totalMidias} mídias sorteadas)`
      : "";
    res.json({ ok: true, mensagem: `Teste concluido: ${resultadoEnvio.enviados} enviado(s), ${resultadoEnvio.falhas} falha(s).${detalheSorteio}` });
  } catch (err) {
    res.status(500).json({ erro: err.message || "Falha ao enviar o agendamento." });
  }
});

app.get("/api/envios", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerEnvios()));
app.get("/api/historico", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerHistorico()));
app.get("/api/config", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerConfig()));
app.post("/api/config", exigirLogin, exigirAssinaturaAtiva, (req, res) => { salvarConfig({ ...lerConfig(), ...req.body }); res.json({ ok: true }); });

// ----------------- TRIAGEM E IA DO SITE -----------------
app.get("/api/triagem", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerTriagem()));
app.post("/api/triagem", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  const resultado = validarTriagem(req.body);
  if (!resultado.ok) return res.status(400).json(resultado);
  const checkPlano = validarTriagemNoPlano(req.body, req.tenant);
  if (!checkPlano.ok) return res.status(403).json(checkPlano);
  try { res.json({ ok: true, dados: salvarTriagem(req.body) }); } catch (err) { res.status(400).json({ ok: false, erro: err.message }); }
});
app.post("/api/triagem/sincronizar-site", exigirLogin, exigirAssinaturaAtiva, async (req, res) => {
  try {
    const resultado = await sincronizarSiteNaTriagem(req.body?.urlSite);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message || "Não foi possível ler o site." });
  }
});
app.post("/api/triagem/simular", exigirLogin, exigirAssinaturaAtiva, async (req, res) => {
  try {
    const checkPlano = validarTriagemNoPlano({ ia: req.body?.ia }, req.tenant);
    if (!checkPlano.ok) return res.status(403).json(checkPlano);
    const resultado = await simularAtendimentoTriagem(req.body?.mensagem, req.body?.ia);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message || "Falha ao simular resposta." });
  }
});
app.get("/api/triagem/pausas", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(listarPausasHumano()));
app.post("/api/triagem/pausas/reativar", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  reativarAtendimentoBot(req.body?.jid);
  res.json({ ok: true, pausas: listarPausasHumano() });
});

app.get("/api/triagem/aprendizado", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(listarDadosAprendizado()));
app.post("/api/triagem/aprendizado", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  try {
    res.json(ensinarRespostaAoBot(req.body));
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});
app.delete("/api/triagem/aprendizado/:id", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  res.json(removerExemploAprendizado(req.params.id));
});
app.post("/api/triagem/aprendizado/limpar-interacoes", exigirLogin, exigirAssinaturaAtiva, (_req, res) => {
  res.json(limparInteracoesRecentes());
});

// ----------------- SAÚDE, STATUS E WHATSAPP DO TENANT -----------------
app.get("/health", (_req, res) => {
  const sessoes = listarStatusSessoesWhatsapp();
  const conectadas = Object.values(sessoes).filter(s => s.conectado).length;
  res.json({
    ok: true,
    status: "online",
    whatsappConectado: !!statusConexao(TENANT_PADRAO).conectado,
    sessoesConectadas: conectadas,
    uptimeSegundos: Math.floor(process.uptime()),
    fusoHorario: process.env.TZ || "America/Sao_Paulo",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/bot/status", exigirLogin, async (req, res) => {
  const isSuper = req.tenant?.papel === "superadmin";
  const supabaseStatus = isSuper ? await verificarConexaoSupabase() : { configurado: true, conectado: true };
  res.json({
    conexaoWhatsapp: statusConexao(),
    processo: statusProcesso(),
    qr: getQrAtual(),
    supabase: supabaseStatus
  });
});

app.get("/api/qr", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  const c = statusConexao();
  const qr = getQrAtual();
  if (!c.conectado && !c.desligadoManualmente && !getSock() && !qr) {
    ligarBot(req.tenant.id).catch(err =>
      console.error(`⚠️ Falha ao iniciar pareamento [${req.tenant.id}]:`, err?.message || err)
    );
  }
  res.json({
    conectado: !!c.conectado,
    qr,
    sessaoInvalida: !!c.sessaoInvalida,
    erro: c.erroConexao || null
  });
});

app.post("/api/bot/codigo-pareamento", exigirLogin, exigirAssinaturaAtiva, async (req, res) => {
  try {
    const resultado = await solicitarCodigoPareamento(req.body?.telefone, req.tenant.id);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ ok: false, erro: err?.message || "Não foi possível gerar o código de pareamento." });
  }
});

app.get("/api/supabase", exigirLogin, exigirSuperAdmin, async (_req, res) => {
  const status = await verificarConexaoSupabase();
  const cfg = lerConfigSupabase();
  res.json({ ...cfg, publishableKey: cfg.publishableKey ? "***configurada***" : "", status });
});
app.post("/api/supabase", exigirLogin, exigirSuperAdmin, async (req, res) => {
  const cfg = salvarConfigSupabase(req.body);
  const sync = await sincronizarTudoComSupabase();
  const status = await verificarConexaoSupabase();
  res.json({ ok: sync.ok, config: { ativo: cfg.ativo, url: cfg.url }, sync, status });
});
app.post("/api/supabase/sincronizar", exigirLogin, exigirSuperAdmin, async (_req, res) => {
  const sync = await sincronizarTudoComSupabase();
  const status = await verificarConexaoSupabase();
  res.json({ ...sync, status });
});

app.post("/api/bot/ligar", exigirLogin, exigirAssinaturaAtiva, async (_req, res) => { await ligarBot(); res.json({ ok: true }); });
app.post("/api/bot/desligar", exigirLogin, exigirAssinaturaAtiva, (_req, res) => { desligarBot(); res.json({ ok: true }); });
app.post("/api/bot/reiniciar", exigirLogin, exigirSuperAdmin, (_req, res) => { reiniciarProcesso(); res.json({ ok: true }); });
app.post("/api/bot/qr", exigirLogin, exigirAssinaturaAtiva, async (_req, res) => { await gerarNovoQr(); res.json({ ok: true }); });
app.post("/api/bot/novo-qr", exigirLogin, exigirAssinaturaAtiva, async (_req, res) => { await gerarNovoQr(); res.json({ ok: true }); });
app.post("/api/bot/sair", exigirLogin, exigirAssinaturaAtiva, async (_req, res) => { await sairDoWhatsapp(); res.json({ ok: true }); });

// ----------------- WEBHOOK DO SITE POR TENANT -----------------
function resolverTenantWebhook(paramTenant) {
  const tid = normalizarTenantId(paramTenant || TENANT_PADRAO);
  return obterTenantPorId(tid);
}

app.get(["/api/webhook/ping", "/api/webhook/ping/:tenantId"], (req, res) => {
  const tenant = resolverTenantWebhook(req.params.tenantId);
  if (!tenant) return res.status(404).json({ ok: false, erro: "Conta não encontrada." });

  const acesso = avaliarAcessoTenant(tenant);
  if (!acesso.liberado) return res.status(403).json({ ok: false, erro: acesso.mensagem });
  if (!obterLimitesPlano(tenant).permiteWebhook) {
    return res.status(403).json({ ok: false, erro: "Webhooks estão disponíveis apenas no Plano Pro." });
  }

  return executarNoTenant(tenant.id, () => {
    const token = extrairTokenRequisicao(req);
    if (!validarSegredoWebhook(token)) {
      return res.status(401).json({ ok: false, erro: "Token de webhook inválido ou ausente. Envie no header X-Webhook-Secret." });
    }
    const cfg = lerConfigWebhook();
    res.json({
      ok: true,
      tenantId: tenant.id,
      ativo: cfg.ativo,
      whatsappConectado: !!statusConexao(tenant.id).conectado,
      eventosSuportados: Object.keys(cfg.eventos),
      timestamp: new Date().toISOString()
    });
  });
});

app.post(["/api/webhook/site", "/api/webhook/site/:tenantId"], async (req, res) => {
  const tenant = resolverTenantWebhook(req.params.tenantId);
  if (!tenant) return res.status(404).json({ ok: false, erro: "Conta não encontrada." });

  const acesso = avaliarAcessoTenant(tenant);
  if (!acesso.liberado) return res.status(403).json({ ok: false, erro: acesso.mensagem });
  if (!obterLimitesPlano(tenant).permiteWebhook) {
    return res.status(403).json({ ok: false, erro: "Webhooks estão disponíveis apenas no Plano Pro." });
  }

  return executarNoTenant(tenant.id, async () => {
    const token = extrairTokenRequisicao(req);
    if (!validarSegredoWebhook(token)) {
      return res.status(401).json({ ok: false, erro: "Token de webhook inválido ou ausente. Envie no header X-Webhook-Secret." });
    }
    try {
      const resultado = await processarWebhookSite(req.body, enviarMensagemDireta);
      const statusHttp = resultado.statusHttp || (resultado.ok === false ? 400 : 200);
      return res.status(statusHttp).json(resultado);
    } catch (err) {
      const desconectado = /não conectado/i.test(err?.message || "");
      return res.status(desconectado ? 503 : 500).json({ ok: false, erro: err?.message || "Erro ao processar webhook." });
    }
  });
});

// ----------------- CONFIGURAÇÃO WEBHOOKS NO PAINEL ADMIN DO TENANT -----------------
app.get("/api/webhooks/config", exigirLogin, exigirAssinaturaAtiva, (_req, res) => {
  const cfg = lerConfigWebhook();
  const limites = obterLimitesPlano(req.tenant);
  res.json({ ...cfg, permitidoNoPlano: !!limites.permiteWebhook });
});
app.post("/api/webhooks/config", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  if (!obterLimitesPlano(req.tenant).permiteWebhook) {
    return res.status(403).json({ ok: false, erro: "Webhooks são exclusivos do Plano Pro." });
  }
  try {
    res.json({ ok: true, config: salvarConfigWebhook(req.body) });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});
app.post("/api/webhooks/regenerar-segredo", exigirLogin, exigirAssinaturaAtiva, (req, res) => {
  if (!obterLimitesPlano(req.tenant).permiteWebhook) {
    return res.status(403).json({ ok: false, erro: "Webhooks são exclusivos do Plano Pro." });
  }
  res.json({ ok: true, config: regenerarSegredoWebhook() });
});
app.get("/api/webhooks/eventos", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json(lerEventosWebhook()));
app.post("/api/webhooks/eventos/limpar", exigirLogin, exigirAssinaturaAtiva, (_req, res) => {
  limparEventosWebhook();
  res.json({ ok: true });
});
app.post("/api/webhooks/testar", exigirLogin, exigirAssinaturaAtiva, async (req, res) => {
  if (!obterLimitesPlano(req.tenant).permiteWebhook) {
    return res.status(403).json({ ok: false, erro: "Webhooks são exclusivos do Plano Pro." });
  }
  try {
    const resultado = await processarWebhookSite(req.body, enviarMensagemDireta);
    const statusHttp = resultado.statusHttp || (resultado.ok === false ? 400 : 200);
    res.status(statusHttp).json(resultado);
  } catch (err) {
    const desconectado = /não conectado/i.test(err?.message || "");
    res.status(desconectado ? 503 : 500).json({ ok: false, erro: err?.message || "Falha ao testar webhook." });
  }
});

// ----------------- UPLOAD DE MÍDIAS POR TENANT -----------------
app.post("/api/upload", exigirLogin, exigirAssinaturaAtiva, upload.single("arquivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });
  const extensao = path.extname(req.file.originalname).toLowerCase();
  const prefixoTid = req.tenant.id === TENANT_PADRAO ? "" : `${req.tenant.id}-`;
  const destino = path.join("./midia", `${prefixoTid}${Date.now()}-${req.file.filename}${extensao}`);
  fs.renameSync(req.file.path, destino);
  const urlPublica = await enviarMidiaParaSupabaseStorage(destino, req.file.mimetype, req.tenant.id);
  const caminhoRelativo = destino.replace(/\\/g, "/").replace("./", "");
  res.json({
    caminho: urlPublica || caminhoRelativo,
    caminhoLocal: caminhoRelativo,
    urlPublica: urlPublica || null,
    tipo: /^jpg|jpeg|png|gif|webp$/.test(extensao.slice(1)) ? "imagem" : "video"
  });
});

app.post("/api/midia/rotacionar", exigirLogin, exigirAssinaturaAtiva, (_req, res) => res.json({ ok: true }));

// ----------------- PAINEL SUPER ADMIN (GESTÃO DE CLIENTES E MENSALIDADES) -----------------
app.get("/api/admin/clientes", exigirLogin, exigirSuperAdmin, (_req, res) => {
  const sessoes = listarStatusSessoesWhatsapp();
  const todos = listarTenants();

  const clientes = todos.map((t) => {
    const acesso = avaliarAcessoTenant(t);
    const qtdAgendamentos = executarNoTenant(t.id, () => lerAgendamentos().length);
    return {
      ...sanitizarTenantPublico(t),
      acesso,
      whatsappConectado: !!sessoes[t.id]?.conectado,
      qtdAgendamentos
    };
  });

  const proc = statusProcesso();
  res.json({
    clientes,
    resumo: {
      totalClientes: clientes.length,
      totalPro: clientes.filter(c => c.plano === "pro" && c.acesso.liberado).length,
      totalFree: clientes.filter(c => c.plano === "free" && c.acesso.liberado).length,
      totalConectados: clientes.filter(c => c.whatsappConectado).length,
      memoriaMb: Number(((proc.memoria || 0) / 1024 / 1024).toFixed(1)),
      uptimeHoras: Number(((proc.uptimeMs || 0) / 3600000).toFixed(2))
    }
  });
});

app.post("/api/admin/clientes", exigirLogin, exigirSuperAdmin, async (req, res) => {
  const result = await criarClienteAdmin(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put("/api/admin/clientes/:id", exigirLogin, exigirSuperAdmin, (req, res) => {
  const result = atualizarClienteAdmin(req.params.id, req.body || {});
  if (!result.ok) return res.status(400).json(result);
  if (result.tenant.ativo === false) {
    desligarBot(result.tenant.id);
    encerrarSessoesDoTenant(result.tenant.id);
  }
  res.json(result);
});

app.post("/api/admin/clientes/:id/renovar", exigirLogin, exigirSuperAdmin, (req, res) => {
  const dias = Number(req.body?.dias) || 30;
  const result = renovarClienteAdmin(req.params.id, dias);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/admin/clientes/:id/verificar-email", exigirLogin, exigirSuperAdmin, (req, res) => {
  const result = aprovarEmailManualAdmin(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/admin/clientes/:id/resetar-senha", exigirLogin, exigirSuperAdmin, async (req, res) => {
  const result = await resetarSenhaClienteAdmin(req.params.id, req.body?.novaSenha);
  if (!result.ok) return res.status(400).json(result);
  encerrarSessoesDoTenant(result.tenant.id);
  res.json(result);
});

app.delete("/api/admin/clientes/:id", exigirLogin, exigirSuperAdmin, async (req, res) => {
  const tid = normalizarTenantId(req.params.id);
  desligarBot(tid);
  encerrarSessoesDoTenant(tid);
  const result = await excluirClienteAdmin(tid);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ----------------- INICIALIZAÇÃO DO SERVIDOR & MULTI-TENANT -----------------
app.listen(PORTA, "0.0.0.0", () => {
  console.log(`✅ Sistema SaaS pronto. Painel disponível em http://localhost:${PORTA}`);
});

try {
  await conectarWhatsApp(TENANT_PADRAO);
} catch (err) {
  console.error("⚠️ Falha inicial ao conectar WhatsApp (admin):", err?.message || err);
}

// Auto-reconecta clientes Pro ativos que já possuem sessão salva no Supabase/disco
for (const tenantPro of listarTenantsElegiveisAutoConexao()) {
  if (tenantPro.id === TENANT_PADRAO) continue;
  try {
    const temCreds = await tenantTemCredsNoSupabase(prefixoAuthWhatsappTenant(tenantPro.id));
    if (temCreds) {
      conectarWhatsApp(tenantPro.id).catch(err =>
        console.error(`⚠️ Falha ao reconectar WhatsApp [${tenantPro.id}]:`, err?.message || err)
      );
    }
  } catch {}
}

// Desconecta automaticamente contas cuja assinatura ou teste gratuito venceu
setInterval(() => {
  const sessoes = listarStatusSessoesWhatsapp();
  for (const tenant of listarTenants()) {
    if (tenant.papel === "superadmin") continue;
    const acesso = avaliarAcessoTenant(tenant);
    if (!acesso.liberado && sessoes[tenant.id]?.conectado) {
      console.log(`🔒 [${tenant.id}] Acesso bloqueado (${acesso.motivo}). Desconectando WhatsApp para economizar memória.`);
      desligarBot(tenant.id);
    }
  }
}, 10 * 60 * 1000);

iniciarScheduler(
  (agendamento, tenant) =>
    enviarMensagemGrupos(
      resolverDestinos(agendamento),
      montarMensagemAgendamento(agendamento),
      { horario: agendamento.horario, origem: "agendado" },
      tenant?.id || TENANT_PADRAO
    ),
  listarTenantsAtivosParaScheduler
);

// Publica status ao vivo do admin para o Painel Online (GitHub Pages) e processa comandos remotos
setInterval(() => {
  executarNoTenant(TENANT_PADRAO, () => {
    const grupos = getGruposRecebidos(TENANT_PADRAO);
    publicarStatusVivoNoSupabase({
      conexaoWhatsapp: statusConexao(TENANT_PADRAO),
      processo: statusProcesso(),
      qr: getQrAtual(TENANT_PADRAO),
      gruposWhatsapp: Object.entries(grupos).map(([id, grupo]) => ({ id, nome: grupo.subject || id }))
    });
  });
}, 5000);

iniciarMonitoramentoComandosSupabase(async (acao, payload) => {
  return executarNoTenant(TENANT_PADRAO, async () => {
    if (acao === "ligar") { await ligarBot(TENANT_PADRAO); return { ok: true }; }
    if (acao === "desligar") { desligarBot(TENANT_PADRAO); return { ok: true }; }
    if (acao === "reiniciar") { setTimeout(() => reiniciarProcesso(), 500); return { ok: true }; }
    if (acao === "qr" || acao === "novo-qr") { await gerarNovoQr(TENANT_PADRAO); return { ok: true }; }
    if (acao === "testar-webhook") { return await processarWebhookSite(payload || {}, enviarMensagemDireta); }
    if (acao === "sincronizar-site") { return await sincronizarSiteNaTriagem(payload?.urlSite); }
    if (acao === "simular") {
      const resSim = await simularAtendimentoTriagem(payload?.mensagem, payload?.ia);
      return { ok: true, ...resSim };
    }
    if (acao === "testar" && payload?.id) {
      const agendamento = lerAgendamentos().find(item => item.id === payload.id);
      if (!agendamento) throw new Error("Agendamento não encontrado.");
      const destinos = resolverDestinos(agendamento);
      if (destinos.length === 0) throw new Error("Este agendamento não possui destinos ativos.");
      const mensagem = montarMensagemAgendamento(agendamento);
      const resultadoEnvio = await enviarMensagemGrupos(
        destinos,
        mensagem,
        { horario: agendamento.horario, origem: "teste manual (nuvem)" },
        TENANT_PADRAO
      );
      return { ok: true, mensagem: `Teste concluído: ${resultadoEnvio.enviados} enviado(s), ${resultadoEnvio.falhas} falha(s).` };
    }
    return { ok: true };
  });
});
