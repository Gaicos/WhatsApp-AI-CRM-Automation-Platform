import fs from "node:fs";
import { CONHECIMENTO_PADRAO_GAICOS } from "./siteKnowledgeService.js";
import { salvarChaveNoSupabase } from "./supabaseService.js";
import { caminhoArquivoTenant, chaveSupabaseTenant, obterTenantAtual } from "./tenantContext.js";

export const PROMPT_SISTEMA_PADRAO = `Você é o Gaicos Jr, consultor de vendas da Gaicos Store (https://www.gaicos-store.com.br/), loja especializada em playmats e acessórios de TCG.

OBJETIVO: Ajudar o cliente com simpatia, educação e persuasão leve para concluir a compra no site.

REGRAS ESSENCIAIS (ESTILO WHATSAPP — SEM TEXTÃO):
1. TOM EDUCADO E NATURAL: fale de forma cordial, educada, atenciosa e humana (sem gírias exageradas ou tom informal demais). Nunca faça textão: use no máximo 2 a 4 linhas curtas por resposta.
2. PERSUASÃO CONSULTIVA: destaque benefícios reais dos playmats (tecido liso que protege os sleeves, impressão nítida, base emborrachada antiderrapante e tamanhos M 60x35cm ou G 75x35cm). Em promoções, mostre a vantagem ("de R$ X por R$ Y").
3. CONDUZA COM SUAVIDADE: termine sempre com 1 pergunta simples e gentil para ajudar o cliente a escolher (ex: "Você prefere um modelo temático ou personalizar com a sua própria arte?", "Qual tamanho fica melhor para a sua mesa, o M ou o G?").
4. UM LINK DIRETO: quando fizer sentido, envie apenas 1 link direto do produto certo, catálogo (https://www.gaicos-store.com.br/catalogo) ou personalizado (https://www.gaicos-store.com.br/pedido-personalizado).
5. PRIVACIDADE E ESCALAÇÃO PARA O GAICOS EM PESSOA:
   - Nunca revele telefone pessoal do dono nem mencione erros técnicos ao cliente.
   - Nunca invente preço, prazo ou informação fora da base abaixo.
   - Coloque exatamente a tag [CHAMAR_ATENDENTE] no final da resposta e diga com educação que vai chamar o Gaicos em pessoa se:
     • o cliente pedir para falar com o Gaicos/atendente/humano ou perguntar de pedido já realizado;
     • você não tiver certeza da resposta com base nos dados do site;
     • o cliente reclamar, indicar que a resposta não ajudou ou responder de forma seca sem interação.`;

export const CONHECIMENTO_EXTRA_PADRAO = `- Playmats com tecido liso de deslizamento suave (protege seus sleeves) e base em borracha antiderrapante.
- Tamanho M (60x35cm): padrão oficial para tubos e torneios. Tamanho G (75x35cm): estendido, ideal para decks cheios de fichas e terrenos.
- Pagamento rápido no checkout via Pix (QR Code e Copia e Cola gerados na hora).`;

const MODELOS_GROQ_FALLBACK = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b"
];

const historicoClientes = new Map();
const TTL_HISTORICO_MS = 2 * 60 * 60 * 1000;

