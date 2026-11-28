import fs from "node:fs";
import { lerConfig } from "./configService.js";
import { salvarChaveNoSupabase } from "./supabaseService.js";
import { caminhoArquivoTenant, chaveSupabaseTenant, executarNoTenant, obterTenantAtual, TENANT_PADRAO } from "./tenantContext.js";
import { CONHECIMENTO_PADRAO_GAICOS, sincronizarConhecimentoSite } from "./siteKnowledgeService.js";
import {
  PROMPT_SISTEMA_PADRAO,
  CONHECIMENTO_EXTRA_PADRAO,
  gerarRespostaAtendimento,
  limparHistoricoCliente,
  clientePediuAtendenteHumano,
  listarDadosAprendizado,
  ensinarRespostaAoBot,
  removerExemploAprendizado,
  limparInteracoesRecentes
} from "./iaAtendimentoService.js";

export {
  listarDadosAprendizado,
  ensinarRespostaAoBot,
  removerExemploAprendizado,
  limparInteracoesRecentes
};

const sessoes = new Map();
const mensagensGeradasPeloBot = new Set();
const timersInatividade = new Map();
const timersEsperaHumano = new Map();
const ultimoAutoSyncPorTenant = new Map();

function chaveSessao(jid) {
  return `${obterTenantAtual()}:${jid}`;
}

