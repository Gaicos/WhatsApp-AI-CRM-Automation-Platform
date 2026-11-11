import fs from "node:fs";
import { CONHECIMENTO_PADRAO_GAICOS } from "./siteKnowledgeService.js";

const CAMINHO_APRENDIZADO = "./data/aprendizadoBot.json";

export const PROMPT_SISTEMA_PADRAO = `Você é o atendente virtual da Gaicos Store (https://www.gaicos-store.com.br/), loja de Playmats (personalizados e temáticos) e acessórios de TCG (Yu-Gi-Oh!, Magic, Pokémon).

REGRAS DE OURO (ESTILO CURTO E DINÂMICO):
1. Responda de forma CURTA, DINÂMICA e NATURAL (máximo de 2 a 4 linhas curtas), igual a um vendedor humano conversando no WhatsApp. NUNCA envie textos longos ou blocos gigantes de informações de uma vez.
2. Responda apenas o que o cliente perguntou e termine com uma pergunta rápida para manter o papo fluindo (ex: "Já tem a arte pronta ou quer ver os modelos do catálogo?").
3. Use sempre os dados reais da loja e os exemplos treinados pelo dono. Nunca invente preços ou prazos.
4. Envie apenas o link necessário para o momento da conversa:
   - Criar Playmat Personalizado: https://www.gaicos-store.com.br/criar-playmat
   - Catálogo Geral: https://www.gaicos-store.com.br/produtos
   - Playmats Temáticos: https://www.gaicos-store.com.br/playmats
5. Se o cliente pedir para falar com um atendente/humano, tiver problema com pedido já feito ou quiser negociar algo especial, coloque a tag [CHAMAR_ATENDENTE] no final da resposta.`;

export const CONHECIMENTO_EXTRA_PADRAO = `- Playmats feitos com impressão de alta definição e base emborrachada antiderrapante.
- Para Playmat Personalizado, recomendamos enviar imagem em boa resolução no criador do site (https://www.gaicos-store.com.br/criar-playmat).
- Para dúvidas sobre pedido já realizado ou comprovante, oriente a digitar *atendente*.`;

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
    "por", "para", "com", "sem", "que", "qual", "quais", "como", "onde", "quando",
    "voce", "voces", "vcs", "vc", "eu", "meu", "minha", "oi", "ola", "opa", "bom", "boa",
    "dia", "tarde", "noite", "tudo", "bem", "sobre", "loja", "site", "ai", "la", "me", "te", "se", "eh", "e"
  ]);
  return normalizarTextoBusca(str)
    .split(" ")
    .filter(t => t.length >= 2 && !stopWords.has(t));
}

