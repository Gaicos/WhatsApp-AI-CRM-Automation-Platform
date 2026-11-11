import fs from "node:fs";
import { lerConfig } from "./configService.js";
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

const CAMINHO = "./data/triagem.json";
const CAMINHO_PAUSAS = "./data/pausasTriagem.json";
const sessoes = new Map();
const mensagensGeradasPeloBot = new Set();

function padraoIa() {
  return {
    ativa: true,
    provedor: "local", // "local" | "gemini" | "groq" | "openai"
    apiKey: "",
    modelo: "",
    urlSite: "https://www.gaicos-store.com.br/",
    conhecimentoSite: CONHECIMENTO_PADRAO_GAICOS,
    conhecimentoExtra: CONHECIMENTO_EXTRA_PADRAO,
    ultimaSincronizacao: null,
    promptSistema: PROMPT_SISTEMA_PADRAO,
    mensagemTransferenciaHumano:
      "Perfeito! Já chamei um atendente humano da *Gaicos Store* para falar com você. Aguarde só um instante que já te respondemos por aqui! 👤",
    horasPausaHumano: 24,
    pausarAoResponderManual: false,
    avisarGrupoControle: true
  };
}

function normalizarDadosTriagem(bruto = {}) {
  const iaPadrao = padraoIa();
  const iaBruto = (bruto && typeof bruto.ia === "object" && bruto.ia) ? bruto.ia : {};
  return {
    ativo: !!bruto?.ativo,
    boasVindas: typeof bruto?.boasVindas === "string" ? bruto.boasVindas : "",
    nodeInicial: bruto?.nodeInicial || null,
    nodes: Array.isArray(bruto?.nodes) ? bruto.nodes : [],
    ia: {
      ativa: iaBruto.ativa !== undefined ? !!iaBruto.ativa : iaPadrao.ativa,
      provedor: ["local", "gemini", "groq", "openai"].includes(iaBruto.provedor) ? iaBruto.provedor : iaPadrao.provedor,
      apiKey: typeof iaBruto.apiKey === "string" ? iaBruto.apiKey : "",
      modelo: typeof iaBruto.modelo === "string" ? iaBruto.modelo : "",
      urlSite: typeof iaBruto.urlSite === "string" && iaBruto.urlSite.trim() ? iaBruto.urlSite.trim() : iaPadrao.urlSite,
      conhecimentoSite: typeof iaBruto.conhecimentoSite === "string" && iaBruto.conhecimentoSite.trim()
        ? iaBruto.conhecimentoSite
        : iaPadrao.conhecimentoSite,
      conhecimentoExtra: typeof iaBruto.conhecimentoExtra === "string"
        ? iaBruto.conhecimentoExtra
        : iaPadrao.conhecimentoExtra,
      ultimaSincronizacao: iaBruto.ultimaSincronizacao || null,
      promptSistema: typeof iaBruto.promptSistema === "string" && iaBruto.promptSistema.trim()
        ? iaBruto.promptSistema
        : iaPadrao.promptSistema,
      mensagemTransferenciaHumano: typeof iaBruto.mensagemTransferenciaHumano === "string" && iaBruto.mensagemTransferenciaHumano.trim()
        ? iaBruto.mensagemTransferenciaHumano
        : iaPadrao.mensagemTransferenciaHumano,
      horasPausaHumano: Number(iaBruto.horasPausaHumano) > 0 ? Number(iaBruto.horasPausaHumano) : 24,
      pausarAoResponderManual: !!iaBruto.pausarAoResponderManual,
      avisarGrupoControle: iaBruto.avisarGrupoControle !== false
    }
  };
}

function lerArquivo() {
  if (!fs.existsSync(CAMINHO)) return normalizarDadosTriagem({});
  try {
    return normalizarDadosTriagem(JSON.parse(fs.readFileSync(CAMINHO, "utf-8")));
  } catch {
    return normalizarDadosTriagem({});
  }
}

