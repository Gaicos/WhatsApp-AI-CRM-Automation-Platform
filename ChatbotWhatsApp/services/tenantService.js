import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { validarNovaSenha } from "./authService.js";
import { salvarChaveNoSupabase, removerDadosTenantNoSupabase } from "./supabaseService.js";
import { TENANT_PADRAO, normalizarTenantId, pastaAuthLocalTenant } from "./tenantContext.js";

const scrypt = promisify(crypto.scrypt);
const CAMINHO_TENANTS = "./data/tenants.json";
const CAMINHO_AUTH_LEGADO = "./data/auth.json";
const SCRYPT = { N: 16384, r: 8, p: 1 };
const TAMANHO_CHAVE = 64;

export const PLANOS_SAAS = {
  superadmin: {
    codigo: "superadmin",
    nome: "Administrador (Ilimitado)",
    maxAgendamentos: 9999,
    maxGruposPorAgendamento: 9999,
    maxContatosPorAgendamento: 9999,
    maxMidiasPorAgendamento: 50,
    permiteRodizioMidias: true,
    permiteWebhook: true,
    permiteIaExterna: true
  },
  pro: {
    codigo: "pro",
    nome: "Plano Pro",
    maxAgendamentos: 50,
    maxGruposPorAgendamento: 100,
    maxContatosPorAgendamento: 500,
    maxMidiasPorAgendamento: 30,
    permiteRodizioMidias: true,
    permiteWebhook: true,
    permiteIaExterna: true
  },
  free: {
    codigo: "free",
    nome: "Teste Grátis (7 dias)",
    maxAgendamentos: 1,
    maxGruposPorAgendamento: 2,
    maxContatosPorAgendamento: 3,
    maxMidiasPorAgendamento: 1,
    permiteRodizioMidias: false,
    permiteWebhook: false,
    permiteIaExterna: false,
    duracaoDiasPadrao: 7
  }
};

function escreverArquivoAtomico(caminho, conteudo) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const tmp = `${caminho}.tmp`;
  fs.writeFileSync(tmp, conteudo, { mode: 0o600 });
  fs.renameSync(tmp, caminho);
}

async function hashSenha(senha, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const chave = await scrypt(String(senha).normalize("NFKC"), salt, TAMANHO_CHAVE, SCRYPT);
  return chave.toString("hex");
}

