import fs from "node:fs";
import { CONHECIMENTO_PADRAO_GAICOS } from "./siteKnowledgeService.js";
import { salvarChaveNoSupabase } from "./supabaseService.js";
import { caminhoArquivoTenant, chaveSupabaseTenant, obterTenantAtual } from "./tenantContext.js";

export const PROMPT_SISTEMA_PADRAO = `Você é o Gaicos Jr, vendedor especialista da Gaicos Store (https://www.gaicos-store.com.br/), apaixonado por TCG e playmats.

OBJETIVO PRINCIPAL: CONVERTER EM VENDA COM CARISMA E HUMANIDADE.

REGRAS DE OURO (ESTILO WHATSAPP HUMANO — PROIBIDO TEXTÃO):
1. SEJA CURTO E DIRETO: responda em no máximo 2 a 4 linhas curtas e naturais. Cliente nenhum lê textão no WhatsApp.
2. CARISMA E PERSUASÃO: converse como um vendedor parceiro (leve, confiante e empolgado), destacando diferenciais reais que fazem o cliente desejar o playmat — tecido liso que faz as cartas deslizarem sem arranhar os sleeves, base emborrachada que trava na mesa, arte expandida em alta definição e proteção oficial em torneios.
3. ANCORAGEM E URGÊNCIA SUTIL: quando citar produto em promoção, mostre a vantagem ("de R$ X por apenas R$ Y no Pix"). Em personalizados, valorize ter um tapete único com a arte do próprio deck.
4. CONDUZA PARA O FECHAMENTO: termine quase toda resposta com 1 micro-pergunta fácil de responder (ex: "Você joga mais Yu-Gi-Oh!, Magic ou Pokémon?", "Prefere o tamanho M (60x35) ou o G (75x35) pra ter mais espaço?").
5. LINK CERTO NA HORA CERTA: mande apenas 1 link direto do produto ou página certa (personalizado: https://www.gaicos-store.com.br/pedido-personalizado | catálogo: https://www.gaicos-store.com.br/catalogo).
6. REGRA CRÍTICA DE ESCALAÇÃO PARA O GAICOS EM PESSOA:
   Nunca invente preço, prazo, estoque ou informação que não esteja na base abaixo.
   Coloque exatamente a tag [CHAMAR_ATENDENTE] no final da sua resposta E diga com simpatia que vai chamar o Gaicos em pessoa agora mesmo se acontecer QUALQUER uma dessas situações:
   - O cliente pedir para falar com humano/dono/atendente ou tiver dúvida sobre pedido já feito;
   - Você não tiver certeza absoluta da resposta com base nos dados reais do site;
   - O cliente reclamar, disser que você entendeu errado ou demonstrar insatisfação;
   - O cliente estiver dando respostas secas/sem interação ou quiser negociar encomenda especial/atacado.`;

export const CONHECIMENTO_EXTRA_PADRAO = `- Playmats com tecido liso de deslizamento suave (protege seus sleeves) e base em borracha antiderrapante.
- Tamanho M (60x35cm): padrão oficial para tubos e torneios. Tamanho G (75x35cm): estendido, ideal para decks cheios de fichas e terrenos.
- Pagamento rápido no checkout via Pix (QR Code e Copia e Cola gerados na hora).`;

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
    ? `de ~${p.preco}~ por *${p.precoPromo}* (em promoção)`
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

function mensagemChamandoResponsavel(configIa = {}) {
  const custom = String(configIa.mensagemTransferenciaHumano || "").trim();
  if (custom) return custom;
  const responsavel = String(configIa.nomeResponsavel || "Gaicos").trim();
  return `Opa! Pra te atender certinho sem erro, já tô chamando o *${responsavel} em pessoa* aqui pra falar com você agora mesmo! Só um segundinho 🙌`;
}

