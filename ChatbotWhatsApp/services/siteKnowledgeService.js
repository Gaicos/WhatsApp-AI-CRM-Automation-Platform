// Serviço responsável por ler as páginas, catálogos JSON e FAQs de sites (SPA, Shopify, WooCommerce ou HTML)
// e organizar as informações em formato compacto para o atendimento no WhatsApp.

export const CONHECIMENTO_PADRAO_GAICOS = `=== INFORMAÇÕES OFICIAIS DA LOJA: GAICOS STORE ===
Site Oficial: https://www.gaicos-store.com.br/
Catálogo de Produtos: https://www.gaicos-store.com.br/catalogo
Playmats e Produtos: https://www.gaicos-store.com.br/produtos
Criar Playmat Personalizado (enviar própria arte): https://www.gaicos-store.com.br/pedido-personalizado
Perguntas Frequentes (FAQ): https://www.gaicos-store.com.br/conta/faq

SOBRE A LOJA:
A Gaicos Store é uma loja brasileira especializada em playmats (tapetes de jogo) e acessórios para TCG (Yu-Gi-Oh!, Magic: The Gathering, Pokémon TCG e outros card games), com tecido liso que protege os sleeves, impressão nítida em cores vibrantes e base emborrachada antiderrapante.

TAMANHOS E VALORES DE REFERÊNCIA:
- Playmat Personalizado Tamanho M (60x35cm): R$ 178,00 (https://www.gaicos-store.com.br/pedido-personalizado)
- Playmat Personalizado Tamanho G (75x35cm): R$ 198,00 (https://www.gaicos-store.com.br/pedido-personalizado)
- Playmats Temáticos e Coleções Exclusivas (Yu-Gi-Oh!, Magic, Pokémon): a partir de R$ 175,00 em promoções ou R$ 199,00 (https://www.gaicos-store.com.br/produtos)

PAGAMENTO, FRETE E GARANTIA:
- Pix com aprovação imediata (QR Code e Copia e Cola gerados na hora no checkout) e cartão.
- Frete e prazo calculados direto pelo CEP no carrinho em https://www.gaicos-store.com.br/.
- Troca/devolução garantida entrando em contato pelos canais oficiais informando o número do pedido.`;

export function formatarPrecoReal(valorEmCentavosOuReais, { emCentavos = true } = {}) {
  if (valorEmCentavosOuReais === null || valorEmCentavosOuReais === undefined || valorEmCentavosOuReais === "") {
    return "";
  }
  const numero = Number(String(valorEmCentavosOuReais).replace(",", "."));
  if (!Number.isFinite(numero) || numero <= 0) return "";
  const reais = emCentavos ? numero / 100 : numero;
  return `R$ ${reais.toFixed(2).replace(".", ",")}`;
}