function igualSeguro(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function lerListaTenants() {
  if (!fs.existsSync(CAMINHO_TENANTS)) return [];
  try {
    const lido = JSON.parse(fs.readFileSync(CAMINHO_TENANTS, "utf-8"));
    return Array.isArray(lido) ? lido : [];
  } catch {
    return [];
  }
}

function salvarListaTenants(lista) {
  escreverArquivoAtomico(CAMINHO_TENANTS, JSON.stringify(lista, null, 2));
  salvarChaveNoSupabase("saas_tenants", lista);
}

function somarDiasIso(baseMs, dias) {
  const d = Number(dias) > 0 ? Number(dias) : 30;
  return new Date(baseMs + d * 24 * 60 * 60 * 1000).toISOString();
}

export async function garantirTenantsIniciais() {
  fs.mkdirSync("./data", { recursive: true });
  const lista = lerListaTenants();
  if (lista.some((t) => t.id === TENANT_PADRAO)) {
    return lista;
  }

  let usuario = "ADMIN";
  let salt = crypto.randomBytes(16).toString("hex");
  let hash = "";
  let precisaTrocarSenha = true;

  if (fs.existsSync(CAMINHO_AUTH_LEGADO)) {
    try {
      const legado = JSON.parse(fs.readFileSync(CAMINHO_AUTH_LEGADO, "utf-8"));
      if (legado?.usuario && legado?.salt && legado?.hash) {
        usuario = legado.usuario;
        salt = legado.salt;
        hash = legado.hash;
        precisaTrocarSenha = !!legado.precisaTrocarSenha;
      }
    } catch {}
  }

  if (!hash) {
    const senhaInicial = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8
      ? process.env.ADMIN_PASSWORD
      : "123";
    precisaTrocarSenha = senhaInicial === "123";
    hash = await hashSenha(senhaInicial, salt);
  }

  const adminTenant = {
    id: TENANT_PADRAO,
    nome: "Gaicos Store (Admin)",
    usuario,
    email: "",
    salt,
    hash,
    precisaTrocarSenha,
    papel: "superadmin",
    plano: "superadmin",
    ativo: true,
    expiraEm: null,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };

  const novaLista = [adminTenant, ...lista];
  salvarListaTenants(novaLista);
  console.log(`👑 Conta Super Admin (${usuario}) configurada com dados da Gaicos Store preservados.`);
  return novaLista;
}

export function obterLimitesPlano(tenant) {
  if (!tenant) return PLANOS_SAAS.free;
  if (tenant.papel === "superadmin" || tenant.plano === "superadmin") return PLANOS_SAAS.superadmin;
  if (tenant.plano === "pro") return PLANOS_SAAS.pro;
  return PLANOS_SAAS.free;
}

export function avaliarAcessoTenant(tenant, agoraMs = Date.now()) {
  if (!tenant) {
    return {
      liberado: false,
      motivo: "nao_encontrado",
      mensagem: "Conta não encontrada.",
      diasRestantes: 0,
      planoInfo: PLANOS_SAAS.free
    };
  }

  const planoInfo = obterLimitesPlano(tenant);
  if (tenant.papel === "superadmin" || tenant.id === TENANT_PADRAO) {
    return {
      liberado: true,
      motivo: "ok",
      mensagem: "Acesso ilimitado",
      diasRestantes: null,
      planoInfo
    };
  }

  if (tenant.ativo === false) {
    return {
      liberado: false,
      motivo: "suspenso",
      mensagem: "Sua conta foi suspensa pelo administrador. Entre em contato para reativar.",
      diasRestantes: 0,
      planoInfo
    };
  }

  if (tenant.expiraEm) {
    const expiraMs = Date.parse(tenant.expiraEm);
    if (Number.isFinite(expiraMs)) {
      const diffMs = expiraMs - agoraMs;
      if (diffMs <= 0) {
        return {
          liberado: false,
          motivo: tenant.plano === "free" ? "teste_expirado" : "assinatura_vencida",
          mensagem:
            tenant.plano === "free"
              ? "Seu período de teste gratuito de 7 dias expirou. Fale conosco para ativar o Plano Pro!"
              : "Sua mensalidade venceu. Fale conosco para renovar por mais 30 dias.",
          diasRestantes: 0,
          planoInfo
        };
      }
      const diasRestantes = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
      return {
        liberado: true,
        motivo: "ok",
        mensagem: "Ativo",
        diasRestantes,
        planoInfo
      };
    }
  }

  return {
    liberado: true,
    motivo: "ok",
    mensagem: "Ativo",
    diasRestantes: null,
    planoInfo
  };
}

export function listarTenants() {
  return lerListaTenants();
}

export function sanitizarTenantPublico(tenant) {
  if (!tenant) return null;
  const { salt, hash, ...resto } = tenant;
  return resto;
}

export function obterTenantPorId(id) {
  const tid = normalizarTenantId(id);
  return lerListaTenants().find((t) => t.id === tid) || null;
}

export function obterTenantPorUsuario(usuario) {
  const limpo = String(usuario || "").trim().toLowerCase();
  if (!limpo) return null;
  return lerListaTenants().find((t) => String(t.usuario || "").trim().toLowerCase() === limpo) || null;
}

const SALT_FALSO = crypto.randomBytes(16).toString("hex");

export async function verificarCredenciaisTenant(usuario, senha) {
  if (typeof usuario !== "string" || typeof senha !== "string") return { ok: false };
  if (usuario.length > 100 || senha.length > 200) return { ok: false };

  const tenant = obterTenantPorUsuario(usuario);
  const hashCalculado = await hashSenha(senha, tenant ? tenant.salt : SALT_FALSO);
  const ok = !!(tenant && igualSeguro(hashCalculado, tenant.hash));

  if (!ok) return { ok: false };
  return {
    ok: true,
    tenant,
    precisaTrocarSenha: !!tenant.precisaTrocarSenha
  };
}

export async function trocarSenhaTenant(tenantId, senhaAtual, novaSenha) {
  const lista = lerListaTenants();
  const idx = lista.findIndex((t) => t.id === normalizarTenantId(tenantId));
  if (idx < 0) return { ok: false, erro: "Usuário não encontrado." };

  const tenant = lista[idx];
  const atual = await verificarCredenciaisTenant(tenant.usuario, senhaAtual);
  if (!atual.ok) return { ok: false, erro: "Senha atual incorreta." };

  const erro = validarNovaSenha(novaSenha, tenant.usuario);
  if (erro) return { ok: false, erro };
  if (senhaAtual === novaSenha) return { ok: false, erro: "A nova senha precisa ser diferente da atual." };

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashSenha(novaSenha, salt);
  lista[idx] = {
    ...tenant,
    salt,
    hash,
    precisaTrocarSenha: false,
    atualizadoEm: new Date().toISOString()
  };
  salvarListaTenants(lista);

  if (tenant.id === TENANT_PADRAO) {
    const authLegado = {
      usuario: tenant.usuario,
      salt,
      hash,
      precisaTrocarSenha: false,
      atualizadoEm: lista[idx].atualizadoEm
    };
    escreverArquivoAtomico(CAMINHO_AUTH_LEGADO, JSON.stringify(authLegado, null, 2));
    salvarChaveNoSupabase("auth_painel", authLegado);
  }

  return { ok: true };
}

function gerarIdTenantUnico(usuario, listaExistente) {
  const base = String(usuario || "cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16) || "cliente";

  let candidato = `cli_${base}_${crypto.randomBytes(2).toString("hex")}`;
  const ids = new Set(listaExistente.map((t) => t.id));
  while (ids.has(candidato) || candidato === TENANT_PADRAO) {
    candidato = `cli_${base}_${crypto.randomBytes(3).toString("hex")}`;
  }
  return candidato;
}

function validarUsuarioBasico(usuario) {
  const u = String(usuario || "").trim();
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(u)) {
    return "O usuário deve ter de 3 a 30 caracteres (apenas letras, números, ponto, _ ou -).";
  }
  return null;
}

export async function registrarContaGratuita({ nome, usuario, email = "", senha }) {
  const nomeLimpo = String(nome || "").trim();
  const usuarioLimpo = String(usuario || "").trim();
  const emailLimpo = String(email || "").trim().toLowerCase();

  if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
    return { ok: false, erro: "Informe seu nome ou nome da loja (2 a 80 caracteres)." };
  }
  const erroUsuario = validarUsuarioBasico(usuarioLimpo);
  if (erroUsuario) return { ok: false, erro: erroUsuario };

  const erroSenha = validarNovaSenha(senha, usuarioLimpo);
  if (erroSenha) return { ok: false, erro: erroSenha };

  const lista = lerListaTenants();
  if (lista.some((t) => String(t.usuario).toLowerCase() === usuarioLimpo.toLowerCase())) {
    return { ok: false, erro: "Este nome de usuário já está em uso. Escolha outro." };
  }

  const maxContasFree = Math.max(1, Number(process.env.MAX_CONTAS_FREE_ATIVAS || 10));
  const freeAtivas = lista.filter(
    (t) => t.plano === "free" && avaliarAcessoTenant(t).liberado
  ).length;
  if (freeAtivas >= maxContasFree) {
    return { ok: false, erro: "Limite temporário de contas de teste atingido. Tente novamente mais tarde." };
  }

  const agoraMs = Date.now();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashSenha(senha, salt);

  const novo = {
    id: gerarIdTenantUnico(usuarioLimpo, lista),
    nome: nomeLimpo,
    usuario: usuarioLimpo,
    email: emailLimpo,
    salt,
    hash,
    precisaTrocarSenha: false,
    papel: "cliente",
    plano: "free",
    ativo: true,
    expiraEm: somarDiasIso(agoraMs, PLANOS_SAAS.free.duracaoDiasPadrao),
    criadoEm: new Date(agoraMs).toISOString(),
    atualizadoEm: new Date(agoraMs).toISOString()
  };

  lista.push(novo);
  salvarListaTenants(lista);
  return { ok: true, tenant: sanitizarTenantPublico(novo) };
}