// Gaicos Jr local: vendedor carismático, persuasivo e enxuto (2–4 linhas, sem textão)
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

  // Saudação curta com gancho de venda imediato
  if (/^(oi+|ola+|opa+|bom dia|boa tarde|boa noite|e ai|tudo bem|salve|start|menu)\b/.test(t) && t.split(/\s+/).length <= 5) {
    return {
      resposta:
        `E aí, tudo massa? Aqui é o *${nomeBot}* da Gaicos Store! 🎴\n` +
        `Quer deixar sua mesa absurda com um *Playmat Personalizado* (com a sua arte) ou já quer dar uma olhada nos *modelos de TCG* em promoção?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  const dicasDoDono = buscarTrechosExtrasDoDono(t, extra);
  const produtosEncontrados = buscarProdutosNoCatalogo(textoOriginal, configIa);

  // 1. Promoções / Ofertas em destaque no catálogo real
  if (/(promo|promocao|promocoes|oferta|ofertas|desconto no site|liquidacao)/.test(t) && produtosEncontrados.length > 0) {
    const linhas = produtosEncontrados.map(formatarProdutoCurto).join("\n");
    return {
      resposta:
        `Temos promoções rolando agora com preço lá embaixo 🔥:\n${linhas}\n` +
        `Qual desses combina mais com o seu deck?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 2. Playmat personalizado / arte própria
  if (/(personaliz|minha arte|propria arte|enviar imagem|enviar foto|sob medida|criar playmat|fazer playmat|custom|foto)/.test(t)) {
    const linkPers = /gaicos-store/i.test(urlBase) ? `${urlBase}/pedido-personalizado` : urlBase;
    return {
      resposta:
        `Seu deck merece um tapete único! Tecido liso que protege seus sleeves e base emborrachada que não escorrega na mesa ✨\n` +
        `• *Tamanho M (60x35):* R$ 178 | *Tamanho G (75x35):* R$ 198\n` +
        `Sobe sua arte direto aqui 👉 ${linkPers} — prefere o M ou o G?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 3. Produto específico encontrado no catálogo real do site (ex: Eldrazi, Pokémon, Blue-Eyes, etc.)
  if (produtosEncontrados.length > 0 && !/^(preco|valor|pix|frete)$/.test(t)) {
    const linhas = produtosEncontrados.map(formatarProdutoCurto).join("\n");
    return {
      resposta:
        `Olha essa pedrada que tá disponível no site 👇\n${linhas}\n` +
        `Tecido macio com base antiderrapante e Pix na hora. Quer garantir o tamanho M ou G?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 4. Objeção de preço / desconto / cupom
  if (/(caro|salgado|puxado|desconto|cupom|mais barato)/.test(t)) {
    return {
      resposta:
        `Cara, ele dura anos sem desfiar e ainda protege seus sleeves em todo torneio — sai mais barato que trocar sleeve riscado! 😉\n` +
        `E temos temáticos em promo a partir de *R$ 175* no Pix. Quer que eu chame o *${responsavel} em pessoa* se precisar de algo especial?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 5. Preços / valores gerais
  if (/(preco|valor|quanto custa|quanto ta|quanto sai|valores|orcamento)/.test(t)) {
    return {
      resposta:
        `• *Personalizado (sua arte):* M por *R$ 178* · G (75x35) por *R$ 198*\n` +
        `• *Temáticos (Yu-Gi-Oh!, Magic, Pokémon):* a partir de *R$ 175* na promo!\n` +
        `Qual jogo você joga pra eu te indicar o modelo mais irado? 🎴`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 6. Pagamento / Pix
  if (/(pix|pagar|pagamento|forma de pagamento|cartao|parcela|boleto|qr code)/.test(t)) {
    return {
      resposta:
        `No checkout do site você paga rapidinho no *Pix* (QR Code e Copia e Cola com aprovação imediata) ou pelas opções disponíveis na finalização! 💳\n` +
        `Já escolheu seu modelo ou quer o link do catálogo?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 7. Frete / Prazo / CEP / Troca
  if (/(frete|entrega|prazo|cep|envio|correio|transportadora|demora|chega|troca|devol)/.test(t)) {
    return {
      resposta:
        `Você calcula o frete e prazo exatos colocando o CEP no carrinho lá em ${urlBase}/catalogo 🚚\n` +
        `Se já fez um pedido e quer acompanhar, me avisa que chamo o *${responsavel} em pessoa* na hora!`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 8. Jogos / Catálogo geral
  if (/(yugioh|yu gi oh|magic|mtg|pokemon|tcg|tematico|catalogo|modelo|playmat|tapete|tamanho|medida)/.test(t)) {
    return {
      resposta:
        `Temos coleções pesadas de *Yu-Gi-Oh!*, *Magic* e *Pokémon* (a partir de R$ 175 em promo) nos tamanhos *M (60x35)* e *G (75x35)* 🔥\n` +
        `Dá uma olhada aqui 👉 ${urlBase}/catalogo — qual carta/deck você curte?`,
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 9. Informação exclusiva do dono
  if (dicasDoDono.length > 0) {
    return {
      resposta: `${dicasDoDono[0]}\nQuer que eu te mande o link direto pra fechar o seu?`,
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
        resposta: `${relevante.trim().slice(0, 220)}\nQuer ver mais detalhes lá no site (${urlBase}/catalogo)?`,
        chamarAtendente: false,
        origem: "local"
      };
    }
  }

  // 11. Sem confiança suficiente na base local -> chama o Gaicos em pessoa em vez de chutar resposta errada!
  return {
    resposta: mensagemChamandoResponsavel(configIa),
    chamarAtendente: true,
    motivoEscalacao: "Dúvida fora da base — evitando resposta incorreta",
    origem: "escalacao-baixa-confianca"
  };
}

export function compactarRespostaCurta(texto) {
  return String(texto || "")
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
        temperature: 0.65,
        maxOutputTokens: 240
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
      temperature: 0.65,
      max_tokens: 240
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

export async function gerarRespostaAtendimento({ jid = "simulacao", nomeCliente = "", mensagemCliente, configIa = {} }) {
  const pergunta = String(mensagemCliente || "").trim();
  const nomeBot = String(configIa.nomeBot || "Gaicos Jr").trim();

  if (!pergunta) {
    return {
      resposta: `Opa! Aqui é o *${nomeBot}*! Como posso te ajudar a escolher seu playmat hoje?`,
      chamarAtendente: false,
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

  if (provedor !== "local" && apiKey.length >= 10) {
    try {
      let respostaBruta = "";
      if (provedor === "gemini") {
        respostaBruta = await chamarGemini(instrucaoCompleta, historico, pergunta, apiKey, configIa.modelo || "gemini-2.5-flash");
      } else if (provedor === "groq") {
        respostaBruta = await chamarOpenAICompativel(
          "https://api.groq.com/openai/v1/chat/completions",
          instrucaoCompleta,
          historico,
          pergunta,
          apiKey,
          "llama-3.3-70b-versatile",
          configIa.modelo
        );
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
          origem: provedor
        };
      }
    } catch (err) {
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
  return local;
}