function salvarArquivoAtomico(dados) {
  fs.mkdirSync("./data", { recursive: true });
  const temporario = `${CAMINHO}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), "utf-8");
  fs.renameSync(temporario, CAMINHO);
}

function lerPausasArquivo() {
  if (!fs.existsSync(CAMINHO_PAUSAS)) return {};
  try {
    const dados = JSON.parse(fs.readFileSync(CAMINHO_PAUSAS, "utf-8"));
    return (dados && typeof dados === "object") ? dados : {};
  } catch {
    return {};
  }
}

function salvarPausasArquivo(pausas) {
  try {
    fs.mkdirSync("./data", { recursive: true });
    const temporario = `${CAMINHO_PAUSAS}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(pausas, null, 2), "utf-8");
    fs.renameSync(temporario, CAMINHO_PAUSAS);
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
  sessoes.delete(jid);
}

export function reativarAtendimentoBot(jid) {
  const pausas = lerPausasArquivo();
  if (jid === "todos") {
    salvarPausasArquivo({});
    return;
  }
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
  const normalizado = normalizarDadosTriagem(dados);
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
  sessoes.delete(jid);
  limparHistoricoCliente(jid);
}

// Identifica conversas individuais privadas tanto no formato tradicional (@s.whatsapp.net)
// quanto no novo formato LID do WhatsApp Multi-Device / WhatsApp Business (@lid)
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

async function notificarGrupoControleAtendente(sock, jidCliente, telefoneCliente, nomeCliente, ultimaMensagem, horasPausa) {
  try {
    const configGeral = lerConfig();
    if (!configGeral?.grupoControleId) return;
    const tel = telefoneCliente || String(jidCliente).replace(/@.*$/, "").replace(/\D/g, "");
    const linkWa = jidCliente.endsWith("@s.whatsapp.net")
      ? `https://wa.me/${tel}`
      : (tel.length >= 10 && tel.length <= 13 ? `https://wa.me/${tel}` : `Chat privado (${nomeCliente || tel})`);
    const textoAlerta =
      `🛎️ *Solicitação de Atendente Humano*\n\n` +
      `👤 *Cliente:* ${nomeCliente || tel}\n` +
      `📱 *Contato:* ${linkWa}\n` +
      `💬 *Mensagem:* "${String(ultimaMensagem || "").slice(0, 300)}"\n\n` +
      `⏸️ _O robô foi pausado automaticamente para este cliente por ${horasPausa}h._`;
    await enviarMensagemBot(sock, configGeral.grupoControleId, { text: textoAlerta });
  } catch (err) {
    console.log("Aviso: não foi possível notificar o grupo de controle:", err.message);
  }
}