export async function criarClienteAdmin({
  nome,
  usuario,
  email = "",
  senha,
  plano = "pro",
  diasValidade = 30,
  precisaTrocarSenha = false
}) {
  const nomeLimpo = String(nome || "").trim();
  const usuarioLimpo = String(usuario || "").trim();
  const emailLimpo = String(email || "").trim().toLowerCase();
  const planoLimpo = plano === "free" ? "free" : "pro";

  if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
    return { ok: false, erro: "Nome do cliente inválido." };
  }
  const erroUsuario = validarUsuarioBasico(usuarioLimpo);
  if (erroUsuario) return { ok: false, erro: erroUsuario };

  const erroSenha = validarNovaSenha(senha, usuarioLimpo);
  if (erroSenha) return { ok: false, erro: erroSenha };

  const lista = lerListaTenants();
  if (lista.some((t) => String(t.usuario).toLowerCase() === usuarioLimpo.toLowerCase())) {
    return { ok: false, erro: "Já existe um cliente cadastrado com esse usuário." };
  }

  const agoraMs = Date.now();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashSenha(senha, salt);
  const dias = Number(diasValidade) > 0 ? Number(diasValidade) : planoLimpo === "free" ? 7 : 30;

  const novo = {
    id: gerarIdTenantUnico(usuarioLimpo, lista),
    nome: nomeLimpo,
    usuario: usuarioLimpo,
    email: emailLimpo,
    salt,
    hash,
    precisaTrocarSenha: !!precisaTrocarSenha,
    papel: "cliente",
    plano: planoLimpo,
    ativo: true,
    expiraEm: somarDiasIso(agoraMs, dias),
    criadoEm: new Date(agoraMs).toISOString(),
    atualizadoEm: new Date(agoraMs).toISOString()
  };

  lista.push(novo);
  salvarListaTenants(lista);
  return { ok: true, tenant: sanitizarTenantPublico(novo) };
}