function lerArquivoAprendizado() {
  if (!fs.existsSync(CAMINHO_APRENDIZADO)) {
    return { exemplos: [], interacoesRecentes: [] };
  }
  try {
    const lido = JSON.parse(fs.readFileSync(CAMINHO_APRENDIZADO, "utf-8"));
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
    fs.mkdirSync("./data", { recursive: true });
    const tmp = `${CAMINHO_APRENDIZADO}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf-8");
    fs.renameSync(tmp, CAMINHO_APRENDIZADO);
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

  // Atualiza também nas interações recentes caso tenha sido corrigida de lá
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

// Motor de similaridade que verifica se o dono já ensinou o bot a responder essa pergunta ou variação parecida
function buscarRespostaAprendida(perguntaCliente, exemplos = []) {
  if (!Array.isArray(exemplos) || exemplos.length === 0) return null;

  const normPergunta = normalizarTextoBusca(perguntaCliente);
  if (!normPergunta) return null;

  const tokensPergunta = extrairTokensRelevantes(perguntaCliente);
  let melhorMatch = null;
  let maiorScore = 0;

  for (const ex of exemplos) {
    // Suporta múltiplos gatilhos separados por "|" ou "/" se o usuário quiser (ex: "qual o prazo | demora quanto tempo")
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

  // Se a similaridade for forte (>= 0.62), usa diretamente a resposta ensinada pelo dono
  if (melhorMatch && maiorScore >= 0.62) {
    return melhorMatch;
  }
  return null;
}

export function limparHistoricoCliente(jid) {
  historicoClientes.delete(jid);
}

function obterHistorico(jid) {
  const item = historicoClientes.get(jid);
  if (!item) return [];
  if (Date.now() - item.atualizadoEm > TTL_HISTORICO_MS) {
    historicoClientes.delete(jid);
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
  historicoClientes.set(jid, { atualizadoEm: Date.now(), mensagens: atual });
}

export function clientePediuAtendenteHumano(texto) {
  const limpo = normalizarTextoBusca(texto);
  if (!limpo) return false;
  if (limpo === "0" || limpo === "atendente" || limpo === "humano" || limpo === "suporte") return true;

  return /\b(falar com (um |uma )?(atendente|humano|pessoa|vendedor|alguem|suporte|gerente)|quero (um )?(atendente|humano)|atendimento humano|chamar (um )?(atendente|humano)|passar para (atendente|humano))\b/i.test(limpo);
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

// Respostas locais curtas, diretas e dinâmicas (estilo conversa real de WhatsApp)
function responderModoLocalInteligente(pergunta, configIa = {}) {
  const base = (configIa.conhecimentoSite || CONHECIMENTO_PADRAO_GAICOS).trim();
  const extra = (configIa.conhecimentoExtra || CONHECIMENTO_EXTRA_PADRAO).trim();
  const textoOriginal = String(pergunta || "").trim();
  const t = normalizarTextoBusca(textoOriginal);

  if (clientePediuAtendenteHumano(textoOriginal)) {
    return {
      resposta: configIa.mensagemTransferenciaHumano || "Já chamei um atendente da *Gaicos Store* pra falar com você! Só um instante que já te respondemos por aqui. 👤",
      chamarAtendente: true,
      origem: "local"
    };
  }

  // Saudações iniciais curtas e dinâmicas
  if (/^(oi+|ola+|opa+|bom dia|boa tarde|boa noite|e ai|tudo bem|start|menu)\b/.test(t) && t.split(/\s+/).length <= 5) {
    return {
      resposta:
        "Opa, tudo bem? Bem-vindo(a) à *Gaicos Store*! 🎴\n" +
        "Você tá procurando um *Playmat Personalizado* (com a sua arte) ou algum modelo *Temático* (Yu-Gi-Oh!, Magic, Pokémon)?",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 1. Verifica primeiro se há uma regra/segredo específico nas informações exclusivas do dono
  const dicasDoDono = buscarTrechosExtrasDoDono(t, extra);

  // 2. Playmat personalizado / arte própria
  if (/(personaliz|minha arte|propria arte|enviar imagem|enviar foto|sob medida|criar playmat|fazer playmat|custom)/.test(t)) {
    const complemento = dicasDoDono.length > 0 ? `\n\n💡 ${dicasDoDono[0]}` : "";
    return {
      resposta:
        "No *Playmat Personalizado* você sobe a sua própria imagem direto no criador do site:\n" +
        "👉 https://www.gaicos-store.com.br/criar-playmat\n\n" +
        "O tamanho *M sai R$ 178* e o *G (75x35cm) sai R$ 198*." + complemento + " Já tem a arte que quer estampar?",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 3. Preços / valores / quanto custa
  if (/(preco|valor|quanto custa|quanto ta|quanto sai|valores|orcamento)/.test(t)) {
    return {
      resposta:
        "Os valores dos playmats são:\n" +
        "• *Personalizado M:* R$ 178 | *G (75x35cm):* R$ 198\n" +
        "• *Temáticos / Coleções:* a partir de R$ 199\n\n" +
        "Qual estilo você curte mais? (Catálogo: https://www.gaicos-store.com.br/produtos)",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 4. Pagamento / Pix
  if (/(pix|pagar|pagamento|forma de pagamento|cartao|parcela|boleto|qr code)/.test(t)) {
    return {
      resposta:
        "Lá no site (https://www.gaicos-store.com.br/) você paga rapidinho via *Pix* (gera QR Code e Copia e Cola na hora) ou pelas opções do checkout! 💳",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 5. Frete / Prazo / CEP / Entrega
  if (/(frete|entrega|prazo|cep|envio|correio|transportadora|demora|chega|rastreio)/.test(t)) {
    const infoExtra = dicasDoDono.length > 0 ? `${dicasDoDono[0]}\n` : "";
    return {
      resposta:
        `${infoExtra}O valor e prazo do frete são calculados pelo seu *CEP* direto no carrinho em https://www.gaicos-store.com.br/produtos 🚚\n` +
        "Se for sobre um pedido já feito, digite *atendente* que nossa equipe vê pra você!",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 6. Parceiros / Criadores
  if (/(parceiro|criador|getulino|duel comic|paradox|playmaker)/.test(t)) {
    return {
      resposta:
        "Temos edições oficiais de parceiros como *Getulino*, *Duel Comic TCG*, *Irmãos Paradox* e *Playmaker BR*! 🤝\n" +
        "Confira os modelos em: https://www.gaicos-store.com.br/playmats",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 7. Jogos / Temáticos / Catálogo (Yu-Gi-Oh, Magic, Pokémon, playmat)
  if (/(yugioh|yu gi oh|magic|mtg|pokemon|tcg|tematico|catalogo|modelo|acessorio|sleeve|deck|playmat|tapete)/.test(t)) {
    return {
      resposta:
        "Trabalhamos com playmats de *Yu-Gi-Oh!*, *Magic* e *Pokémon* (a partir de R$ 199) e também fazemos *Personalizado* com a sua arte (a partir de R$ 178)!\n" +
        "Veja os modelos aqui: https://www.gaicos-store.com.br/playmats — qual card game você joga?",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 8. Se bateu em alguma informação exclusiva do dono
  if (dicasDoDono.length > 0) {
    return {
      resposta: dicasDoDono.join("\n") + "\n\nPosso te ajudar com mais algum detalhe?",
      chamarAtendente: false,
      origem: "local"
    };
  }

  // 9. Busca curta na base do site
  const tokens = extrairTokensRelevantes(t);
  if (tokens.length > 0) {
    const linhasBase = base.split(/\r?\n/).filter(l => l.trim().length > 10 && !l.startsWith("===") && !l.startsWith("---"));
    const relevante = linhasBase.find(linha => {
      const lNorm = normalizarTextoBusca(linha);
      return tokens.some(p => p.length >= 4 && lNorm.includes(p));
    });
    if (relevante) {
      return {
        resposta: `${relevante.trim()}\n👉 Confira no site: https://www.gaicos-store.com.br/`,
        chamarAtendente: false,
        origem: "local"
      };
    }
  }

  return {
    resposta:
      "Aqui na *Gaicos Store* fazemos *Playmats Personalizados* com a sua arte (https://www.gaicos-store.com.br/criar-playmat) e temos vários *Temáticos de TCG* (https://www.gaicos-store.com.br/produtos)!\n" +
      "Qual modelo você gostaria de ver? _(Ou digite *atendente* para falar com nossa equipe)_",
    chamarAtendente: false,
    origem: "local"
  };
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
        temperature: 0.35,
        maxOutputTokens: 350
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
      temperature: 0.35,
      max_tokens: 350
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
  if (!pergunta) {
    return { resposta: "Opa! Como posso te ajudar hoje na Gaicos Store?", chamarAtendente: false, origem: "local" };
  }

  if (clientePediuAtendenteHumano(pergunta)) {
    const msgTransferencia = (configIa.mensagemTransferenciaHumano || "").trim()
      || "Já chamei um atendente da *Gaicos Store* pra falar com você! Só um instante que já te respondemos por aqui. 👤";
    return {
      resposta: msgTransferencia,
      chamarAtendente: true,
      origem: "atalho-humano"
    };
  }

  const dadosAprendizado = lerArquivoAprendizado();
  const exemplos = dadosAprendizado.exemplos || [];

  // 1. Verifica primeiro na Memória de Aprendizado (Exemplos que o dono já ensinou/corrigiu)
  const matchAprendido = buscarRespostaAprendida(pergunta, exemplos);
  if (matchAprendido) {
    const pediuHumano = /\[CHAMAR_ATENDENTE\]/i.test(matchAprendido.resposta);
    const respLimpa = matchAprendido.resposta.replace(/\[CHAMAR_ATENDENTE\]/gi, "").trim();
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
      origem: "aprendizado-treinado"
    };
  }

  const provedor = String(configIa.provedor || "local").toLowerCase().trim();
  const apiKey = String(configIa.apiKey || "").trim();
  const promptSistema = (configIa.promptSistema || PROMPT_SISTEMA_PADRAO).trim();
  const conhecimento = (configIa.conhecimentoSite || CONHECIMENTO_PADRAO_GAICOS).trim();
  const conhecimentoExtra = (configIa.conhecimentoExtra || CONHECIMENTO_EXTRA_PADRAO).trim();

  const blocoExemplosTreinados = exemplos.length > 0
    ? "\n\n=== EXEMPLOS TREINADOS PELO DONO (APRENDIZADO DO BOT - SIGA EXATAMENTE ESTE ESTILO E CONTEÚDO) ===\n" +
      exemplos.slice(0, 25).map(e => `Cliente: "${e.pergunta}"\nResposta Ideal: "${e.resposta}"`).join("\n---\n")
    : "";

  const instrucaoCompleta =
    `${promptSistema}${blocoExemplosTreinados}\n\n` +
    `=== INFORMAÇÕES EXCLUSIVAS DO DONO (PRIORIDADE MÁXIMA) ===\n` +
    `${conhecimentoExtra}\n\n` +
    `=== BASE DE CONHECIMENTO DO SITE (${configIa.urlSite || "https://www.gaicos-store.com.br/"}) ===\n` +
    `${conhecimento}`;

  const historico = obterHistorico(jid);

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
        let respostaLimpa = respostaBruta.replace(/\[CHAMAR_ATENDENTE\]/gi, "").trim();
        if (pediuHumano && !respostaLimpa) {
          respostaLimpa = (configIa.mensagemTransferenciaHumano || "").trim()
            || "Já chamei um atendente da *Gaicos Store* pra falar com você! Só um instante. 👤";
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
          origem: provedor
        };
      }
    } catch (err) {
      console.log(`⚠️ Aviso: Falha na API (${provedor}), usando resposta inteligente local:`, err.message);
    }
  }

  const local = responderModoLocalInteligente(pergunta, configIa);
  registrarNoHistorico(jid, pergunta, local.resposta);
  registrarInteracaoRecente({
    cliente: nomeCliente || jid,
    pergunta,
    resposta: local.resposta,
    origem: local.origem
  });
  return local;
}