function normalizarTextoBusca(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTokensRelevantes(str) {
  const stopWords = new Set([
    "o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na",
    "por", "para", "pra", "com", "sem", "que", "qual", "quais", "como", "onde", "quando",
    "voce", "voces", "vcs", "vc", "eu", "meu", "minha", "oi", "ola", "opa", "bom", "boa",
    "dia", "tarde", "noite", "tudo", "bem", "sobre", "loja", "site", "ai", "la", "me", "te",
    "se", "eh", "e", "tem", "ter", "quero", "queria", "gostaria", "saber", "ver", "manda"
  ]);
  return normalizarTextoBusca(str)
    .split(" ")
    .filter(t => t.length >= 2 && !stopWords.has(t));
}

function lerArquivoAprendizado() {
  const caminho = caminhoArquivoTenant("aprendizadoBot.json");
  if (!fs.existsSync(caminho)) {
    return { exemplos: [], interacoesRecentes: [] };
  }
  try {
    const lido = JSON.parse(fs.readFileSync(caminho, "utf-8"));
    return {
      exemplos: Array.isArray(lido?.exemplos) ? lido.exemplos : [],
      interacoesRecentes: Array.isArray(lido?.interacoesRecentes) ? lido.interacoesRecentes : []
    };
  } catch {
    return { exemplos: [], interacoesRecentes: [] };
  }
}

function salvarArquivoAprendizado(dados) {
  try {
    const caminho = caminhoArquivoTenant("aprendizadoBot.json");
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf-8");
    fs.renameSync(tmp, caminho);
    salvarChaveNoSupabase(chaveSupabaseTenant("aprendizadoBot"), dados);
  } catch {}
}

export function listarDadosAprendizado() {
  return lerArquivoAprendizado();
}

export function ensinarRespostaAoBot({ id, pergunta, resposta }) {
  const p = String(pergunta || "").trim();
  const r = String(resposta || "").trim();
  if (!p || !r) {
    throw new Error("Preencha a pergunta/situação do cliente e a resposta ideal do bot.");
  }

  const dados = lerArquivoAprendizado();
  const normP = normalizarTextoBusca(p);

  const existenteIdx = dados.exemplos.findIndex(item =>
    (id && item.id === id) || normalizarTextoBusca(item.pergunta) === normP
  );

  const novoItem = {
    id: existenteIdx >= 0 ? dados.exemplos[existenteIdx].id : `treino_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    pergunta: p,
    resposta: r,
    atualizadoEm: new Date().toISOString()
  };

  if (existenteIdx >= 0) {
    dados.exemplos[existenteIdx] = novoItem;
  } else {
    dados.exemplos.unshift(novoItem);
  }

  dados.interacoesRecentes = dados.interacoesRecentes.map(inter => {
    if (normalizarTextoBusca(inter.pergunta) === normP) {
      return { ...inter, resposta: r, corrigido: true };
    }
    return inter;
  });

  salvarArquivoAprendizado(dados);
  return { ok: true, item: novoItem, dados };
}

export function removerExemploAprendizado(id) {
  const dados = lerArquivoAprendizado();
  dados.exemplos = dados.exemplos.filter(item => item.id !== id);
  salvarArquivoAprendizado(dados);
  return { ok: true, dados };
}

export function limparInteracoesRecentes() {
  const dados = lerArquivoAprendizado();
  dados.interacoesRecentes = [];
  salvarArquivoAprendizado(dados);
  return { ok: true, dados };
}

function registrarInteracaoRecente({ cliente, pergunta, resposta, origem }) {
  try {
    const dados = lerArquivoAprendizado();
    dados.interacoesRecentes.unshift({
      id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      data: new Date().toISOString(),
      cliente: cliente || "Simulador / Cliente",
      pergunta: String(pergunta || "").slice(0, 500),
      resposta: String(resposta || "").slice(0, 1000),
      origem: origem || "local"
    });
    if (dados.interacoesRecentes.length > 30) {
      dados.interacoesRecentes = dados.interacoesRecentes.slice(0, 30);
    }
    salvarArquivoAprendizado(dados);
  } catch {}
}

function buscarRespostaAprendida(perguntaCliente, exemplos = []) {
  if (!Array.isArray(exemplos) || exemplos.length === 0) return null;

  const normPergunta = normalizarTextoBusca(perguntaCliente);
  if (!normPergunta) return null;

  const tokensPergunta = extrairTokensRelevantes(perguntaCliente);
  let melhorMatch = null;
  let maiorScore = 0;

  for (const ex of exemplos) {
    const variantes = String(ex.pergunta || "").split(/\s*\|\s*/).filter(Boolean);
    for (const variante of variantes) {
      const normEx = normalizarTextoBusca(variante);
      if (!normEx) continue;

      if (normPergunta === normEx) {
        return ex;
      }

      if (normEx.length >= 5 && (normPergunta.includes(normEx) || normEx.includes(normPergunta))) {
        const razaoTamanho = Math.min(normPergunta.length, normEx.length) / Math.max(normPergunta.length, normEx.length);
        const scoreSub = 0.78 + (razaoTamanho * 0.22);
        if (scoreSub > maiorScore) {
          maiorScore = scoreSub;
          melhorMatch = ex;
        }
      }

      const tokensEx = extrairTokensRelevantes(variante);
      if (tokensPergunta.length > 0 && tokensEx.length > 0) {
        let coincidencias = 0;
        for (const tEx of tokensEx) {
          if (tokensPergunta.some(tP => tP === tEx || (tP.length >= 4 && tEx.length >= 4 && (tP.startsWith(tEx.slice(0, 4)) || tEx.startsWith(tP.slice(0, 4)))))) {
            coincidencias++;
          }
        }
        const precisaoEx = coincidencias / tokensEx.length;
        const coberturaPergunta = coincidencias / tokensPergunta.length;
        const score = (precisaoEx * 0.65) + (coberturaPergunta * 0.35);

        if (coincidencias >= 1 && score > maiorScore) {
          maiorScore = score;
          melhorMatch = ex;
        }
      }
    }
  }

  if (melhorMatch && maiorScore >= 0.62) {
    return melhorMatch;
  }
  return null;
}

function chaveHistorico(jid) {
  return `${obterTenantAtual()}:${jid}`;
}

export function limparHistoricoCliente(jid) {
  historicoClientes.delete(chaveHistorico(jid));
}

function obterHistorico(jid) {
  const chave = chaveHistorico(jid);
  const item = historicoClientes.get(chave);
  if (!item) return [];
  if (Date.now() - item.atualizadoEm > TTL_HISTORICO_MS) {
    historicoClientes.delete(chave);
    return [];
  }
  return item.mensagens;
}

function registrarNoHistorico(jid, pergunta, resposta) {
  if (!jid) return;
  const atual = obterHistorico(jid);
  atual.push({ role: "user", content: String(pergunta || "").slice(0, 1500) });
  atual.push({ role: "assistant", content: String(resposta || "").slice(0, 2000) });
  while (atual.length > 10) {
    atual.shift();
  }
  historicoClientes.set(chaveHistorico(jid), { atualizadoEm: Date.now(), mensagens: atual });
}

export function clientePediuAtendenteHumano(texto) {
  const limpo = normalizarTextoBusca(texto);
  if (!limpo) return false;
  if (limpo === "0" || limpo === "atendente" || limpo === "humano" || limpo === "suporte" || limpo === "gaicos") return true;

  return /\b(falar com (um |uma |o )?(atendente|humano|pessoa|vendedor|alguem|suporte|gerente|dono|gaicos)|quero (um )?(atendente|humano)|atendimento humano|chamar (um |o )?(atendente|humano|gaicos)|passar para (atendente|humano|gaicos))\b/i.test(limpo);
}

const RESPOSTA_SECA_RE = /^(\?+|hm+|hum+|ok|ta|blz|beleza|aham|uhum|sei la|tanto faz|deixa|esquece|nada|nao sei|aff+|kkk+)$/i;

export function detectarSinalEscalacao(texto, historico = []) {
  const limpo = normalizarTextoBusca(texto);
  const bruto = String(texto || "").trim();

  if (clientePediuAtendenteHumano(bruto)) {
    return { escalar: true, motivo: "Cliente pediu atendimento humano" };
  }

  if (
    /\b(nao entendeu|nada a ver|errou|ta errado|muito errado|nao era isso|nao foi isso|nao ajudou|pessimo|horrivel|robo chato|burro|lixo|reclamacao|problema no pedido|pedido atrasado|nao chegou|reembolso|extorno|estorno|defeito|danificado)\b/i.test(limpo)
  ) {
    return { escalar: true, motivo: "Possível resposta errada ou reclamação" };
  }

  const msgsUsuario = Array.isArray(historico)
    ? historico.filter(m => m.role === "user")
    : [];

  const ehSeca = RESPOSTA_SECA_RE.test(limpo || bruto) || (bruto.length <= 2 && !/^[1-9]$/.test(bruto));
  if (ehSeca && msgsUsuario.length >= 1) {
    return { escalar: true, motivo: "Falta de interação do cliente" };
  }

  return { escalar: false, motivo: "" };
}

function extrairListaProdutosDaBase(configIa = {}) {
  if (Array.isArray(configIa.catalogoProdutos) && configIa.catalogoProdutos.length > 0) {
    return configIa.catalogoProdutos;
  }
  const base = String(configIa.conhecimentoSite || "");
  const lista = [];
  let categoriaAtual = "Catálogo";
  for (const linhaRaw of base.split(/\r?\n/)) {
    const linha = linhaRaw.trim();
    const mCat = /^\[([^\]]+)\]$/.exec(linha);
    if (mCat) {
      categoriaAtual = mCat[1].trim();
      continue;
    }
    if (!linha.startsWith("• ")) continue;
    const semBolinha = linha.slice(2);
    const [corpo, ...restoResumo] = semBolinha.split(" — ");
    const partes = corpo.split(" | ").map(s => s.trim());
    if (partes.length >= 2 && !partes[0].startsWith("P:")) {
      const precoTxt = partes[1] || "";
      const promoMatch = /Promoção de (R\$ [\d.,]+) por (R\$ [\d.,]+)/i.exec(precoTxt);
      lista.push({
        nome: partes[0],
        categoria: categoriaAtual,
        preco: promoMatch ? promoMatch[1] : precoTxt,
        precoPromo: promoMatch ? promoMatch[2] : "",
        emPromocao: Boolean(promoMatch),
        personalizavel: /personaliz/i.test(partes[0] + categoriaAtual),
        resumo: restoResumo.join(" — "),
        link: partes[2] || ""
      });
    }
  }
  return lista;
}

export function buscarProdutosNoCatalogo(pergunta, configIa = {}) {
  const produtos = extrairListaProdutosDaBase(configIa);
  if (produtos.length === 0) return [];

  const normPerg = normalizarTextoBusca(pergunta);
  const tokens = extrairTokensRelevantes(pergunta);
  const querPromo = /(promo|promocao|promocoes|oferta|ofertas|desconto|barato)/.test(normPerg);

  if (querPromo) {
    const promos = produtos.filter(p => p.emPromocao);
    if (promos.length > 0) return promos.slice(0, 2);
  }

  const pontuados = [];
  for (const p of produtos) {
    const alvo = normalizarTextoBusca(`${p.nome} ${p.categoria} ${p.resumo}`);
    let pontos = 0;
    for (const tok of tokens) {
      if (tok.length < 3) continue;
      if (alvo.includes(tok) || (tok.length >= 4 && alvo.includes(tok.slice(0, 4)))) {
        pontos += normalizarTextoBusca(p.nome).includes(tok) ? 3 : 1;
      }
    }
    if (pontos > 0) {
      pontuados.push({ produto: p, pontos });
    }
  }

  return pontuados
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 2)
    .map(item => item.produto);
}

function formatarProdutoCurto(p) {
  const preco = p.emPromocao && p.precoPromo
    ? `de ~${p.preco}~ por *${p.precoPromo}*`
    : `*${p.preco || "confira no site"}*`;
  return `• *${p.nome}* — ${preco}${p.link ? `\n  👉 ${p.link}` : ""}`;
}

function buscarTrechosExtrasDoDono(perguntaNormalizada, conhecimentoExtra) {
  if (!conhecimentoExtra || typeof conhecimentoExtra !== "string") return [];
  const tokens = extrairTokensRelevantes(perguntaNormalizada);
  if (tokens.length === 0) return [];

  const blocos = conhecimentoExtra
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 6);

  const encontrados = [];
  for (const bloco of blocos) {
    const bNorm = normalizarTextoBusca(bloco);
    const pontos = tokens.filter(p => bNorm.includes(p)).length;
    if (pontos > 0) {
      encontrados.push({ bloco: bloco.replace(/^[-*•]\s*/, ""), pontos });
    }
  }

  return encontrados
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 2)
    .map(item => item.bloco);
}

function ehMensagemLegadaPadrao(msg) {
  return /^Perfeito! Já chamei um atendente humano da \*Gaicos Store\*/i.test(String(msg || "").trim());
}

function mensagemChamandoResponsavel(configIa = {}) {
  const custom = String(configIa.mensagemTransferenciaHumano || "").trim();
  if (custom && !ehMensagemLegadaPadrao(custom)) return custom;
  const responsavel = String(configIa.nomeResponsavel || "Gaicos").trim();
  return `Perfeito! Vou chamar o *${responsavel} em pessoa* para te atender certinho por aqui. Só um instante, por favor! 😊`;
}

// Gaicos Jr local: educado, persuasivo e direto ao ponto (2–4 linhas, sem textão)
function responderModoLocalInteligente(pergunta, configIa = {}, historico = []) {
  const base = (configIa.conhecimentoSite || CONHECIMENTO_PADRAO_GAICOS).trim();
  const extra = (configIa.conhecimentoExtra || CONHECIMENTO_EXTRA_PADRAO).trim();
  const textoOriginal = String(pergunta || "").trim();
  const t = normalizarTextoBusca(textoOriginal);
  const nomeBot = String(configIa.nomeBot || "Gaicos Jr").trim();
  const responsavel = String(configIa.nomeResponsavel || "Gaicos").trim();
  const urlBase = String(configIa.urlSite || "https://www.gaicos-store.com.br").replace(/\/+$/, "");

  const sinal = detectarSinalEscalacao(textoOriginal, historico);
  if (sinal.escalar) {
    return {
      resposta: mensagemChamandoResponsavel(configIa),
      chamarAtendente: true,
      motivoEscalacao: sinal.motivo,
      origem: "escalacao-automatica"
    };
  }

  // Saudação educada com gancho de venda consultiva
  if (/^(oi+|ola+|opa+|bom dia|boa tarde|boa noite|e ai|tudo bem|salve|start|menu)\b/.test(t) && t.split(/\s+/).length <= 5) {
    return {
      resposta:
        `Olá! Tudo bem? Sou o *${nomeBot}*, da Gaicos Store 😊\n` +
        `Você procura um *Playmat Personalizado* com a sua própria arte ou prefere conferir nossos *modelos de TCG* em promoção?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  const dicasDoDono = buscarTrechosExtrasDoDono(t, extra);
  const produtosEncontrados = buscarProdutosNoCatalogo(textoOriginal, configIa);

  // 1. Promoções / Ofertas (com catálogo real ou resumo oficial)
  if (/(promo|promocao|promocoes|oferta|ofertas|liquidacao)/.test(t)) {
    if (produtosEncontrados.length > 0) {
      const linhas = produtosEncontrados.map(formatarProdutoCurto).join("\n");
      return {
        resposta:
          `Temos ótimas promoções ativas no site agora:\n${linhas}\n` +
          `Qual desses modelos combina mais com o seu deck?`,
        chamarAtendente: false,
        origem: "local"
      };
    }
    return {
      resposta:
        `Temos playmats temáticos em promoção a partir de *R$ 175,00* e personalizados a partir de *R$ 178,00* 😊\n` +
        `Confira as ofertas aqui: ${urlBase}/catalogo — você joga Yu-Gi-Oh!, Magic ou Pokémon?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 2. Playmat personalizado / arte própria
  if (/(personaliz|minha arte|propria arte|enviar imagem|enviar foto|sob medida|criar playmat|fazer playmat|custom|foto)/.test(t)) {
    const linkPers = /gaicos-store/i.test(urlBase) ? `${urlBase}/pedido-personalizado` : urlBase;
    return {
      resposta:
        `Você pode personalizar com a sua arte em tecido liso (protege seus sleeves) e base emborrachada antiderrapante ✨\n` +
        `• *Tamanho M (60x35cm):* R$ 178,00 · *Tamanho G (75x35cm):* R$ 198,00\n` +
        `Envie sua imagem aqui 👉 ${linkPers} — prefere o tamanho M ou G?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 3. Produto específico encontrado no catálogo real do site
  if (produtosEncontrados.length > 0 && !/^(preco|valor|pix|frete)$/.test(t)) {
    const linhas = produtosEncontrados.map(formatarProdutoCurto).join("\n");
    return {
      resposta:
        `Encontrei estas opções excelentes no nosso site:\n${linhas}\n` +
        `Tecido macio com base antiderrapante e Pix na hora. Prefere o tamanho M ou G?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 4. Objeção de preço / desconto / cupom
  if (/(caro|salgado|puxado|desconto|cupom|mais barato)/.test(t)) {
    return {
      resposta:
        `Nossos playmats têm acabamento durável e tecido suave que ajuda a conservar seus sleeves por muito mais tempo 😊\n` +
        `Temos modelos em promoção a partir de *R$ 175,00* no site (${urlBase}/catalogo). Quer que eu ajude a escolher um para o seu deck?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 5. Preços / valores gerais
  if (/(preco|valor|quanto custa|quanto ta|quanto sai|valores|orcamento)/.test(t)) {
    return {
      resposta:
        `• *Personalizado (sua arte):* M por *R$ 178,00* · G (75x35cm) por *R$ 198,00*\n` +
        `• *Temáticos (Yu-Gi-Oh!, Magic, Pokémon):* a partir de *R$ 175,00* em promoção\n` +
        `Qual jogo ou estilo você procura? 😊`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 6. Pagamento / Pix
  if (/(pix|pagar|pagamento|forma de pagamento|cartao|parcela|boleto|qr code)/.test(t)) {
    return {
      resposta:
        `No checkout do site você paga de forma rápida via *Pix* (QR Code e Copia e Cola com aprovação imediata) ou pelas opções da loja 😊\n` +
        `Já escolheu o seu playmat ou quer o link do catálogo?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 7. Frete / Prazo / CEP / Troca
  if (/(frete|entrega|prazo|cep|envio|correio|transportadora|demora|chega|troca|devol)/.test(t)) {
    return {
      resposta:
        `Você calcula o frete e prazo exatos informando seu CEP no carrinho em ${urlBase}/catalogo 🚚\n` +
        `Se for sobre um pedido já feito, me avise que chamo o *${responsavel} em pessoa* agora mesmo!`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 8. Jogos / Catálogo geral
  if (/(yugioh|yu gi oh|magic|mtg|pokemon|tcg|tematico|catalogo|modelo|playmat|tapete|tamanho|medida)/.test(t)) {
    return {
      resposta:
        `Trabalhamos com playmats de *Yu-Gi-Oh!*, *Magic* e *Pokémon* nos tamanhos *M (60x35cm)* e *G (75x35cm)*, a partir de R$ 175,00 😊\n` +
        `Veja todos os modelos aqui 👉 ${urlBase}/catalogo — qual jogo você curte?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 9. Informação exclusiva do dono
  if (dicasDoDono.length > 0) {
    return {
      resposta: `${dicasDoDono[0]}\nPosso te enviar o link direto para você garantir o seu?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 10. Busca curta na base / FAQ do site
  const tokens = extrairTokensRelevantes(t);
  if (tokens.length > 0) {
    const linhasBase = base
      .split(/\r?\n/)
      .filter(l => l.trim().length > 12 && !l.startsWith("===") && !l.startsWith("---"));
    const relevante = linhasBase.find(linha => {
      const lNorm = normalizarTextoBusca(linha);
      return tokens.some(p => p.length >= 4 && lNorm.includes(p));
    });
    if (relevante) {
      return {
        resposta: `${relevante.trim().slice(0, 220)}\nQuer conferir mais detalhes no catálogo (${urlBase}/catalogo)?`,
        chamarAtendente: false,
        origem: "local"
      };
    }
  }

  // 11. Sem confiança suficiente na base local -> chama o Gaicos em pessoa em vez de chutar resposta errada
  return {
    resposta: mensagemChamandoResponsavel(configIa),
    chamarAtendente: true,
    motivoEscalacao: "Dúvida fora da base — evitando resposta incorreta",
    origem: "escalacao-baixa-confianca"
  };
}

export function compactarRespostaCurta(texto) {
  return String(texto || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function chamarGemini(mensagensSistema, historico, pergunta, apiKey, modelo) {
  const mod = (modelo || "gemini-2.5-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mod)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const contents = [];
  for (const msg of historico) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: pergunta }]
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: mensagensSistema }]
      },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 450
      }
    })
  });

  if (!resp.ok) {
    const erroTxt = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status}: ${erroTxt.slice(0, 200)}`);
  }

  const dados = await resp.json();
  const texto = dados?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!texto) throw new Error("Gemini retornou resposta vazia.");
  return texto;
}

async function chamarOpenAICompativel(endpoint, mensagensSistema, historico, pergunta, apiKey, modeloPadrao, modeloConfig) {
  const mod = (modeloConfig || modeloPadrao).trim();
  const messages = [
    { role: "system", content: mensagensSistema },
    ...historico,
    { role: "user", content: pergunta }
  ];

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: mod,
      messages,
      temperature: 0.6,
      max_tokens: 450
    })
  });

  if (!resp.ok) {
    const erroTxt = await resp.text().catch(() => "");
    throw new Error(`API HTTP ${resp.status}: ${erroTxt.slice(0, 200)}`);
  }

  const dados = await resp.json();
  const texto = dados?.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error("A API de IA retornou resposta vazia.");
  return texto;
}

async function chamarGroqComFallback(mensagensSistema, historico, pergunta, apiKey, modeloConfig) {
  const inicial = String(modeloConfig || "").trim();
  const candidatos = [];
  if (inicial && inicial !== "llama-3.3-70b-versatile") {
    candidatos.push(inicial);
  }
  for (const m of MODELOS_GROQ_FALLBACK) {
    if (!candidatos.includes(m)) candidatos.push(m);
  }

  let ultimoErro = null;
  for (const mod of candidatos) {
    try {
      return await chamarOpenAICompativel(
        "https://api.groq.com/openai/v1/chat/completions",
        mensagensSistema,
        historico,
        pergunta,
        apiKey,
        mod,
        mod
      );
    } catch (err) {
      ultimoErro = err;
      const erroModelo = /404|model_not_found|decommissioned|not exist/i.test(err?.message || "");
      if (!erroModelo) throw err;
    }
  }
  throw ultimoErro || new Error("Nenhum modelo Groq respondeu.");
}

export async function gerarRespostaAtendimento({ jid = "simulacao", nomeCliente = "", mensagemCliente, configIa = {} }) {
  const pergunta = String(mensagemCliente || "").trim();
  const nomeBot = String(configIa.nomeBot || "Gaicos Jr").trim();

  if (!pergunta) {
    return {
      resposta: `Olá! Aqui é o *${nomeBot}*. Como posso te ajudar a escolher seu playmat hoje? 😊`,
      chamarAtendente: false,
      erroApi: null,
      origem: "local"
    };
  }

  const historico = obterHistorico(jid);
  const sinal = detectarSinalEscalacao(pergunta, historico);
  if (sinal.escalar) {
    const msgTransferencia = mensagemChamandoResponsavel(configIa);
    return {
      resposta: msgTransferencia,
      chamarAtendente: true,
      motivoEscalacao: sinal.motivo,
      erroApi: null,
      origem: "escalacao-automatica"
    };
  }

  const dadosAprendizado = lerArquivoAprendizado();
  const exemplos = dadosAprendizado.exemplos || [];

  const matchAprendido = buscarRespostaAprendida(pergunta, exemplos);
  if (matchAprendido) {
    const pediuHumano = /\[CHAMAR_ATENDENTE\]/i.test(matchAprendido.resposta);
    const respLimpa = compactarRespostaCurta(matchAprendido.resposta.replace(/\[CHAMAR_ATENDENTE\]/gi, ""));
    registrarNoHistorico(jid, pergunta, respLimpa);
    registrarInteracaoRecente({
      cliente: nomeCliente || jid,
      pergunta,
      resposta: respLimpa,
      origem: "aprendizado-treinado"
    });
    return {
      resposta: respLimpa,
      chamarAtendente: pediuHumano,
      motivoEscalacao: pediuHumano ? "Regra treinada acionou atendente" : "",
      erroApi: null,
      origem: "aprendizado-treinado"
    };
  }

  const provedor = String(configIa.provedor || "local").toLowerCase().trim();
  const apiKey = String(configIa.apiKey || "").trim();
  const promptSistema = (configIa.promptSistema || PROMPT_SISTEMA_PADRAO).trim();
  const conhecimento = (configIa.conhecimentoSite || CONHECIMENTO_PADRAO_GAICOS).trim();
  const conhecimentoExtra = (configIa.conhecimentoExtra || CONHECIMENTO_EXTRA_PADRAO).trim();

  const blocoExemplosTreinados = exemplos.length > 0
    ? "\n\n=== EXEMPLOS TREINADOS PELO DONO (SIGA ESTE ESTILO CURTO) ===\n" +
      exemplos.slice(0, 20).map(e => `Cliente: "${e.pergunta}"\nResposta: "${e.resposta}"`).join("\n---\n")
    : "";

  const blocoProdutosRapidos =
    Array.isArray(configIa.catalogoProdutos) &&
    configIa.catalogoProdutos.length > 0 &&
    !conhecimento.includes("CATÁLOGO REAL DO SITE")
      ? "\n\n=== PRODUTOS DO CATÁLOGO ===\n" +
        configIa.catalogoProdutos.slice(0, 20).map(formatarProdutoCurto).join("\n")
      : "";

  const instrucaoCompleta =
    `${promptSistema}${blocoExemplosTreinados}\n\n` +
    `=== INFORMAÇÕES EXCLUSIVAS DO DONO ===\n` +
    `${conhecimentoExtra}\n\n` +
    `=== BASE DE CONHECIMENTO DO SITE (${configIa.urlSite || "https://www.gaicos-store.com.br/"}) ===\n` +
    `${conhecimento}${blocoProdutosRapidos}`;

  let erroApi = null;

  if (provedor !== "local" && apiKey.length >= 10) {
    try {
      let respostaBruta = "";
      if (provedor === "gemini") {
        respostaBruta = await chamarGemini(instrucaoCompleta, historico, pergunta, apiKey, configIa.modelo || "gemini-2.5-flash");
      } else if (provedor === "groq") {
        respostaBruta = await chamarGroqComFallback(instrucaoCompleta, historico, pergunta, apiKey, configIa.modelo);
      } else if (provedor === "openai") {
        respostaBruta = await chamarOpenAICompativel(
          "https://api.openai.com/v1/chat/completions",
          instrucaoCompleta,
          historico,
          pergunta,
          apiKey,
          "gpt-4o-mini",
          configIa.modelo
        );
      }

      if (respostaBruta) {
        const pediuHumano = /\[CHAMAR_ATENDENTE\]/i.test(respostaBruta);
        let respostaLimpa = compactarRespostaCurta(respostaBruta.replace(/\[CHAMAR_ATENDENTE\]/gi, ""));
        if (pediuHumano && !respostaLimpa) {
          respostaLimpa = mensagemChamandoResponsavel(configIa);
        }
        registrarNoHistorico(jid, pergunta, respostaLimpa);
        registrarInteracaoRecente({
          cliente: nomeCliente || jid,
          pergunta,
          resposta: respostaLimpa,
          origem: provedor
        });
        return {
          resposta: respostaLimpa,
          chamarAtendente: pediuHumano,
          motivoEscalacao: pediuHumano ? "IA solicitou Gaicos em pessoa" : "",
          erroApi: null,
          origem: provedor
        };
      }
    } catch (err) {
      erroApi = `${provedor.toUpperCase()}: ${err.message}`;
      console.log(`⚠️ Aviso: Falha na API (${provedor}), usando resposta inteligente local:`, err.message);
    }
  }

  const local = responderModoLocalInteligente(pergunta, configIa, historico);
  registrarNoHistorico(jid, pergunta, local.resposta);
  registrarInteracaoRecente({
    cliente: nomeCliente || jid,
    pergunta,
    resposta: local.resposta,
    origem: local.origem
  });
  return { ...local, erroApi };
}
