// Serviço responsável por ler as páginas do site (ex: https://www.gaicos-store.com.br/)
// e organizar as informações para o atendimento inteligente no WhatsApp.

export const CONHECIMENTO_PADRAO_GAICOS = `=== INFORMAÇÕES OFICIAIS DA LOJA: GAICOS STORE ===
Site Oficial: https://www.gaicos-store.com.br/
Catálogo de Produtos: https://www.gaicos-store.com.br/produtos
Seção de Playmats: https://www.gaicos-store.com.br/playmats
Criar Playmat Personalizado (enviar própria arte): https://www.gaicos-store.com.br/criar-playmat

SOBRE A LOJA:
A Gaicos Store é uma loja virtual brasileira especializada em artigos, tapetes de jogo (playmats) e acessórios para TCG (Trading Card Games / Jogos de Cartas Colecionáveis), atendendo jogadores de:
- Yu-Gi-Oh!
- Magic: The Gathering (MTG)
- Pokémon TCG
- Outros Card Games

PRINCIPAIS PRODUTOS E PREÇOS DE REFERÊNCIA:
1. Playmat Personalizado (Crie com sua própria arte):
   - Link direto para criar no site: https://www.gaicos-store.com.br/criar-playmat
   - Como funciona: O cliente acessa a ferramenta interativa no site, envia sua própria imagem/arte, ajusta o visual e faz o pedido sob demanda. Acabamento em tecido de alta qualidade com base emborrachada antiderrapante.
   - Playmat Personalizado Tamanho M: a partir de R$ 178,00.
   - Playmat Personalizado Tamanho G (ex: 75x35 cm): a partir de R$ 198,00.

2. Playmats Temáticos e Coleções Exclusivas:
   - Link direto: https://www.gaicos-store.com.br/playmats e https://www.gaicos-store.com.br/produtos
   - Modelos exclusivos para Yu-Gi-Oh!, Magic: The Gathering e Pokémon TCG.
   - Edições especiais de criadores de conteúdo parceiros (como Getulino Edition, Duel Comic TCG, Irmãos Paradox, Playmaker BR).
   - Valores: variações a partir de R$ 199,00 (consultar o modelo desejado no catálogo do site).

3. Acessórios para TCG:
   - Artigos voltados para melhorar a proteção, organização e experiência de jogo em partidas e torneios de card games.
   - Disponíveis em: https://www.gaicos-store.com.br/produtos

FORMAS DE PAGAMENTO:
- Pix: Geração instantânea de QR Code e código "Pix Copia e Cola" diretamente na finalização do pedido pelo site, com aprovação imediata.
- Outras opções disponíveis diretamente no checkout do site.

FRETE, PRAZOS E ENTREGA:
- O valor do frete e o prazo de entrega variam conforme o CEP de destino.
- Para calcular o frete exato: basta adicionar o produto ao carrinho em https://www.gaicos-store.com.br/ e informar o CEP.
- Nos Playmats Personalizados (feitos sob demanda com a arte do cliente), há o prazo de produção/confecção antes do envio pelos Correios/transportadora.`;

function limparHtmlParaTexto(html) {
  if (!html || typeof html !== "string") return "";

  const tituloMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  let texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(h1|h2|h3|h4|p|div|li|tr|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  const linhas = texto
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(l => l.length > 2);

  // Remove linhas duplicadas seguidas mantendo a ordem
  const unicas = [];
  for (const l of linhas) {
    if (unicas[unicas.length - 1] !== l) {
      unicas.push(l);
    }
  }

  const cabecalho = [];
  if (tituloMatch?.[1]) cabecalho.push(`Título: ${tituloMatch[1].replace(/\s+/g, " ").trim()}`);
  if (descMatch?.[1]) cabecalho.push(`Descrição: ${descMatch[1].replace(/\s+/g, " ").trim()}`);

  return [...cabecalho, ...unicas].join("\n").slice(0, 6000);
}

function extrairLinksInternos(html, urlBase) {
  const links = new Set();
  try {
    const base = new URL(urlBase);
    const regex = /href=["']([^"'#]+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        const resolvido = new URL(match[1], base.origin);
        if (resolvido.hostname === base.hostname && /^https?:$/i.test(resolvido.protocol)) {
          if (!/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|woff2?|ttf|pdf)$/i.test(resolvido.pathname)) {
            links.add(resolvido.origin + resolvido.pathname.replace(/\/+$/, ""));
          }
        }
      } catch {}
    }
  } catch {}
  return Array.from(links);
}

async function baixarPagina(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GaicosBot/9.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("xml") && !contentType.includes("json")) {
      return null;
    }
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sincronizarConhecimentoSite(urlSite = "https://www.gaicos-store.com.br/") {
  let urlLimpa = String(urlSite || "https://www.gaicos-store.com.br/").trim();
  if (!/^https?:\/\//i.test(urlLimpa)) {
    urlLimpa = "https://" + urlLimpa;
  }

  let origem;
  try {
    origem = new URL(urlLimpa).origin;
  } catch {
    throw new Error("URL do site inválida. Use o formato https://www.gaicos-store.com.br/");
  }

  const urlsParaVisitar = new Set([
    origem,
    `${origem}/produtos`,
    `${origem}/playmats`,
    `${origem}/criar-playmat`
  ]);

  const trechosExtraidos = [];
  const paginasLidas = [];

  // Lê a página principal primeiro para descobrir novos links internos
  const htmlHome = await baixarPagina(urlLimpa);
  if (htmlHome) {
    paginasLidas.push(urlLimpa);
    const textoHome = limparHtmlParaTexto(htmlHome);
    if (textoHome.length > 40) {
      trechosExtraidos.push(`--- PÁGINA: ${urlLimpa} ---\n${textoHome}`);
    }
    for (const link of extrairLinksInternos(htmlHome, urlLimpa).slice(0, 8)) {
      urlsParaVisitar.add(link);
    }
  }

  for (const url of urlsParaVisitar) {
    if (paginasLidas.includes(url)) continue;
    if (paginasLidas.length >= 8) break;
    const html = await baixarPagina(url, 6000);
    if (!html) continue;
    paginasLidas.push(url);
    const texto = limparHtmlParaTexto(html);
    if (texto.length > 40) {
      trechosExtraidos.push(`--- PÁGINA: ${url} ---\n${texto}`);
    }
  }

  const ehGaicosStore = /gaicos-store\.com\.br/i.test(origem);
  const partes = [];

  if (ehGaicosStore) {
    partes.push(CONHECIMENTO_PADRAO_GAICOS);
  }

  if (trechosExtraidos.length > 0) {
    partes.push("=== CONTEÚDO EXTRAÍDO AUTOMATICAMENTE DO SITE ===\n" + trechosExtraidos.join("\n\n"));
  } else if (!ehGaicosStore) {
    throw new Error("Não foi possível acessar o conteúdo público dessa URL no momento. Verifique se o site está no ar.");
  }

  const textoFinal = partes.join("\n\n").slice(0, 24000);

  return {
    ok: true,
    urlSite: urlLimpa,
    paginasLidas,
    ultimaSincronizacao: new Date().toISOString(),
    conhecimentoSite: textoFinal
  };
}