function normalizarTelefoneAlerta(valor) {
  let digits = String(valor || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  if (digits.length < 10 || digits.length > 15) return "";
  return digits;
}

function mesmaPessoaTelefoneOuJid(telA, jidA, telB, jidB) {
  if (jidA && jidB && String(jidA) === String(jidB)) return true;
  const a = normalizarTelefoneAlerta(telA);
  const b = normalizarTelefoneAlerta(telB);
  return Boolean(a && b && a === b);
}

function padraoIa() {
  const ehAdmin = obterTenantAtual() === TENANT_PADRAO;
  return {
    ativa: true,
    provedor: "local", // "local" | "gemini" | "groq" | "openai"
    apiKey: "",
    modelo: "",
    nomeBot: ehAdmin ? "Gaicos Jr" : "Assistente Virtual",
    nomeResponsavel: ehAdmin ? "Gaicos" : "nosso especialista",
    telefoneAlertaHumano: "",
    minutosSemInteracaoAlerta: 10,
    minutosEsperaHumanoAviso: 60,
    mensagemEsperaHumano: ehAdmin
      ? "Olá! Passando rapidinho para avisar que o *Gaicos* está finalizando alguns playmats por aqui, mas assim que puder ele já vem te atender de forma personalizada! Muito obrigado pela paciência 😊"
      : "Olá! Passando para avisar que nosso especialista já vai continuar seu atendimento de forma personalizada assim que finalizar por aqui! Muito obrigado pela paciência 😊",
    urlSite: ehAdmin ? "https://www.gaicos-store.com.br/" : "",
    conhecimentoSite: ehAdmin ? CONHECIMENTO_PADRAO_GAICOS : "",
    conhecimentoExtra: ehAdmin ? CONHECIMENTO_EXTRA_PADRAO : "",
    catalogoProdutos: [],
    ultimaSincronizacao: null,
    promptSistema: ehAdmin
      ? PROMPT_SISTEMA_PADRAO
      : "Você é um consultor de vendas educado, cordial e persuasivo. Responda em 2 a 4 linhas curtas com base no site e chame um humano com [CHAMAR_ATENDENTE] se não tiver certeza.",
    mensagemTransferenciaHumano: ehAdmin
      ? "Perfeito! Vou chamar o *Gaicos em pessoa* para te atender certinho por aqui. Só um instante, por favor! 😊"
      : "Perfeito! Vou chamar um especialista em pessoa para te atender certinho por aqui. Só um instante, por favor! 😊",
    horasPausaHumano: 24,
    pausarAoResponderManual: false,
    avisarGrupoControle: true
  };
}

function ehPromptLegado(txt) {
  return /^Você é o atendente virtual da Gaicos Store|^Você é o Gaicos Jr, vendedor especialista da Gaicos Store/i.test(String(txt || "").trim());
}

function ehMensagemTransferenciaLegada(txt) {
  return /^Perfeito! Já chamei um atendente humano da \*Gaicos Store\*/i.test(String(txt || "").trim());
}

function normalizarDadosTriagem(bruto = {}) {
  const iaPadrao = padraoIa();
  const iaBruto = (bruto && typeof bruto.ia === "object" && bruto.ia) ? bruto.ia : {};
  const minInat = Number(iaBruto.minutosSemInteracaoAlerta);
  const minEsp = Number(iaBruto.minutosEsperaHumanoAviso);
  const provedor = ["local", "gemini", "groq", "openai"].includes(iaBruto.provedor) ? iaBruto.provedor : iaPadrao.provedor;
  let modelo = typeof iaBruto.modelo === "string" ? iaBruto.modelo.trim() : "";
  if (provedor === "groq" && (!modelo || modelo === "llama-3.3-70b-versatile")) {
    modelo = "openai/gpt-oss-120b";
  }

  const promptRaw = typeof iaBruto.promptSistema === "string" ? iaBruto.promptSistema.trim() : "";
  const msgTransfRaw = typeof iaBruto.mensagemTransferenciaHumano === "string" ? iaBruto.mensagemTransferenciaHumano.trim() : "";

  return {
    ativo: !!bruto?.ativo,
    boasVindas: typeof bruto?.boasVindas === "string" ? bruto.boasVindas : "",
    nodeInicial: bruto?.nodeInicial || null,
    nodes: Array.isArray(bruto?.nodes) ? bruto.nodes : [],
    ia: {
      ativa: iaBruto.ativa !== undefined ? !!iaBruto.ativa : iaPadrao.ativa,
      provedor,
      apiKey: typeof iaBruto.apiKey === "string" ? iaBruto.apiKey : "",
      modelo,
      nomeBot: typeof iaBruto.nomeBot === "string" && iaBruto.nomeBot.trim() ? iaBruto.nomeBot.trim() : iaPadrao.nomeBot,
      nomeResponsavel: typeof iaBruto.nomeResponsavel === "string" && iaBruto.nomeResponsavel.trim()
        ? iaBruto.nomeResponsavel.trim()
        : iaPadrao.nomeResponsavel,
      telefoneAlertaHumano: normalizarTelefoneAlerta(iaBruto.telefoneAlertaHumano || ""),
      minutosSemInteracaoAlerta: Number.isFinite(minInat) ? Math.max(0, Math.min(1440, minInat)) : iaPadrao.minutosSemInteracaoAlerta,
      minutosEsperaHumanoAviso: Number.isFinite(minEsp) ? Math.max(0, Math.min(1440, minEsp)) : iaPadrao.minutosEsperaHumanoAviso,
      mensagemEsperaHumano: typeof iaBruto.mensagemEsperaHumano === "string" && iaBruto.mensagemEsperaHumano.trim()
        ? iaBruto.mensagemEsperaHumano.trim()
        : iaPadrao.mensagemEsperaHumano,
      urlSite: typeof iaBruto.urlSite === "string" && iaBruto.urlSite.trim() ? iaBruto.urlSite.trim() : iaPadrao.urlSite,
      conhecimentoSite: typeof iaBruto.conhecimentoSite === "string" && iaBruto.conhecimentoSite.trim()
        ? iaBruto.conhecimentoSite
        : iaPadrao.conhecimentoSite,
      conhecimentoExtra: typeof iaBruto.conhecimentoExtra === "string"
        ? iaBruto.conhecimentoExtra
        : iaPadrao.conhecimentoExtra,
      catalogoProdutos: Array.isArray(iaBruto.catalogoProdutos) ? iaBruto.catalogoProdutos.slice(0, 100) : [],
      ultimaSincronizacao: iaBruto.ultimaSincronizacao || null,
      promptSistema: promptRaw && !ehPromptLegado(promptRaw) ? promptRaw : iaPadrao.promptSistema,
      mensagemTransferenciaHumano: msgTransfRaw && !ehMensagemTransferenciaLegada(msgTransfRaw)
        ? msgTransfRaw
        : iaPadrao.mensagemTransferenciaHumano,
      horasPausaHumano: Number(iaBruto.horasPausaHumano) > 0 ? Number(iaBruto.horasPausaHumano) : 24,
      pausarAoResponderManual: !!iaBruto.pausarAoResponderManual,
      avisarGrupoControle: iaBruto.avisarGrupoControle !== false
    }
  };
}

function lerArquivo() {
  const caminho = caminhoArquivoTenant("triagem.json");
  if (!fs.existsSync(caminho)) return normalizarDadosTriagem({});
  try {
    return normalizarDadosTriagem(JSON.parse(fs.readFileSync(caminho, "utf-8")));
  } catch {
    return normalizarDadosTriagem({});
  }
}

function salvarArquivoAtomico(dados) {
  const caminho = caminhoArquivoTenant("triagem.json");
  const temporario = `${caminho}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), "utf-8");
  fs.renameSync(temporario, caminho);
  salvarChaveNoSupabase(chaveSupabaseTenant("triagem"), dados);
}

function lerPausasArquivo() {
  const caminhoPausas = caminhoArquivoTenant("pausasTriagem.json");
  if (!fs.existsSync(caminhoPausas)) return {};
  try {
    const dados = JSON.parse(fs.readFileSync(caminhoPausas, "utf-8"));
    return (dados && typeof dados === "object") ? dados : {};
  } catch {
    return {};
  }
}

function salvarPausasArquivo(pausas) {
  try {
    const caminhoPausas = caminhoArquivoTenant("pausasTriagem.json");
    const temporario = `${caminhoPausas}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(pausas, null, 2), "utf-8");
    fs.renameSync(temporario, caminhoPausas);
    salvarChaveNoSupabase(chaveSupabaseTenant("pausasTriagem"), pausas);
  } catch {}
}

