import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-triagem-"));
process.chdir(tmp);

const triagem = await import(pathToFileURL(path.join(raiz, "services/triagemService.js")).href);
const siteKnowledge = await import(pathToFileURL(path.join(raiz, "services/siteKnowledgeService.js")).href);
const iaAtendimento = await import(pathToFileURL(path.join(raiz, "services/iaAtendimentoService.js")).href);

// 1. Validação do fluxo de menu clássico
const valido = {
  ativo: true,
  boasVindas: "Olá!",
  nodeInicial: "inicio",
  nodes: [{
    id: "inicio",
    titulo: "Escolha",
    texto: "O que você precisa?",
    opcoes: [
      { texto: "Vendas", proxima: "vendas", resposta: "Vou te ajudar com vendas." },
      { texto: "Suporte", proxima: null, resposta: "" }
    ]
  }, {
    id: "vendas",
    titulo: "Vendas",
    texto: "Qual produto?",
    opcoes: [{ texto: "Plano mensal", proxima: null }]
  }]
};

assert.equal(triagem.validarTriagem(valido).ok, true);
triagem.salvarTriagem(valido);
assert.equal(triagem.lerTriagem().nodeInicial, "inicio");

const dezOpcoes = {
  ...valido,
  nodes: [{ ...valido.nodes[0], opcoes: Array.from({ length: 10 }, (_, i) => ({ texto: `Opção ${i + 1}`, proxima: null })) }]
};
assert.equal(triagem.validarTriagem(dezOpcoes).ok, false, "limite máximo de 9 opções");

const destinoInexistente = JSON.parse(JSON.stringify(valido));
destinoInexistente.nodes[0].opcoes[0].proxima = "nao-existe";
assert.equal(triagem.validarTriagem(destinoInexistente).ok, false, "não aceita destino inexistente");

// 2. Leitor universal de catálogo JSON (SPA/REST, Shopify) e FAQ de bundle JS
const catalogo = siteKnowledge.extrairCatalogoDeJson([
  {
    name: "Playmat Eldrazi Magic MTG",
    categoryName: "Magic: The Gathering",
    slug: "eldrazi-mh3",
    description: "<p>Domine sua mesa com tecido liso que protege seus sleeves.</p>",
    priceCents: "19900",
    promoPriceCents: "17500",
    isPromo: true,
    active: true,
    customizable: false
  },
  {
    name: "Playmat Personalizado - M",
    categoryName: "Personalizado",
    slug: "playmat-personalizado-m",
    description: "Feito com a sua arte exclusiva.",
    priceCents: "17800",
    isPromo: false,
    active: true,
    customizable: true
  },
  { name: "Produto Inativo", active: false, priceCents: "9900" }
], "https://www.gaicos-store.com.br");

assert.equal(catalogo.length, 2);
assert.equal(catalogo[0].preco, "R$ 199,00");
assert.equal(catalogo[0].precoPromo, "R$ 175,00");
assert.equal(catalogo[0].emPromocao, true);
assert.equal(catalogo[0].link, "https://www.gaicos-store.com.br/produto/eldrazi-mh3");
assert.equal(catalogo[1].link, "https://www.gaicos-store.com.br/pedido-personalizado");

const faqsExtraidas = siteKnowledge.extrairFaqDeBundleJs(
  'const Do=[{question:`Como aplico cupom?`,answer:`No carrinho antes de finalizar.`},{question:`Posso trocar?`,answer:`Sim, fale com nosso suporte.`}];'
);
assert.equal(faqsExtraidas.length, 2);
assert.equal(faqsExtraidas[0].pergunta, "Como aplico cupom?");

// 3. Gaicos Jr: respostas curtas e persuasivas usando o catálogo do site + escalação inteligente
const configIaTeste = {
  ativa: true,
  provedor: "local",
  nomeBot: "Gaicos Jr",
  nomeResponsavel: "Gaicos",
  telefoneAlertaHumano: "11999998888",
  minutosSemInteracaoAlerta: 0,
  avisarGrupoControle: false,
  urlSite: "https://www.gaicos-store.com.br/",
  conhecimentoSite: siteKnowledge.CONHECIMENTO_PADRAO_GAICOS,
  catalogoProdutos: catalogo,
  conhecimentoExtra: "Produção média de 3 a 5 dias úteis."
};

const respPromo = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "Tem alguma promoção de playmat Eldrazi?",
  configIa: configIaTeste
});
assert.equal(respPromo.chamarAtendente, false);
assert.match(respPromo.resposta, /Eldrazi/i);
assert.match(respPromo.resposta, /175,00/);
assert.ok(respPromo.resposta.length < 450, "resposta deve ser curta, sem textão");

// 3b. Escalação por dúvida fora da base (evitar resposta errada)
const respDesconhecida = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "Vocês fazem chaveiro de acrílico impresso em 3D para evento corporativo?",
  configIa: configIaTeste
});
assert.equal(respDesconhecida.chamarAtendente, true);
assert.match(respDesconhecida.resposta, /Gaicos em pessoa/i);

// 3c. Escalação por falta de interação (respostas secas após histórico prévio)
const respSeca = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "hm",
  configIa: configIaTeste
});
assert.equal(respSeca.chamarAtendente, true);
assert.match(respSeca.motivoEscalacao, /interação/i);

// 4. Fluxo completo via processarTriagem: envia alerta direto para telefoneAlertaHumano em mídia/escalação
triagem.salvarTriagem({
  ativo: true,
  boasVindas: "",
  nodeInicial: null,
  nodes: [],
  ia: configIaTeste
});

const mensagensEnviadas = [];
const sockMock = {
  onWhatsApp: async (digits) => [{ jid: `${digits}@s.whatsapp.net` }],
  sendMessage: async (jid, content) => {
    mensagensEnviadas.push({ jid, content });
    return { key: { id: `bot_${mensagensEnviadas.length}` } };
  }
};

const tratouMidia = await triagem.processarTriagem(sockMock, {
  key: { remoteJid: "5511977771111@s.whatsapp.net", fromMe: false, id: "msg_1" },
  pushName: "Lucas TCG",
  message: { audioMessage: { seconds: 5 } }
});

assert.equal(tratouMidia, true);
assert.equal(mensagensEnviadas.length, 2);
assert.equal(mensagensEnviadas[0].jid, "5511977771111@s.whatsapp.net");
assert.match(mensagensEnviadas[0].content.text, /Gaicos em pessoa/i);
assert.equal(mensagensEnviadas[1].jid, "5511999998888@s.whatsapp.net");
assert.match(mensagensEnviadas[1].content.text, /Lucas TCG/);

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("triagemService: todos os testes passaram");
