import crypto from "node:crypto";
import fs from "node:fs";
import { lerConfig } from "./configService.js";
import { salvarChaveNoSupabase } from "./supabaseService.js";

const CAMINHO_CONFIG = "./data/webhooks.json";
const CAMINHO_EVENTOS = "./data/webhooksEventos.json";
const MAX_EVENTOS = 100;

export const EVENTOS_PADRAO = {
  pedido_criado: {
    rotulo: "🛒 Pedido criado / aguardando pagamento",
    ativo: true,
    avisarGrupo: true,
    template:
      "Olá {{nome}}! Recebemos o seu pedido *#{{pedido}}*{{valor}}. Assim que o pagamento for confirmado, seguimos com a produção! 🙌\n{{link}}"
  },
  pedido_pago: {
    rotulo: "✅ Pagamento aprovado",
    ativo: true,
    avisarGrupo: true,
    template:
      "Boa notícia, {{nome}}! O pagamento do pedido *#{{pedido}}*{{valor}} foi confirmado! ✅ Já vamos preparar tudo com carinho.\n{{link}}"
  },
  pedido_producao: {
    rotulo: "🎨 Pedido em produção",
    ativo: true,
    avisarGrupo: false,
    template:
      "Oi {{nome}}! Seu pedido *#{{pedido}}* já entrou em produção 🎨✨ Assim que ficar pronto e for postado, te aviso por aqui!"
  },
  pedido_enviado: {
    rotulo: "📦 Pedido enviado / rastreio",
    ativo: true,
    avisarGrupo: false,
    template:
      "Seu pedido *#{{pedido}}* já foi enviado, {{nome}}! 📦🚀\nCódigo de rastreio: *{{rastreio}}*\n{{link}}"
  },
  pedido_entregue: {
    rotulo: "🎉 Pedido entregue",
    ativo: true,
    avisarGrupo: false,
    template:
      "Oba, {{nome}}! Consta aqui que seu pedido *#{{pedido}}* foi entregue! 🎉 Esperamos que curta muito!"
  },
  pedido_cancelado: {
    rotulo: "❌ Pedido cancelado",
    ativo: true,
    avisarGrupo: true,
    template:
      "Olá {{nome}}, o pedido *#{{pedido}}* foi cancelado. Se precisar de ajuda ou quiser refazer, é só responder por aqui!"
  },
  carrinho_abandonado: {
    rotulo: "🛍️ Carrinho abandonado",
    ativo: true,
    avisarGrupo: false,
    template:
      "Oi {{nome}}! Vimos que você deixou itens no carrinho{{valor}} aqui na loja 👀 Ficou alguma dúvida? Posso te ajudar a finalizar:\n{{link}}"
  },
  novo_contato: {
    rotulo: "💬 Novo contato / orçamento do site",
    ativo: true,
    avisarGrupo: true,
    template:
      "Olá {{nome}}! Recebemos seu contato pelo site sobre *{{produtos}}* 🙌 Em instantes nossa equipe já te responde por aqui!"
  },
  mensagem: {
    rotulo: "✉️ Mensagem livre enviada pelo site",
    ativo: true,
    avisarGrupo: false,
    template: "{{mensagem}}"
  }
};

const ALIASES_EVENTOS = {
  pedido_criado: "pedido_criado",
  order_created: "pedido_criado",
  order_pending: "pedido_criado",
  pedido_pendente: "pedido_criado",
  novo_pedido: "pedido_criado",

  pedido_pago: "pedido_pago",
  order_paid: "pedido_pago",
  payment_approved: "pedido_pago",
  pagamento_aprovado: "pedido_pago",
  pago: "pedido_pago",

  pedido_producao: "pedido_producao",
  order_in_production: "pedido_producao",
  em_producao: "pedido_producao",
  producao: "pedido_producao",

  pedido_enviado: "pedido_enviado",
  order_shipped: "pedido_enviado",
  shipping_updated: "pedido_enviado",
  enviado: "pedido_enviado",
  rastreio: "pedido_enviado",

  pedido_entregue: "pedido_entregue",
  order_delivered: "pedido_entregue",
  entregue: "pedido_entregue",

  pedido_cancelado: "pedido_cancelado",
  order_canceled: "pedido_cancelado",
  order_cancelled: "pedido_cancelado",
  cancelado: "pedido_cancelado",

  carrinho_abandonado: "carrinho_abandonado",
  cart_abandoned: "carrinho_abandonado",
  abandoned_cart: "carrinho_abandonado",

  novo_contato: "novo_contato",
  contact: "novo_contato",
  lead: "novo_contato",
  quote: "novo_contato",
  orcamento: "novo_contato",
  formulario: "novo_contato",

  mensagem: "mensagem",
  message: "mensagem",
  custom: "mensagem",
  mensagem_livre: "mensagem"
};