export async function processarTriagem(sock, msg) {
  const config = lerArquivo();
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

  if (!texto) return false;

  const nomeContato = msg.pushName || telefoneCliente || jid.replace(/@.*$/, "");
  const pediuReinicio = /^(\/?start|#bot)$/i.test(texto);

  // Se o cliente está em atendimento humano pausado e não enviou comando explícito de reinício
  if (clienteEstaPausado(jid)) {
    if (pediuReinicio) {
      reativarAtendimentoBot(jid);
    } else {
      return false;
    }
  }

  const iaAtiva = !!config.ia?.ativa;
  const temMenuInicial = !!(config.nodeInicial && config.nodes.some(n => n.id === config.nodeInicial));

  if (!iaAtiva && !temMenuInicial) return false;

  console.log(`💬 [Triagem] Mensagem recebida de ${nomeContato} (${jid}): "${texto.slice(0, 80)}"`);

  // Verifica se o cliente pediu diretamente para falar com um atendente humano
  if (iaAtiva && clientePediuAtendenteHumano(texto)) {
    const msgHumano = config.ia?.mensagemTransferenciaHumano
      || "Perfeito! Já chamei um atendente humano da *Gaicos Store* para falar com você. Aguarde só um instante! 👤";
    const horas = config.ia?.horasPausaHumano || 24;
    pausarAtendimentoHumano(jid, {
      telefone: telefoneCliente,
      nome: nomeContato,
      motivo: "Solicitou atendente humano",
      ultimaMensagem: texto,
      horas
    });
    await enviarMensagemBot(sock, jid, { text: msgHumano });
    if (config.ia?.avisarGrupoControle !== false) {
      await notificarGrupoControleAtendente(sock, jid, telefoneCliente, nomeContato, texto, horas);
    }
    return true;
  }

  const nodeAtualId = sessoes.get(jid);
  const ehSaudacaoCurta = /^(oi+|ola+|olá+|opa+|bom dia|boa tarde|boa noite|menu|\/?start|#bot)$/i.test(texto);

  // Caso 1: Tem menu inicial configurado e cliente acabou de chegar com saudação curta ou pediu start/menu
  if (temMenuInicial && (!nodeAtualId || pediuReinicio) && (ehSaudacaoCurta || !iaAtiva)) {
    sessoes.set(jid, config.nodeInicial);
    let resposta = config.boasVindas?.trim();
    const node = config.nodes.find(item => item.id === config.nodeInicial);
    if (!node) return true;
    resposta = resposta ? `${resposta}\n\n${montarTexto(node, iaAtiva)}` : montarTexto(node, iaAtiva);
    await enviarMensagemBot(sock, jid, { text: resposta });
    return true;
  }

  // Caso 2: Cliente está em um nó do menu e digitou um número de 1 a 9
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

      // Se a opção do menu for para chamar atendente humano
      if (clientePediuAtendenteHumano(opcao.texto) || /atendente|humano/i.test(opcao.texto)) {
        const horas = config.ia?.horasPausaHumano || 24;
        pausarAtendimentoHumano(jid, {
          telefone: telefoneCliente,
          nome: nomeContato,
          motivo: `Menu: ${opcao.texto}`,
          ultimaMensagem: opcao.texto,
          horas
        });
        if (!opcao.resposta) {
          await enviarMensagemBot(sock, jid, { text: config.ia?.mensagemTransferenciaHumano || "Chamei um atendente humano para te atender!" });
        }
        if (config.ia?.avisarGrupoControle !== false) {
          await notificarGrupoControleAtendente(sock, jid, telefoneCliente, nomeContato, `Escolheu opção: ${opcao.texto}`, horas);
        }
        return true;
      }

      if (!opcao.proxima) {
        sessoes.delete(jid);
        return true;
      }

      const proximo = config.nodes.find(item => item.id === opcao.proxima);
      if (!proximo) {
        sessoes.delete(jid);
        await enviarMensagemBot(sock, jid, { text: "Esta etapa não está disponível. Digite start para recomeçar." });
        return true;
      }
      sessoes.set(jid, proximo.id);
      await enviarMensagemBot(sock, jid, { text: montarTexto(proximo, iaAtiva) });
      return true;
    }
  }

  // Caso 3: Atendimento Inteligente por IA + Base do Site + Conhecimento Extra do Dono
  if (iaAtiva) {
    const resultadoIa = await gerarRespostaAtendimento({
      jid,
      nomeCliente: nomeContato,
      mensagemCliente: texto,
      configIa: config.ia
    });

    if (resultadoIa.chamarAtendente) {
      const horas = config.ia?.horasPausaHumano || 24;
      pausarAtendimentoHumano(jid, {
        telefone: telefoneCliente,
        nome: nomeContato,
        motivo: "Solicitou atendente humano durante conversa",
        ultimaMensagem: texto,
        horas
      });
      await enviarMensagemBot(sock, jid, { text: resultadoIa.resposta });
      if (config.ia?.avisarGrupoControle !== false) {
        await notificarGrupoControleAtendente(sock, jid, telefoneCliente, nomeContato, texto, horas);
      }
      return true;
    }

    await enviarMensagemBot(sock, jid, { text: resultadoIa.resposta });
    return true;
  }

  // Caso 4: IA desativada e cliente digitou algo fora de 1..9 no menu clássico
  const nodeFallback = config.nodes.find(item => item.id === nodeAtualId) || config.nodes[0];
  await enviarMensagemBot(sock, jid, { text: `Resposta inválida. ${montarTexto(nodeFallback, false)}` });
  return true;
}