export function atualizarClienteAdmin(tenantId, campos = {}) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) {
    return { ok: false, erro: "Não é permitido alterar ou suspender o Super Admin." };
  }

  const lista = lerListaTenants();
  const idx = lista.findIndex((t) => t.id === tid);
  if (idx < 0) return { ok: false, erro: "Cliente não encontrado." };

  const atual = lista[idx];
  const atualizado = {
    ...atual,
    nome: typeof campos.nome === "string" && campos.nome.trim() ? campos.nome.trim() : atual.nome,
    email: typeof campos.email === "string" ? campos.email.trim().toLowerCase() : atual.email,
    plano: campos.plano === "free" || campos.plano === "pro" ? campos.plano : atual.plano,
    ativo: campos.ativo !== undefined ? !!campos.ativo : atual.ativo,
    expiraEm: campos.expiraEm !== undefined ? campos.expiraEm : atual.expiraEm,
    atualizadoEm: new Date().toISOString()
  };

  lista[idx] = atualizado;
  salvarListaTenants(lista);
  return { ok: true, tenant: sanitizarTenantPublico(atualizado) };
}

export function renovarClienteAdmin(tenantId, dias = 30) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) {
    return { ok: false, erro: "Super Admin não possui vencimento." };
  }

  const lista = lerListaTenants();
  const idx = lista.findIndex((t) => t.id === tid);
  if (idx < 0) return { ok: false, erro: "Cliente não encontrado." };

  const atual = lista[idx];
  const expiraAtualMs = atual.expiraEm ? Date.parse(atual.expiraEm) : 0;
  const baseMs = Number.isFinite(expiraAtualMs) && expiraAtualMs > Date.now() ? expiraAtualMs : Date.now();
  const atualizado = {
    ...atual,
    ativo: true,
    expiraEm: somarDiasIso(baseMs, dias),
    atualizadoEm: new Date().toISOString()
  };

  lista[idx] = atualizado;
  salvarListaTenants(lista);
  return { ok: true, tenant: sanitizarTenantPublico(atualizado) };
}