export function gerarNovoSegredo() {
  return "whsec_" + crypto.randomBytes(24).toString("hex");
}

function clonarEventosPadrao(eventosRecebidos = {}) {
  const resultado = {};
  for (const [chave, padrao] of Object.entries(EVENTOS_PADRAO)) {
    const recebido = (eventosRecebidos && typeof eventosRecebidos[chave] === "object" && eventosRecebidos[chave]) || {};
    resultado[chave] = {
      rotulo: padrao.rotulo,
      ativo: recebido.ativo !== undefined ? !!recebido.ativo : padrao.ativo,
      avisarGrupo: recebido.avisarGrupo !== undefined ? !!recebido.avisarGrupo : padrao.avisarGrupo,
      template:
        typeof recebido.template === "string" && recebido.template.trim()
          ? recebido.template.slice(0, 4000)
          : padrao.template
    };
  }
  return resultado;
}

function escreverJsonAtomico(caminho, dados) {
  fs.mkdirSync("./data", { recursive: true });
  const tmp = `${caminho}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf-8");
  fs.renameSync(tmp, caminho);
}

export function lerConfigWebhook() {
  let lido = {};
  let existeArquivo = fs.existsSync(CAMINHO_CONFIG);
  if (existeArquivo) {
    try {
      lido = JSON.parse(fs.readFileSync(CAMINHO_CONFIG, "utf-8")) || {};
    } catch {
      lido = {};
    }
  }

  const segredoEnv = (process.env.WEBHOOK_SECRET || "").trim();
  const segredoArquivo = typeof lido.segredo === "string" ? lido.segredo.trim() : "";
  const segredo = segredoEnv || segredoArquivo || gerarNovoSegredo();

  const cfg = {
    ativo: lido.ativo !== undefined ? !!lido.ativo : true,
    segredo,
    eventos: clonarEventosPadrao(lido.eventos),
    atualizadoEm: lido.atualizadoEm || new Date().toISOString()
  };

  if (!existeArquivo || (!segredoArquivo && !segredoEnv)) {
    try {
      escreverJsonAtomico(CAMINHO_CONFIG, cfg);
      salvarChaveNoSupabase("webhooksConfig", cfg);
    } catch {}
  }

  return cfg;
}

export function salvarConfigWebhook(novaConfig = {}) {
  const atual = lerConfigWebhook();
  const cfg = {
    ativo: novaConfig.ativo !== undefined ? !!novaConfig.ativo : atual.ativo,
    segredo: atual.segredo,
    eventos: clonarEventosPadrao(novaConfig.eventos || atual.eventos),
    atualizadoEm: new Date().toISOString()
  };
  escreverJsonAtomico(CAMINHO_CONFIG, cfg);
  salvarChaveNoSupabase("webhooksConfig", cfg);
  return cfg;
}

export function regenerarSegredoWebhook() {
  const atual = lerConfigWebhook();
  const cfg = {
    ...atual,
    segredo: gerarNovoSegredo(),
    atualizadoEm: new Date().toISOString()
  };
  escreverJsonAtomico(CAMINHO_CONFIG, cfg);
  salvarChaveNoSupabase("webhooksConfig", cfg);
  return cfg;
}

export function validarSegredoWebhook(tokenRecebido) {
  if (typeof tokenRecebido !== "string" || !tokenRecebido.trim()) return false;
  const { segredo } = lerConfigWebhook();
  if (!segredo) return false;
  const a = Buffer.from(tokenRecebido.trim(), "utf-8");
  const b = Buffer.from(segredo, "utf-8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function extrairTokenRequisicao(req) {
  const headerSecret = req.headers?.["x-webhook-secret"];
  if (typeof headerSecret === "string" && headerSecret.trim()) {
    return headerSecret.trim();
  }
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const querySecret = req.query?.secret;
  if (typeof querySecret === "string" && querySecret.trim()) {
    return querySecret.trim();
  }
  return "";
}

export function normalizarTelefoneWhatsapp(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 || digits.length === 11) {
    digits = "55" + digits;
  }
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

export function normalizarEvento(raw) {
  const limpo = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[.\-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  if (!limpo) return "mensagem";
  return ALIASES_EVENTOS[limpo] || limpo;
}

export function formatarValorMoeda(val) {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "";
    return `R$ ${val.toFixed(2).replace(".", ",")}`;
  }
  const str = String(val).trim();
  if (!str) return "";
  const num = Number(str.replace(",", "."));
  if (/^\d+([.,]\d+)?$/.test(str) && Number.isFinite(num)) {
    return `R$ ${num.toFixed(2).replace(".", ",")}`;
  }
  return str;
}

export function formatarListaProdutos(itens) {
  if (!itens) return "";
  if (typeof itens === "string") return itens.trim();
  if (!Array.isArray(itens)) return "";
  return itens
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const nome = String(item.nome || item.name || item.titulo || item.title || "").trim();
        const qtd = item.quantidade ?? item.qty ?? item.qtd;
        if (!nome) return "";
        return qtd ? `${qtd}x ${nome}` : nome;
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

export function extrairDadosPayload(body = {}) {
  const b = body && typeof body === "object" ? body : {};
  const cliente = (b.cliente && typeof b.cliente === "object" ? b.cliente : null) ||
    (b.customer && typeof b.customer === "object" ? b.customer : null) || {};
  const pedidoObj = (b.pedido && typeof b.pedido === "object" ? b.pedido : null) ||
    (b.order && typeof b.order === "object" ? b.order : null) || {};

  const eventoOriginal = String(b.evento || b.event || b.tipo || b.type || "mensagem").trim();
  const evento = normalizarEvento(eventoOriginal);

  const telefoneBruto =
    b.telefone ?? b.phone ?? b.whatsapp ?? b.celular ?? cliente.telefone ?? cliente.phone ?? cliente.whatsapp ?? "";
  const telefone = normalizarTelefoneWhatsapp(telefoneBruto);

  const nome = String(b.nome || b.name || cliente.nome || cliente.name || "").trim();
  const pedido = String(
    (typeof b.pedido === "string" || typeof b.pedido === "number" ? b.pedido : "") ||
    b.orderId || b.order_id || b.numeroPedido || pedidoObj.id || pedidoObj.numero || pedidoObj.number || ""
  ).trim();

  const valorBruto = b.valor ?? b.total ?? b.amount ?? pedidoObj.valor ?? pedidoObj.total ?? "";
  const valorFormatado = formatarValorMoeda(valorBruto);
  const valor = valorFormatado ? ` (${valorFormatado})` : "";

  const status = String(b.status || pedidoObj.status || "").trim();
  const rastreio = String(
    b.rastreio || b.tracking || b.trackingCode || b.codigoRastreio || pedidoObj.rastreio || pedidoObj.tracking || ""
  ).trim();
  const link = String(
    b.link || b.url || b.checkoutUrl || pedidoObj.link || pedidoObj.url || ""
  ).trim();
  const produtos = formatarListaProdutos(b.produtos || b.itens || b.items || pedidoObj.itens || pedidoObj.items);
  const mensagem = String(b.mensagem || b.message || b.texto || b.text || "").trim();
  const midiaUrl = String(b.midiaUrl || b.mediaUrl || b.imagemUrl || b.imageUrl || "").trim();
  const tipoMidia = String(b.tipoMidia || b.mediaType || "").trim().toLowerCase() === "video" ? "video" : "imagem";

  const avisarGrupo = b.avisarGrupo !== undefined ? !!b.avisarGrupo : undefined;

  return {
    evento,
    eventoOriginal,
    telefone,
    nome,
    pedido,
    valor,
    valorTexto: valorFormatado,
    status,
    rastreio,
    link,
    produtos,
    mensagem,
    midiaUrl,
    tipoMidia,
    avisarGrupo
  };
}

export function renderizarTemplate(template, dados = {}) {
  const mapa = {
    nome: dados.nome || "cliente",
    pedido: dados.pedido || "",
    valor: dados.valor || "",
    status: dados.status || "",
    rastreio: dados.rastreio || "",
    link: dados.link || "",
    produtos: dados.produtos || "",
    mensagem: dados.mensagem || ""
  };

  return String(template || "")
    .split("\n")
    .map((linhaOriginal) => {
      const substituida = linhaOriginal
        .replace(/\{\{(\w+)\}\}/g, (_, chave) => (mapa[chave] !== undefined ? mapa[chave] : ""))
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      return { haviaTexto: linhaOriginal.trim() !== "", substituida };
    })
    .filter((item) => item.substituida !== "" || !item.haviaTexto)
    .map((item) => item.substituida)
    .filter((linha, idx, arr) => linha !== "" || (idx > 0 && arr[idx - 1] !== ""))
    .join("\n")
    .trim();
}

export function lerEventosWebhook() {
  if (!fs.existsSync(CAMINHO_EVENTOS)) return [];
  try {
    const lido = JSON.parse(fs.readFileSync(CAMINHO_EVENTOS, "utf-8"));
    return Array.isArray(lido) ? lido : [];
  } catch {
    return [];
  }
}

export function registrarEventoWebhook(entrada) {
  const lista = lerEventosWebhook();
  const item = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    recebidoEm: new Date().toISOString(),
    ...entrada
  };
  lista.unshift(item);
  if (lista.length > MAX_EVENTOS) lista.length = MAX_EVENTOS;
  try {
    escreverJsonAtomico(CAMINHO_EVENTOS, lista);
    salvarChaveNoSupabase("webhooksEventos", lista);
  } catch {}
  return item;
}

export function limparEventosWebhook() {
  try {
    escreverJsonAtomico(CAMINHO_EVENTOS, []);
    salvarChaveNoSupabase("webhooksEventos", []);
  } catch {}
}

function montarTextoAlertaGrupo(dados) {
  const titulo = EVENTOS_PADRAO[dados.evento]?.rotulo || dados.eventoOriginal || dados.evento;
  const linhas = [`🔔 *Webhook do Site: ${titulo}*`];
  if (dados.nome) linhas.push(`👤 Cliente: *${dados.nome}*`);
  if (dados.telefone) linhas.push(`📱 WhatsApp: https://wa.me/${dados.telefone}`);
  if (dados.pedido) linhas.push(`🧾 Pedido: *#${dados.pedido}*${dados.valor}`);
  else if (dados.valorTexto) linhas.push(`💰 Valor: ${dados.valorTexto}`);
  if (dados.produtos) linhas.push(`📦 Itens: ${dados.produtos}`);
  if (dados.rastreio) linhas.push(`🚚 Rastreio: ${dados.rastreio}`);
  if (dados.mensagem) linhas.push(`💬 Mensagem: ${dados.mensagem.slice(0, 300)}`);
  return linhas.join("\n");
}

