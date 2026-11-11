import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import {
  lerGrupos, salvarGrupos, lerAgendamentos, salvarAgendamentos, lerEnvios, lerHistorico,
  lerConfig, salvarConfig, lerContatos, salvarContatos, lerListasContatos, salvarListasContatos
} from "./services/configService.js";
import {
  garantirUsuarioPadrao, verificarCredenciais, trocarSenha, criarSessao, obterSessao,
  encerrarSessao, aposTrocaDeSenha, verificarBloqueio, registrarFalha, limparFalhas,
  validarNovaSenha
} from "./services/authService.js";
import {
  conectarWhatsApp, ligarBot, desligarBot, statusConexao, getQrAtual, getGruposRecebidos,
  gerarNovoQr, sairDoWhatsapp, enviarMensagemGrupos
} from "./whatsapp/whatsappService.js";
import { iniciarScheduler } from "./scheduler/scheduler.js";
import { encerrarProcesso, reiniciarProcesso, statusProcesso } from "./services/processoService.js";
import {
  lerTriagem, salvarTriagem, validarTriagem, sincronizarSiteNaTriagem,
  simularAtendimentoTriagem, listarPausasHumano, reativarAtendimentoBot,
  listarDadosAprendizado, ensinarRespostaAoBot, removerExemploAprendizado, limparInteracoesRecentes
} from "./services/triagemService.js";
import { resolverDestinos } from "./services/destinosService.js";

await garantirUsuarioPadrao();

const app = express();
const PORTA = Number(process.env.PORT || 3000);
app.use(express.json({ limit: "2mb" }));
app.use("/midia", express.static("./midia"));
app.use(express.static("./public"));

const upload = multer({ dest: "./midia", limits: { fileSize: 25 * 1024 * 1024 } });

function cookieToken(req) {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)sessao=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
function exigirLogin(req, res, next) {
  const token = cookieToken(req);
  if (!obterSessao(token)) return res.status(401).json({ logado: false });
  next();
}

app.post("/api/login", async (req, res) => {
  const ip = req.ip || "ip";
  const bloqueio = verificarBloqueio(ip);
  if (bloqueio.bloqueado) return res.status(429).json({ ok: false, erro: `Muitas tentativas. Aguarde ${bloqueio.segundos}s.` });
  const resultado = await verificarCredenciais(req.body?.usuario, req.body?.senha);
  if (!resultado.ok) {
    registrarFalha(ip);
    return res.status(401).json({ ok: false, erro: "Usuário ou senha inválidos." });
  }
  limparFalhas(ip);
  const token = criarSessao(resultado.usuario, resultado.precisaTrocarSenha);
  res.setHeader("Set-Cookie", `sessao=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict`);
  res.json({ ok: true, precisaTrocarSenha: resultado.precisaTrocarSenha });
});
app.post("/api/logout", exigirLogin, (req, res) => { encerrarSessao(cookieToken(req)); res.json({ ok: true }); });
app.get("/api/sessao", (req, res) => { const s = obterSessao(cookieToken(req)); res.json(s ? { logado: true, precisaTrocarSenha: !!s.precisaTrocarSenha } : { logado: false }); });
app.post("/api/trocar-senha", exigirLogin, async (req, res) => {
  const result = await trocarSenha(req.body?.senhaAtual, req.body?.novaSenha);
  if (!result.ok) return res.status(400).json(result);
  aposTrocaDeSenha(cookieToken(req));
  res.json(result);
});

app.get("/api/grupos", exigirLogin, (_req, res) => res.json(lerGrupos()));
app.post("/api/grupos", exigirLogin, (req, res) => { salvarGrupos(req.body); res.json({ ok: true }); });
app.get("/api/grupos-whatsapp", exigirLogin, async (_req, res) => {
  const grupos = getGruposRecebidos();
  res.json(Object.entries(grupos).map(([id, grupo]) => ({ id, nome: grupo.subject || id })));
});
app.get("/api/contatos", exigirLogin, (_req, res) => res.json(lerContatos()));
app.post("/api/contatos/adicionar", exigirLogin, (req, res) => {
  const contatos = lerContatos();
  const contato = { id: req.body.id || Date.now().toString(), nome: String(req.body.nome || "").trim(), telefone: String(req.body.telefone || "").trim(), ativo: req.body.ativo !== false };
  if (!contato.nome || !/^\d{10,15}$/.test(contato.telefone)) return res.status(400).json({ erro: "Nome e telefone válidos são obrigatórios." });
  contatos.unshift(contato); salvarContatos(contatos); res.json(contato);
});
app.post("/api/contatos", exigirLogin, (req, res) => { salvarContatos(req.body); res.json({ ok: true }); });
app.get("/api/listas-contatos", exigirLogin, (_req, res) => res.json(lerListasContatos()));
app.post("/api/listas-contatos", exigirLogin, (req, res) => { salvarListasContatos(req.body); res.json({ ok: true }); });
app.get("/api/agendamentos", exigirLogin, (_req, res) => res.json(lerAgendamentos()));
app.post("/api/agendamentos", exigirLogin, (req, res) => { salvarAgendamentos(req.body); res.json({ ok: true }); });
app.post("/api/testar/:id", exigirLogin, async (req, res) => {
  const agendamento = lerAgendamentos().find(item => item.id === req.params.id);
  if (!agendamento) return res.status(404).json({ erro: "Agendamento nao encontrado." });

  const destinos = resolverDestinos(agendamento);
  if (destinos.length === 0) {
    return res.status(400).json({ erro: "Este agendamento nao possui destinos ativos. Selecione grupos ou contatos ativos." });
  }

  try {
    const resultadoEnvio = await enviarMensagemGrupos(destinos, {
      texto: agendamento.texto || "",
      midias: agendamento.midias || []
    }, {
      horario: agendamento.horario,
      origem: "teste manual"
    });
    if (resultadoEnvio?.enviados === 0) {
      return res.status(400).json({ erro: "Nenhuma mensagem foi enviada. Verifique se o WhatsApp esta conectado." });
    }
    res.json({ ok: true, mensagem: `Teste concluido: ${resultadoEnvio.enviados} enviado(s), ${resultadoEnvio.falhas} falha(s).` });
  } catch (err) {
    res.status(500).json({ erro: err.message || "Falha ao enviar o agendamento." });
  }
});
app.get("/api/envios", exigirLogin, (_req, res) => res.json(lerEnvios()));
app.get("/api/historico", exigirLogin, (_req, res) => res.json(lerHistorico()));
app.get("/api/config", exigirLogin, (_req, res) => res.json(lerConfig()));
app.post("/api/config", exigirLogin, (req, res) => { salvarConfig({ ...lerConfig(), ...req.body }); res.json({ ok: true }); });