export function listarPausasHumano() {
  const pausas = lerPausasArquivo();
  const agora = Date.now();
  let alterou = false;
  const ativas = [];

  for (const [jid, info] of Object.entries(pausas)) {
    if (!info || (info.expiraEm && info.expiraEm <= agora)) {
      delete pausas[jid];
      alterou = true;
    } else {
      ativas.push({ jid, ...info });
    }
  }

  if (alterou) salvarPausasArquivo(pausas);
  return ativas.sort((a, b) => (b.pausadoEm || 0) - (a.pausadoEm || 0));
}

export function clienteEstaPausado(jid) {
  const pausas = lerPausasArquivo();
  const info = pausas[jid];
  if (!info) return false;
  if (info.expiraEm && info.expiraEm <= Date.now()) {
    delete pausas[jid];
    salvarPausasArquivo(pausas);
    return false;
  }
  return true;
}

export function pausarAtendimentoHumano(jid, { telefone = "", nome = "", motivo = "Atendimento humano", ultimaMensagem = "", horas = 24 } = {}) {
  if (!jid) return;
  const pausas = lerPausasArquivo();
  const agora = Date.now();
  const duracaoHoras = Math.max(1, Math.min(8760, Number(horas) || 24));
  const telLimpo = (telefone || String(jid).replace(/@.*$/, "")).replace(/\D/g, "");
  pausas[jid] = {
    telefone: telLimpo,
    nome: nome || telLimpo,
    motivo,
    ultimaMensagem: String(ultimaMensagem || "").slice(0, 300),
    pausadoEm: agora,
    expiraEm: agora + duracaoHoras * 3600 * 1000
  };
  salvarPausasArquivo(pausas);
  sessoes.delete(chaveSessao(jid));
}

export function reativarAtendimentoBot(jid) {
  const pausas = lerPausasArquivo();
  if (jid === "todos") {
    salvarPausasArquivo({});
    return;
  }
  cancelarTimerEsperaHumano(jid);
  cancelarTimerInatividade(jid);
  delete pausas[jid];
  salvarPausasArquivo(pausas);
  limparHistoricoCliente(jid);
}

export function lerTriagem() {
  return lerArquivo();
}

export function salvarTriagem(dados) {
  const valido = validarTriagem(dados);
  if (!valido.ok) throw new Error(valido.erro);
  const atual = lerArquivo();
  const mesclado = {
    ...dados,
    ia: {
      ...(atual.ia || {}),
      ...(dados.ia || {}),
      catalogoProdutos: Array.isArray(dados?.ia?.catalogoProdutos)
        ? dados.ia.catalogoProdutos
        : (atual.ia?.catalogoProdutos || [])
    }
  };
  const normalizado = normalizarDadosTriagem(mesclado);
  salvarArquivoAtomico(normalizado);
  return normalizado;
}

export function validarTriagem(dados) {
  if (!dados || typeof dados !== "object") return { ok: false, erro: "Configuração inválida." };
  if (typeof dados.boasVindas !== "string" || dados.boasVindas.length > 4000) {
    return { ok: false, erro: "A mensagem de boas-vindas deve ter até 4000 caracteres." };
  }
  if (!Array.isArray(dados.nodes) || dados.nodes.length > 100) {
    return { ok: false, erro: "O fluxo pode ter até 100 perguntas." };
  }

  const ids = new Set();
  for (const node of dados.nodes) {
    if (!node?.id || ids.has(node.id)) return { ok: false, erro: "Todas as perguntas precisam de um ID único." };
    if (typeof node.titulo !== "string") return { ok: false, erro: "Preencha o título de todas as perguntas." };
    if (typeof node.texto !== "string" || node.texto.length > 4000) return { ok: false, erro: "Cada pergunta deve ter uma mensagem válida." };
    if (!Array.isArray(node.opcoes) || node.opcoes.length < 1 || node.opcoes.length > 9) {
      return { ok: false, erro: "Cada pergunta deve ter de 1 a 9 opções." };
    }
    ids.add(node.id);
  }

  for (const node of dados.nodes) {
    for (const [indice, opcao] of node.opcoes.entries()) {
      if (!opcao?.texto || typeof opcao.texto !== "string") return { ok: false, erro: "Todas as opções precisam de texto." };
      if (opcao.proxima && !ids.has(opcao.proxima)) return { ok: false, erro: "Uma opção aponta para uma pergunta inexistente." };
      opcao.numero = indice + 1;
    }
  }

  if (dados.nodeInicial && !ids.has(dados.nodeInicial)) {
    return { ok: false, erro: "A pergunta inicial não existe." };
  }

  if (dados.ia && typeof dados.ia === "object") {
    if (typeof dados.ia.conhecimentoSite === "string" && dados.ia.conhecimentoSite.length > 40000) {
      return { ok: false, erro: "A base de conhecimento do site deve ter no máximo 40.000 caracteres." };
    }
    if (typeof dados.ia.conhecimentoExtra === "string" && dados.ia.conhecimentoExtra.length > 25000) {
      return { ok: false, erro: "O conhecimento extra deve ter no máximo 25.000 caracteres." };
    }
    if (typeof dados.ia.promptSistema === "string" && dados.ia.promptSistema.length > 10000) {
      return { ok: false, erro: "As instruções do sistema devem ter no máximo 10.000 caracteres." };
    }
  }

  return { ok: true };
}