export async function processarWebhookSite(body, enviarFn) {
  const cfg = lerConfigWebhook();
  const dados = extrairDadosPayload(body);

  if (!cfg.ativo) {
    const logItem = registrarEventoWebhook({
      evento: dados.evento,
      telefone: dados.telefone || "",
      nome: dados.nome || "",
      pedido: dados.pedido || "",
      status: "ignorado",
      detalhe: "Integração de webhook pausada no painel."
    });
    return { ok: true, ignorado: true, idEvento: logItem.id, motivo: logItem.detalhe };
  }

  let regraEvento = cfg.eventos[dados.evento];
  if (!regraEvento && dados.mensagem) {
    regraEvento = cfg.eventos.mensagem;
  }

  if (!regraEvento || regraEvento.ativo === false) {
    const motivo = !regraEvento
      ? `Evento '${dados.evento}' não reconhecido e sem campo mensagem.`
      : `Evento '${dados.evento}' está desativado no painel.`;
    const logItem = registrarEventoWebhook({
      evento: dados.evento,
      telefone: dados.telefone || "",
      nome: dados.nome || "",
      pedido: dados.pedido || "",
      status: "ignorado",
      detalhe: motivo
    });
    return { ok: true, ignorado: true, idEvento: logItem.id, evento: dados.evento, motivo };
  }

  const textoCliente =
    dados.evento === "mensagem"
      ? dados.mensagem
      : (renderizarTemplate(regraEvento.template, dados) || dados.mensagem);

  const grupoControleId = lerConfig().grupoControleId;
  const deveAvisarGrupo =
    dados.avisarGrupo !== undefined ? dados.avisarGrupo : !!regraEvento.avisarGrupo;

  if (!dados.telefone && !(deveAvisarGrupo && grupoControleId)) {
    const erroMsg = "Informe um telefone válido (ex: 5511999999999) ou configure o Grupo de Controle.";
    registrarEventoWebhook({
      evento: dados.evento,
      telefone: "",
      nome: dados.nome || "",
      pedido: dados.pedido || "",
      status: "erro",
      detalhe: erroMsg
    });
    return { ok: false, statusHttp: 400, erro: erroMsg };
  }

  let enviadoCliente = false;
  let avisadoGrupo = false;

  if (dados.telefone && (textoCliente || dados.midiaUrl)) {
    await enviarFn(
      dados.telefone,
      { texto: textoCliente, midiaUrl: dados.midiaUrl, tipoMidia: dados.tipoMidia },
      { origem: `webhook:${dados.evento}`, nomeDestino: dados.nome || dados.telefone }
    );
    enviadoCliente = true;
  }

  if (deveAvisarGrupo && grupoControleId) {
    await enviarFn(
      grupoControleId,
      { texto: montarTextoAlertaGrupo(dados) },
      { origem: `webhook-alerta:${dados.evento}`, nomeDestino: "Grupo de Controle" }
    );
    avisadoGrupo = true;
  }

  const logItem = registrarEventoWebhook({
    evento: dados.evento,
    telefone: dados.telefone || "",
    nome: dados.nome || "",
    pedido: dados.pedido || "",
    status: "enviado",
    detalhe: [
      enviadoCliente ? "Cliente notificado" : null,
      avisadoGrupo ? "Grupo alertado" : null
    ]
      .filter(Boolean)
      .join(" + ")
  });

  return {
    ok: true,
    idEvento: logItem.id,
    evento: dados.evento,
    telefone: dados.telefone,
    enviadoCliente,
    avisadoGrupo,
    mensagemEnviada: textoCliente
  };
}