export async function resetarSenhaClienteAdmin(tenantId, novaSenha) {
  const tid = normalizarTenantId(tenantId);
  const lista = lerListaTenants();
  const idx = lista.findIndex((t) => t.id === tid);
  if (idx < 0) return { ok: false, erro: "Cliente não encontrado." };

  const atual = lista[idx];
  const erroSenha = validarNovaSenha(novaSenha, atual.usuario);
  if (erroSenha) return { ok: false, erro: erroSenha };

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashSenha(novaSenha, salt);
  lista[idx] = {
    ...atual,
    salt,
    hash,
    precisaTrocarSenha: true,
    atualizadoEm: new Date().toISOString()
  };
  salvarListaTenants(lista);
  return { ok: true, tenant: sanitizarTenantPublico(lista[idx]) };
}

export async function excluirClienteAdmin(tenantId) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) {
    return { ok: false, erro: "Não é possível excluir a conta Super Admin." };
  }

  const lista = lerListaTenants();
  const existe = lista.some((t) => t.id === tid);
  if (!existe) return { ok: false, erro: "Cliente não encontrado." };

  const novaLista = lista.filter((t) => t.id !== tid);
  salvarListaTenants(novaLista);

  fs.rmSync(`./data/tenants/${tid}`, { recursive: true, force: true });
  fs.rmSync(pastaAuthLocalTenant(tid), { recursive: true, force: true });
  await removerDadosTenantNoSupabase(tid);

  return { ok: true };
}

export function validarAgendamentosNoPlano(agendamentos, tenant) {
  const limites = obterLimitesPlano(tenant);
  const lista = Array.isArray(agendamentos) ? agendamentos : [];

  if (lista.length > limites.maxAgendamentos) {
    return {
      ok: false,
      codigoLimite: "max_agendamentos",
      erro: `Seu ${limites.nome} permite no máximo ${limites.maxAgendamentos} agendamento(s). Faça upgrade para o Plano Pro!`
    };
  }

  for (const ag of lista) {
    const qtdGrupos = Array.isArray(ag?.grupos) ? ag.grupos.length : 0;
    const qtdContatos = Array.isArray(ag?.contatos) ? ag.contatos.length : 0;
    const qtdMidias = Array.isArray(ag?.midias) ? ag.midias.length : 0;

    if (qtdGrupos > limites.maxGruposPorAgendamento) {
      return {
        ok: false,
        codigoLimite: "max_grupos",
        erro: `Seu ${limites.nome} permite no máximo ${limites.maxGruposPorAgendamento} grupo(s) por agendamento.`
      };
    }
    if (qtdContatos > limites.maxContatosPorAgendamento) {
      return {
        ok: false,
        codigoLimite: "max_contatos",
        erro: `Seu ${limites.nome} permite no máximo ${limites.maxContatosPorAgendamento} contato(s) por agendamento.`
      };
    }
    if (qtdMidias > limites.maxMidiasPorAgendamento) {
      return {
        ok: false,
        codigoLimite: "max_midias",
        erro: `Seu ${limites.nome} permite no máximo ${limites.maxMidiasPorAgendamento} mídia(s) por agendamento.`
      };
    }
    if (ag?.midiasAleatorias && !limites.permiteRodizioMidias) {
      return {
        ok: false,
        codigoLimite: "rodizio_midias",
        erro: `O sorteio aleatório de múltiplas mídias é exclusivo do Plano Pro.`
      };
    }
  }

  return { ok: true };
}

export function validarTriagemNoPlano(dadosTriagem, tenant) {
  const limites = obterLimitesPlano(tenant);
  const provedor = String(dadosTriagem?.ia?.provedor || "local").toLowerCase().trim();
  if (provedor !== "local" && !limites.permiteIaExterna) {
    return {
      ok: false,
      codigoLimite: "ia_externa",
      erro: `Motores de IA externos (${provedor}) são exclusivos do Plano Pro. No teste gratuito use o Modo Inteligente Local.`
    };
  }
  return { ok: true };
}

export function listarTenantsAtivosParaScheduler() {
  return lerListaTenants().filter((t) => avaliarAcessoTenant(t).liberado);
}

export function listarTenantsElegiveisAutoConexao() {
  return lerListaTenants().filter(
    (t) => (t.papel === "superadmin" || t.plano === "pro") && avaliarAcessoTenant(t).liberado
  );
}