export async function sincronizarSiteNaTriagem(urlOpcional) {
  const atual = lerArquivo();
  const urlAlvo = urlOpcional || atual.ia?.urlSite || "https://www.gaicos-store.com.br/";
  const resultado = await sincronizarConhecimentoSite(urlAlvo);
  atual.ia.urlSite = resultado.urlSite;
  atual.ia.conhecimentoSite = resultado.conhecimentoSite;
  atual.ia.catalogoProdutos = Array.isArray(resultado.produtos) ? resultado.produtos : [];
  atual.ia.ultimaSincronizacao = resultado.ultimaSincronizacao;
  salvarArquivoAtomico(atual);
  return {
    ...resultado,
    dados: atual
  };
}

export async function simularAtendimentoTriagem(mensagem, configIaOpcional = null) {
  const atual = lerArquivo();
  const cfgIa = configIaOpcional ? { ...atual.ia, ...configIaOpcional } : atual.ia;
  return await gerarRespostaAtendimento({
    jid: "simulacao-painel",
    mensagemCliente: mensagem,
    configIa: cfgIa
  });
}

function montarTexto(node, iaAtiva = false) {
  const linhas = [node.texto.trim(), ""];
  node.opcoes.forEach((opcao) => linhas.push(`${opcao.numero}. ${opcao.texto.trim()}`));
  if (iaAtiva) {
    linhas.push("", "Digite o número da opção ou escreva sua dúvida livremente (digite *atendente* para falar com nossa equipe).");
  } else {
    linhas.push("", "Digite apenas o número da opção.");
  }
  return linhas.join("\n");
}

export function resetarSessaoTriagem(jid) {
  sessoes.delete(chaveSessao(jid));
  limparHistoricoCliente(jid);
}

function ehConversaPrivada(remoteJid) {
  if (!remoteJid || typeof remoteJid !== "string") return false;
  if (remoteJid === "status@broadcast" || remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@newsletter")) {
    return false;
  }
  return remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@lid");
}

function extrairTelefoneCliente(msg) {
  const candidatos = [
    msg?.key?.senderPn,
    msg?.key?.remoteJidAlt,
    msg?.participant,
    msg?.key?.remoteJid
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.endsWith("@s.whatsapp.net")) {
      return c.replace(/@.*$/, "").replace(/\D/g, "");
    }
  }
  return String(msg?.key?.remoteJid || "").replace(/@.*$/, "").replace(/\D/g, "");
}