function resumirTextoCompacto(str, maxLen = 170) {
  const limpo = String(str || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return "";
  if (limpo.length <= maxLen) return limpo;
  const corte = limpo.slice(0, maxLen).replace(/\s+\S*$/, "").trim();
  return `${corte || limpo.slice(0, maxLen).trim()}...`;
}

export function extrairCatalogoDeJson(produtosBrutos, origem = "https://www.gaicos-store.com.br") {
  let lista = [];
  let formato = "custom";

  if (Array.isArray(produtosBrutos)) {
    lista = produtosBrutos;
    if (lista[0]?.prices && !lista[0]?.priceCents) {
      formato = "woocommerce";
    }
  } else if (Array.isArray(produtosBrutos?.products)) {
    lista = produtosBrutos.products;
    formato = "shopify";
  } else if (Array.isArray(produtosBrutos?.items || produtosBrutos?.data)) {
    lista = produtosBrutos.items || produtosBrutos.data;
  }

  const baseOrigem = String(origem || "https://www.gaicos-store.com.br").replace(/\/+$/, "");
  const resultados = [];

  for (const p of lista) {
    if (!p || p.active === false) continue;

    if (formato === "shopify") {
      const variante = Array.isArray(p.variants) ? p.variants[0] : null;
      const preco = formatarPrecoReal(variante?.price, { emCentavos: false });
      const precoAntigo = formatarPrecoReal(variante?.compare_at_price, { emCentavos: false });
      const emPromocao = Boolean(precoAntigo && preco && precoAntigo !== preco);
      const slug = p.handle ? `/products/${p.handle}` : "/products";
      resultados.push({
        nome: String(p.title || "").trim(),
        categoria: String(p.product_type || "Catálogo").trim(),
        preco: emPromocao ? precoAntigo : preco,
        precoPromo: emPromocao ? preco : "",
        emPromocao,
        personalizavel: false,
        resumo: resumirTextoCompacto(p.body_html || ""),
        link: `${baseOrigem}${slug}`
      });
      continue;
    }

    if (formato === "woocommerce") {
      const minor = Number(p.prices?.currency_minor_unit ?? 2);
      const divisor = 10 ** minor;
      const precoAtualNum = Number(p.prices?.price) / divisor;
      const precoRegularNum = Number(p.prices?.regular_price || p.prices?.price) / divisor;
      const emPromocao = Boolean(precoRegularNum > precoAtualNum && precoAtualNum > 0);
      resultados.push({
        nome: String(p.name || "").trim(),
        categoria: String(p.categories?.[0]?.name || "Catálogo").trim(),
        preco: formatarPrecoReal(emPromocao ? precoRegularNum : precoAtualNum, { emCentavos: false }),
        precoPromo: emPromocao ? formatarPrecoReal(precoAtualNum, { emCentavos: false }) : "",
        emPromocao,
        personalizavel: false,
        resumo: resumirTextoCompacto(p.short_description || p.description || ""),
        link: p.permalink || `${baseOrigem}/produtos`
      });
      continue;
    }

    const preco = formatarPrecoReal(p.priceCents, { emCentavos: true })
      || formatarPrecoReal(p.price, { emCentavos: false });
    const precoPromo = formatarPrecoReal(p.promoPriceCents, { emCentavos: true })
      || formatarPrecoReal(p.promoPrice, { emCentavos: false });
    const emPromocao = Boolean(p.isPromo && precoPromo);
    const rota = p.customizable
      ? "/pedido-personalizado"
      : (p.slug ? `/produto/${p.slug}` : "/produtos");

    resultados.push({
      nome: String(p.name || p.title || "").trim(),
      categoria: String(p.categoryName || p.category || "Catálogo").trim(),
      preco,
      precoPromo: emPromocao ? precoPromo : "",
      emPromocao,
      personalizavel: !!p.customizable,
      resumo: resumirTextoCompacto(p.description || ""),
      link: `${baseOrigem}${rota}`
    });
  }

  return resultados.filter(item => item.nome);
}

export function extrairFaqDeBundleJs(jsTexto) {
  if (!jsTexto || typeof jsTexto !== "string") return [];
  const faqs = [];
  const vistas = new Set();

  // Suporta strings delimitadas por crase, aspas duplas ou aspas simples
  const padrao = /question\s*:\s*([`"'])([\s\S]*?)\1\s*,\s*answer\s*:\s*([`"'])([\s\S]*?)\3/g;
  let match;
  while ((match = padrao.exec(jsTexto)) !== null) {
    const pergunta = match[2].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    const resposta = match[4].replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    if (pergunta.length > 5 && resposta.length > 5 && !vistas.has(pergunta)) {
      vistas.add(pergunta);
      faqs.push({ pergunta, resposta });
    }
    if (faqs.length >= 25) break;
  }
  return faqs;
}

function extrairJsonLd(html, origem) {
  const produtos = [];
  const faqs = [];
  if (!html || typeof html !== "string") return { produtos, faqs };

  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const blocos = Array.isArray(parsed) ? parsed : [parsed];
      for (const b of blocos) {
        if (!b || typeof b !== "object") continue;
        if (b["@type"] === "Product" && b.name) {
          const offer = Array.isArray(b.offers) ? b.offers[0] : b.offers;
          const preco = formatarPrecoReal(offer?.price, { emCentavos: false });
          produtos.push({
            nome: String(b.name).trim(),
            categoria: String(b.category || "Catálogo").trim(),
            preco,
            precoPromo: "",
            emPromocao: false,
            personalizavel: false,
            resumo: resumirTextoCompacto(b.description || ""),
            link: offer?.url || origem
          });
        } else if (b["@type"] === "FAQPage" && Array.isArray(b.mainEntity)) {
          for (const q of b.mainEntity) {
            const p = String(q?.name || "").trim();
            const r = String(q?.acceptedAnswer?.text || "").trim();
            if (p && r) faqs.push({ pergunta: p, resposta: r });
          }
        }
      }
    } catch {}
  }

  return { produtos, faqs };
}

function limparHtmlParaTexto(html) {
  if (!html || typeof html !== "string") return "";

  const tituloMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  const texto = html
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

async function baixarTexto(url, timeoutMs = 8000, maxBytes = 1500000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GaicosBot/9.2",
        "Accept": "text/html,application/json,application/javascript,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });
    if (!resp.ok) return null;
    const cl = Number(resp.headers.get("content-length") || 0);
    if (cl > maxBytes) return null;
    const texto = await resp.text();
    if (texto.length > maxBytes) return texto.slice(0, maxBytes);
    return texto;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function baixarJson(url, timeoutMs = 8000) {
  const txt = await baixarTexto(url, timeoutMs, 1000000);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function formatarSecaoCatalogo(produtos = []) {
  if (!produtos.length) return "";
  const porCategoria = new Map();
  for (const p of produtos) {
    const cat = p.categoria || "Catálogo";
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(p);
  }

  const linhas = ["=== CATÁLOGO REAL DO SITE ==="];
  for (const [categoria, itens] of porCategoria.entries()) {
    linhas.push(`\n[${categoria}]`);
    for (const item of itens) {
      const precoTxt = item.emPromocao && item.precoPromo
        ? `Promoção de ${item.preco} por ${item.precoPromo}`
        : (item.preco || "Consultar no site");
      const resumoTxt = item.resumo ? ` — ${item.resumo}` : "";
      linhas.push(`• ${item.nome} | ${precoTxt} | ${item.link}${resumoTxt}`);
    }
  }
  return linhas.join("\n");
}

function formatarSecaoFaq(faqs = []) {
  if (!faqs.length) return "";
  const linhas = ["=== PERGUNTAS FREQUENTES (FAQ DO SITE) ==="];
  for (const f of faqs) {
    linhas.push(`• P: ${f.pergunta}\n  R: ${f.resposta}`);
  }
  return linhas.join("\n");
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

  const paginasLidas = [];
  const trechosExtraidos = [];
  let produtos = [];
  let faqs = [];

  // 1. Consulta endpoints públicos de catálogo (API REST, Shopify, WooCommerce) e a home HTML em paralelo
  const [apiCustom, apiShopify, apiWoo, htmlHome] = await Promise.all([
    baixarJson(`${origem}/api/products`),
    baixarJson(`${origem}/products.json?limit=50`),
    baixarJson(`${origem}/wp-json/wc/store/v1/products?per_page=50`),
    baixarTexto(urlLimpa, 8000, 800000)
  ]);

  if (apiCustom) {
    produtos = extrairCatalogoDeJson(apiCustom, origem);
    if (produtos.length) paginasLidas.push(`${origem}/api/products`);
  }
  if (!produtos.length && apiShopify) {
    produtos = extrairCatalogoDeJson(apiShopify, origem);
    if (produtos.length) paginasLidas.push(`${origem}/products.json`);
  }
  if (!produtos.length && apiWoo) {
    produtos = extrairCatalogoDeJson(apiWoo, origem);
    if (produtos.length) paginasLidas.push(`${origem}/wp-json/wc/store/v1/products`);
  }

  if (htmlHome) {
    paginasLidas.push(urlLimpa);
    const ld = extrairJsonLd(htmlHome, origem);
    if (!produtos.length && ld.produtos.length) produtos = ld.produtos;
    if (ld.faqs.length) faqs.push(...ld.faqs);

    const textoHome = limparHtmlParaTexto(htmlHome);
    const ehSpaShell = htmlHome.length < 2500 && /<script[^>]+src=/i.test(htmlHome);

    if (ehSpaShell) {
      const scriptMatch = htmlHome.match(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/i);
      if (scriptMatch?.[1]) {
        try {
          const urlBundle = new URL(scriptMatch[1], origem).href;
          const jsBundle = await baixarTexto(urlBundle, 9000, 1500000);
          if (jsBundle) {
            const faqsJs = extrairFaqDeBundleJs(jsBundle);
            if (faqsJs.length) {
              faqs.push(...faqsJs);
              paginasLidas.push(urlBundle);
            }
          }
        } catch {}
      }
      if (textoHome.length > 15) {
        trechosExtraidos.push(`--- SITE (${urlLimpa}) ---\n${textoHome}`);
      }
    } else {
      if (textoHome.length > 40) {
        trechosExtraidos.push(`--- PÁGINA: ${urlLimpa} ---\n${textoHome}`);
      }
      const urlsParaVisitar = new Set(extrairLinksInternos(htmlHome, urlLimpa).slice(0, 6));
      for (const url of urlsParaVisitar) {
        if (paginasLidas.includes(url) || paginasLidas.length >= 8) break;
        const html = await baixarTexto(url, 6000, 600000);
        if (!html) continue;
        paginasLidas.push(url);
        const ldSub = extrairJsonLd(html, origem);
        if (ldSub.produtos.length) produtos.push(...ldSub.produtos);
        if (ldSub.faqs.length) faqs.push(...ldSub.faqs);
        const texto = limparHtmlParaTexto(html);
        if (texto.length > 40) {
          trechosExtraidos.push(`--- PÁGINA: ${url} ---\n${texto}`);
        }
      }
    }
  }

  const ehGaicosStore = /gaicos-store\.com\.br/i.test(origem);
  const partes = [];

  if (ehGaicosStore) {
    partes.push(CONHECIMENTO_PADRAO_GAICOS);
  }
  const blocoCatalogo = formatarSecaoCatalogo(produtos);
  if (blocoCatalogo) partes.push(blocoCatalogo);

  const blocoFaq = formatarSecaoFaq(faqs);
  if (blocoFaq) partes.push(blocoFaq);

  if (trechosExtraidos.length > 0 && (!blocoCatalogo || !ehSpaShellTexto(trechosExtraidos))) {
    partes.push("=== CONTEÚDO EXTRAÍDO DO SITE ===\n" + trechosExtraidos.join("\n\n"));
  }

  if (partes.length === 0) {
    throw new Error("Não foi possível acessar o conteúdo público dessa URL no momento. Verifique se o site está no ar.");
  }

  const textoFinal = partes.join("\n\n").slice(0, 28000);

  return {
    ok: true,
    urlSite: urlLimpa,
    paginasLidas,
    totalProdutos: produtos.length,
    totalFaqs: faqs.length,
    produtos,
    ultimaSincronizacao: new Date().toISOString(),
    conhecimentoSite: textoFinal
  };
}

function ehSpaShellTexto(trechos) {
  return trechos.length === 1 && trechos[0].length < 220;
}