app.get("/api/triagem", exigirLogin, (_req, res) => res.json(lerTriagem()));
app.post("/api/triagem", exigirLogin, (req, res) => {
  const resultado = validarTriagem(req.body);
  if (!resultado.ok) return res.status(400).json(resultado);
  try { res.json({ ok: true, dados: salvarTriagem(req.body) }); } catch (err) { res.status(400).json({ ok: false, erro: err.message }); }
});
app.post("/api/triagem/sincronizar-site", exigirLogin, async (req, res) => {
  try {
    const resultado = await sincronizarSiteNaTriagem(req.body?.urlSite);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message || "Não foi possível ler o site." });
  }
});
app.post("/api/triagem/simular", exigirLogin, async (req, res) => {
  try {
    const resultado = await simularAtendimentoTriagem(req.body?.mensagem, req.body?.ia);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message || "Falha ao simular resposta." });
  }
});
app.get("/api/triagem/pausas", exigirLogin, (_req, res) => res.json(listarPausasHumano()));
app.post("/api/triagem/pausas/reativar", exigirLogin, (req, res) => {
  reativarAtendimentoBot(req.body?.jid);
  res.json({ ok: true, pausas: listarPausasHumano() });
});

// Aprendizado Contínuo (Treinamento / Machine Learning do Bot)
app.get("/api/triagem/aprendizado", exigirLogin, (_req, res) => res.json(listarDadosAprendizado()));
app.post("/api/triagem/aprendizado", exigirLogin, (req, res) => {
  try {
    res.json(ensinarRespostaAoBot(req.body));
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});
app.delete("/api/triagem/aprendizado/:id", exigirLogin, (req, res) => {
  res.json(removerExemploAprendizado(req.params.id));
});
app.post("/api/triagem/aprendizado/limpar-interacoes", exigirLogin, (_req, res) => {
  res.json(limparInteracoesRecentes());
});

app.get("/api/bot/status", exigirLogin, (_req, res) => res.json({ conexaoWhatsapp: statusConexao(), processo: statusProcesso(), qr: getQrAtual() }));
app.post("/api/bot/ligar", exigirLogin, async (_req, res) => { await ligarBot(); res.json({ ok: true }); });
app.post("/api/bot/desligar", exigirLogin, (_req, res) => { desligarBot(); res.json({ ok: true }); });
app.post("/api/bot/reiniciar", exigirLogin, (_req, res) => { reiniciarProcesso(); res.json({ ok: true }); });
app.post("/api/processo/encerrar", exigirLogin, (_req, res) => { encerrarProcesso(); res.json({ ok: true }); });
app.post("/api/bot/qr", exigirLogin, async (_req, res) => { await gerarNovoQr(); res.json({ ok: true }); });

app.post("/api/upload", exigirLogin, upload.single("arquivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Nenhum arquivo enviado." });
  const extensao = path.extname(req.file.originalname).toLowerCase();
  const destino = path.join("./midia", `${Date.now()}-${req.file.filename}${extensao}`);
  fs.renameSync(req.file.path, destino);
  res.json({ caminho: destino.replace(/\\/g, "/").replace("./", ""), tipo: /^jpg|jpeg|png|gif|webp$/.test(extensao.slice(1)) ? "imagem" : "video" });
});

app.post("/api/midia/rotacionar", exigirLogin, (_req, res) => res.json({ ok: true }));
app.get("/api/instalacao", exigirLogin, (_req, res) => res.json({ instalado: true, inicioAuto: false }));
app.post("/api/instalacao/atualizar", exigirLogin, (_req, res) => { reiniciarProcesso(); res.json({ ok: true }); });

app.listen(PORTA, () => console.log(`✅ Sistema pronto. Painel disponível em http://localhost:${PORTA}`));
await conectarWhatsApp();
iniciarScheduler((agendamento) => enviarMensagemGrupos(
  resolverDestinos(agendamento),
  { texto: agendamento.texto || "", midias: agendamento.midias || [] },
  { horario: agendamento.horario, origem: "agendado" }
));