function desempacotarMensagem(m) {
  if (!m || typeof m !== "object") return {};
  if (m.ephemeralMessage?.message) return desempacotarMensagem(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return desempacotarMensagem(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return desempacotarMensagem(m.viewOnceMessageV2.message);
  if (m.deviceSentMessage?.message) return desempacotarMensagem(m.deviceSentMessage.message);
  if (m.editedMessage?.message?.protocolMessage?.editedMessage) {
    return desempacotarMensagem(m.editedMessage.message.protocolMessage.editedMessage);
  }
  return m;
}

function extrairTextoMensagem(msg) {
  const m = desempacotarMensagem(msg?.message);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  ).trim();
}

function ehMensagemMidiaSemTexto(msg) {
  const m = desempacotarMensagem(msg?.message);
  return Boolean(
    m.audioMessage ||
    m.imageMessage ||
    m.videoMessage ||
    m.documentMessage ||
    m.documentWithCaptionMessage ||
    m.stickerMessage
  );
}

async function enviarMensagemBot(sock, jid, conteudo) {
  const enviado = await sock.sendMessage(jid, conteudo);
  if (enviado?.key?.id) {
    mensagensGeradasPeloBot.add(enviado.key.id);
    if (mensagensGeradasPeloBot.size > 500) {
      const primeiro = mensagensGeradasPeloBot.values().next().value;
      mensagensGeradasPeloBot.delete(primeiro);
    }
  }
  return enviado;
}

export async function notificarErroGrupoControle(sock, { contexto = "Triagem IA", erro = "", nomeCliente = "" } = {}) {
  try {
    const configGeral = lerConfig();
    const grupoId = configGeral?.grupoControleId;
    if (!grupoId || !sock) return;
    const textoErro =
      `⚠️ *Erro técnico interno (${contexto})*\n` +
      (nomeCliente ? `👤 *Cliente:* ${nomeCliente}\n` : "") +
      `🛠️ *Detalhe:* ${String(erro || "Falha desconhecida").slice(0, 400)}\n` +
      `_Mensagem mantida oculta para o cliente._`;
    await enviarMensagemBot(sock, grupoId, { text: textoErro });
  } catch {}
}

export async function notificarResponsavelHumano(
  sock,
  configIa = {},
  { jidCliente, telefoneCliente, nomeCliente, ultimaMensagem, motivo = "Solicitou atendimento humano", horasPausa = 24, pausouBot = true } = {}
) {
  const tel = telefoneCliente || String(jidCliente || "").replace(/@.*$/, "").replace(/\D/g, "");
  const linkWa = jidCliente?.endsWith("@s.whatsapp.net") || (tel.length >= 10 && tel.length <= 13)
    ? `https://wa.me/${tel}`
    : `Chat privado (${nomeCliente || tel})`;

  const textoAlerta =
    `🛎️ *Chamado para o ${configIa?.nomeResponsavel || "Gaicos"} em pessoa*\n\n` +
    `📌 *Motivo:* ${motivo}\n` +
    `👤 *Cliente:* ${nomeCliente || tel}\n` +
    `📱 *Contato:* ${linkWa}\n` +
    `💬 *Última msg:* "${String(ultimaMensagem || "").slice(0, 300)}"\n\n` +
    (pausouBot
      ? `⏸️ _Robô pausado para este cliente por ${horasPausa}h._`
      : `⚡ _Vale chamar o cliente pessoalmente para fechar a venda!_`);

  const destinosEnviados = new Set();

  // Nunca envia o alerta interno para o próprio número/chat do cliente
  const telAlerta = normalizarTelefoneAlerta(configIa?.telefoneAlertaHumano);
  if (telAlerta && !mesmaPessoaTelefoneOuJid(telAlerta, `${telAlerta}@s.whatsapp.net`, tel, jidCliente)) {
    let jidAlerta = `${telAlerta}@s.whatsapp.net`;
    if (typeof sock?.onWhatsApp === "function") {
      try {
        const res = await sock.onWhatsApp(telAlerta);
        if (Array.isArray(res) && res[0]?.jid) jidAlerta = res[0].jid;
      } catch {}
    }
    if (!mesmaPessoaTelefoneOuJid(telAlerta, jidAlerta, tel, jidCliente)) {
      try {
        await enviarMensagemBot(sock, jidAlerta, { text: textoAlerta });
        destinosEnviados.add(jidAlerta);
      } catch (err) {
        console.log("Aviso: não foi possível enviar alerta direto no WhatsApp configurado:", err.message);
      }
    }
  }

  // Grupo de Controle sempre recebe os chamados e nunca expõe nada ao cliente
  if (configIa?.avisarGrupoControle !== false) {
    try {
      const configGeral = lerConfig();
      const grupoId = configGeral?.grupoControleId;
      if (grupoId && grupoId !== jidCliente && !destinosEnviados.has(grupoId)) {
        await enviarMensagemBot(sock, grupoId, { text: textoAlerta });
      }
    } catch (err) {
      console.log("Aviso: não foi possível notificar o grupo de controle:", err.message);
    }
  }
}

function cancelarTimerInatividade(jid) {
  const chave = chaveSessao(jid);
  const timer = timersInatividade.get(chave);
  if (timer) {
    clearTimeout(timer);
    timersInatividade.delete(chave);
  }
}

export function cancelarTimerEsperaHumano(jid) {
  const chave = chaveSessao(jid);
  const timer = timersEsperaHumano.get(chave);
  if (timer) {
    clearTimeout(timer);
    timersEsperaHumano.delete(chave);
  }
}

/**
 * Se o responsável não responder após a escalação em 1 hora (60 min), envia uma única
 * mensagem educada de espera para o cliente, reforça no Grupo de Controle e inicia
 * a pausa completa (ex: 8000h) sem enviar mais nada.
 */
export function agendarAvisoEsperaHumano(
  sock,
  configIa = {},
  { jid, telefoneCliente, nomeCliente, ultimaMensagem = "", horasPausa = 24, delayMsOverride = null } = {}
) {
  cancelarTimerEsperaHumano(jid);
  const minutosEspera = Number(configIa?.minutosEsperaHumanoAviso ?? 60);
  const delayMs = Number.isFinite(delayMsOverride)
    ? delayMsOverride
    : (minutosEspera > 0 ? Math.min(minutosEspera, 1440) * 60 * 1000 : 0);
  if (delayMs <= 0 || !sock || !jid) return;

  const tid = obterTenantAtual();
  const chave = `${tid}:${jid}`;

  const timer = setTimeout(() => {
    timersEsperaHumano.delete(chave);
    executarNoTenant(tid, async () => {
      if (!clienteEstaPausado(jid)) return;
      const cfgAtual = lerArquivo();
      const msgEspera = String(cfgAtual.ia?.mensagemEsperaHumano || configIa?.mensagemEsperaHumano || "").trim()
        || `Olá! Passando rapidinho para avisar que o *${cfgAtual.ia?.nomeResponsavel || "Gaicos"}* está finalizando alguns playmats por aqui, mas assim que puder ele já vem te atender de forma personalizada! Muito obrigado pela paciência 😊`;

      try {
        await enviarMensagemBot(sock, jid, { text: msgEspera });
      } catch {}

      const horasFinais = cfgAtual.ia?.horasPausaHumano || horasPausa || 24;
      pausarAtendimentoHumano(jid, {
        telefone: telefoneCliente,
        nome: nomeCliente,
        motivo: `Aviso de 1h enviado — aguardando atendimento (${horasFinais}h pausado)`,
        ultimaMensagem,
        horas: horasFinais
      });

      await notificarResponsavelHumano(sock, cfgAtual.ia, {
        jidCliente: jid,
        telefoneCliente,
        nomeCliente,
        ultimaMensagem,
        motivo: `Cliente aguardando resposta há ${minutosEspera} min (aviso educado enviado; bot silenciado por ${horasFinais}h)`,
        horasPausa: horasFinais,
        pausouBot: true
      });
    }).catch(() => {});
  }, delayMs);

  timer.unref?.();
  timersEsperaHumano.set(chave, timer);
}

function agendarAlertaFaltaInteracao(sock, configIa, { jid, telefoneCliente, nomeCliente, ultimaMensagem }) {
  cancelarTimerInatividade(jid);
  const minutos = Number(configIa?.minutosSemInteracaoAlerta) || 0;
  if (minutos <= 0) return;

  const temDestinoAlerta = Boolean(
    normalizarTelefoneAlerta(configIa?.telefoneAlertaHumano) ||
    configIa?.avisarGrupoControle !== false
  );
  if (!temDestinoAlerta) return;

  const tid = obterTenantAtual();
  const chave = `${tid}:${jid}`;
  const delayMs = Math.min(minutos, 1440) * 60 * 1000;

  const timer = setTimeout(() => {
    timersInatividade.delete(chave);
    executarNoTenant(tid, async () => {
      if (clienteEstaPausado(jid)) return;
      const cfgAtual = lerArquivo();
      if (!cfgAtual.ativo || !cfgAtual.ia?.ativa) return;
      await notificarResponsavelHumano(sock, cfgAtual.ia, {
        jidCliente: jid,
        telefoneCliente,
        nomeCliente,
        ultimaMensagem,
        motivo: `Cliente sem interação há ${minutos} min — vale chamar pessoalmente`,
        horasPausa: cfgAtual.ia?.horasPausaHumano || 24,
        pausouBot: false
      });
    }).catch(() => {});
  }, delayMs);

  timer.unref?.();
  timersInatividade.set(chave, timer);
}

async function tentarAutoSincronizarCatalogo(config) {
  const tid = obterTenantAtual();
  const agora = Date.now();
  const ultimo = ultimoAutoSyncPorTenant.get(tid) || 0;
  if (agora - ultimo < 10 * 60 * 1000) return config;
  ultimoAutoSyncPorTenant.set(tid, agora);
  try {
    const sync = await Promise.race([
      sincronizarSiteNaTriagem(config.ia.urlSite),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
    ]);
    return sync?.dados || lerArquivo();
  } catch {
    return config;
  }
}

async function acionarEscalacaoParaHumano(sock, config, { jid, telefoneCliente, nomeContato, texto, motivo, respostaCliente }) {
  const horas = config.ia?.horasPausaHumano || 24;
  cancelarTimerInatividade(jid);
  pausarAtendimentoHumano(jid, {
    telefone: telefoneCliente,
    nome: nomeContato,
    motivo,
    ultimaMensagem: texto,
    horas
  });
  await enviarMensagemBot(sock, jid, { text: respostaCliente });
  await notificarResponsavelHumano(sock, config.ia, {
    jidCliente: jid,
    telefoneCliente,
    nomeCliente: nomeContato,
    ultimaMensagem: texto,
    motivo,
    horasPausa: horas,
    pausouBot: true
  });
  agendarAvisoEsperaHumano(sock, config.ia, {
    jid,
    telefoneCliente,
    nomeCliente: nomeContato,
    ultimaMensagem: texto,
    horasPausa: horas
  });
}

export async function processarTriagem(sock, msg) {
  let config = lerArquivo();
  if (!config.ativo) return false;
  if (!msg?.message || !ehConversaPrivada(msg.key?.remoteJid)) return false;

  const jid = msg.key.remoteJid;
  const telefoneCliente = extrairTelefoneCliente(msg);
  const texto = extrairTextoMensagem(msg);

  // Se a mensagem foi enviada pelo próprio aparelho do bot (fromMe):
  if (msg.key.fromMe) {
    const idMsg = msg.key.id;
    if (idMsg && mensagensGeradasPeloBot.has(idMsg)) {
      return false;
    }
    cancelarTimerInatividade(jid);
    cancelarTimerEsperaHumano(jid);
    if (/^#bot$/i.test(texto)) {
      reativarAtendimentoBot(jid);
      return false;
    }
    if (/^#pausar$/i.test(texto) || (config.ia?.pausarAoResponderManual && texto)) {
      pausarAtendimentoHumano(jid, {
        telefone: telefoneCliente,
        nome: telefoneCliente,
        motivo: "Atendente respondeu manualmente pelo WhatsApp",
        ultimaMensagem: texto,
        horas: config.ia?.horasPausaHumano || 24
      });
    }
    return false;
  }

  cancelarTimerInatividade(jid);

  const iaAtiva = !!config.ia?.ativa;
  const temMenuInicial = !!(config.nodeInicial && config.nodes.some(n => n.id === config.nodeInicial));
  const nomeContato = msg.pushName || telefoneCliente || jid.replace(/@.*$/, "");

  // Se mandou áudio, imagem, figurinha ou arquivo sem legenda: escala imediatamente para o responsável
  if (!texto) {
    if (iaAtiva && ehMensagemMidiaSemTexto(msg) && !clienteEstaPausado(jid)) {
      const responsavel = config.ia?.nomeResponsavel || "Gaicos";
      await acionarEscalacaoParaHumano(sock, config, {
        jid,
        telefoneCliente,
        nomeContato,
        texto: "[Enviou mídia/áudio]",
        motivo: "Enviou áudio/imagem (atenção humana)",
        respostaCliente: `Recebi seu arquivo aqui! Vou chamar o *${responsavel} em pessoa* para olhar direitinho e te responder por aqui. Só um instante, por favor! 😊`
      });
      return true;
    }
    return false;
  }

  const pediuReinicio = /^(\/?start|#bot)$/i.test(texto);

  if (clienteEstaPausado(jid)) {
    if (pediuReinicio) {
      reativarAtendimentoBot(jid);
    } else {
      return false;
    }
  }

  if (!iaAtiva && !temMenuInicial) return false;

  console.log(`💬 [Triagem] Mensagem recebida de ${nomeContato} (${jid}): "${texto.slice(0, 80)}"`);

  if (iaAtiva && config.ia?.urlSite && (!Array.isArray(config.ia.catalogoProdutos) || config.ia.catalogoProdutos.length === 0)) {
    config = await tentarAutoSincronizarCatalogo(config);
  }

  if (iaAtiva && clientePediuAtendenteHumano(texto)) {
    const msgHumano = config.ia?.mensagemTransferenciaHumano
      || `Perfeito! Vou chamar o *${config.ia?.nomeResponsavel || "Gaicos"} em pessoa* para te atender certinho por aqui. Só um instante, por favor! 😊`;
    await acionarEscalacaoParaHumano(sock, config, {
      jid,
      telefoneCliente,
      nomeContato,
      texto,
      motivo: "Cliente solicitou atendimento humano",
      respostaCliente: msgHumano
    });
    return true;
  }

  const nodeAtualId = sessoes.get(chaveSessao(jid));
  const ehSaudacaoCurta = /^(oi+|ola+|olá+|opa+|bom dia|boa tarde|boa noite|menu|\/?start|#bot)$/i.test(texto);

  if (temMenuInicial && (!nodeAtualId || pediuReinicio) && (ehSaudacaoCurta || !iaAtiva)) {
    sessoes.set(chaveSessao(jid), config.nodeInicial);
    let resposta = config.boasVindas?.trim();
    const node = config.nodes.find(item => item.id === config.nodeInicial);
    if (!node) return true;
    resposta = resposta ? `${resposta}\n\n${montarTexto(node, iaAtiva)}` : montarTexto(node, iaAtiva);
    await enviarMensagemBot(sock, jid, { text: resposta });
    agendarAlertaFaltaInteracao(sock, config.ia, { jid, telefoneCliente, nomeCliente: nomeContato, ultimaMensagem: texto });
    return true;
  }

  if (nodeAtualId && /^([1-9])$/.test(texto)) {
    const numero = Number.parseInt(texto, 10);
    const node = config.nodes.find(item => item.id === nodeAtualId);
    if (node) {
      const opcao = node.opcoes.find(item => item.numero === numero);
      if (!opcao) {
        await enviarMensagemBot(sock, jid, { text: `Escolha uma opção entre 1 e ${node.opcoes.length}.\n\n${montarTexto(node, iaAtiva)}` });
        return true;
      }

      if (opcao.resposta) {
        await enviarMensagemBot(sock, jid, { text: opcao.resposta });
      }

      if (clientePediuAtendenteHumano(opcao.texto) || /atendente|humano/i.test(opcao.texto)) {
        const msgMenu = opcao.resposta
          ? null
          : (config.ia?.mensagemTransferenciaHumano || "Vou chamar o responsável em pessoa para te atender!");
        if (msgMenu) {
          await acionarEscalacaoParaHumano(sock, config, {
            jid,
            telefoneCliente,
            nomeContato,
            texto: `Escolheu opção: ${opcao.texto}`,
            motivo: `Menu: ${opcao.texto}`,
            respostaCliente: msgMenu
          });
        } else {
          const horas = config.ia?.horasPausaHumano || 24;
          pausarAtendimentoHumano(jid, {
            telefone: telefoneCliente,
            nome: nomeContato,
            motivo: `Menu: ${opcao.texto}`,
            ultimaMensagem: opcao.texto,
            horas
          });
          await notificarResponsavelHumano(sock, config.ia, {
            jidCliente: jid,
            telefoneCliente,
            nomeCliente: nomeContato,
            ultimaMensagem: `Escolheu opção: ${opcao.texto}`,
            motivo: `Menu: ${opcao.texto}`,
            horasPausa: horas,
            pausouBot: true
          });
          agendarAvisoEsperaHumano(sock, config.ia, {
            jid,
            telefoneCliente,
            nomeCliente: nomeContato,
            ultimaMensagem: opcao.texto,
            horasPausa: horas
          });
        }
        return true;
      }

      if (!opcao.proxima) {
        sessoes.delete(chaveSessao(jid));
        return true;
      }

      const proximo = config.nodes.find(item => item.id === opcao.proxima);
      if (!proximo) {
        sessoes.delete(chaveSessao(jid));
        await enviarMensagemBot(sock, jid, { text: "Esta etapa não está disponível. Digite start para recomeçar." });
        return true;
      }
      sessoes.set(chaveSessao(jid), proximo.id);
      await enviarMensagemBot(sock, jid, { text: montarTexto(proximo, iaAtiva) });
      return true;
    }
  }

  if (iaAtiva) {
    try {
      const resultadoIa = await gerarRespostaAtendimento({
        jid,
        nomeCliente: nomeContato,
        mensagemCliente: texto,
        configIa: config.ia
      });

      if (resultadoIa.erroApi) {
        await notificarErroGrupoControle(sock, {
          contexto: "Motor IA",
          erro: resultadoIa.erroApi,
          nomeCliente: nomeContato
        });
      }

      if (resultadoIa.chamarAtendente) {
        await acionarEscalacaoParaHumano(sock, config, {
          jid,
          telefoneCliente,
          nomeContato,
          texto,
          motivo: resultadoIa.motivoEscalacao || "Bot solicitou atenção do responsável",
          respostaCliente: resultadoIa.resposta
        });
        return true;
      }

      await enviarMensagemBot(sock, jid, { text: resultadoIa.resposta });
      agendarAlertaFaltaInteracao(sock, config.ia, {
        jid,
        telefoneCliente,
        nomeCliente: nomeContato,
        ultimaMensagem: texto
      });
      return true;
    } catch (err) {
      await notificarErroGrupoControle(sock, {
        contexto: "Processamento Triagem",
        erro: err?.message || String(err),
        nomeCliente: nomeContato
      });
      await acionarEscalacaoParaHumano(sock, config, {
        jid,
        telefoneCliente,
        nomeContato,
        texto,
        motivo: "Falha interna — encaminhado ao responsável sem expor erro",
        respostaCliente: config.ia?.mensagemTransferenciaHumano
          || `Perfeito! Vou chamar o *${config.ia?.nomeResponsavel || "Gaicos"} em pessoa* para te atender certinho por aqui. Só um instante, por favor! 😊`
      });
      return true;
    }
  }

  const nodeFallback = config.nodes.find(item => item.id === nodeAtualId) || config.nodes[0];
  await enviarMensagemBot(sock, jid, { text: `Resposta inválida. ${montarTexto(nodeFallback, false)}` });
  return true;
}
