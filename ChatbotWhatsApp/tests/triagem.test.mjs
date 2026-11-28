import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-triagem-"));
process.chdir(tmp);

const configSvc = await import(pathToFileURL(path.join(raiz, "services/configService.js")).href);
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

// 2. Leitor universal de catálogo JSON e FAQ
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

const faqsExtraidas = siteKnowledge.extrairFaqDeBundleJs(
  'const Do=[{question:`Como aplico cupom?`,answer:`No carrinho antes de finalizar.`},{question:`Posso trocar?`,answer:`Sim, fale com nosso suporte.`}];'
);
assert.equal(faqsExtraidas.length, 2);

// 3. Gaicos Jr: respostas educadas, curtas e persuasivas (inclusive "promoção" mesmo sem catálogo carregado)
const configIaTeste = {
  ativa: true,
  provedor: "local",
  nomeBot: "Gaicos Jr",
  nomeResponsavel: "Gaicos",
  telefoneAlertaHumano: "5511982308315",
  minutosSemInteracaoAlerta: 0,
  minutosEsperaHumanoAviso: 60,
  horasPausaHumano: 8000,
  avisarGrupoControle: true,
  urlSite: "https://www.gaicos-store.com.br/",
  conhecimentoSite: siteKnowledge.CONHECIMENTO_PADRAO_GAICOS,
  catalogoProdutos: catalogo,
  conhecimentoExtra: "Produção média de 3 a 5 dias úteis."
};

const respPromo = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "promoção",
  configIa: { ...configIaTeste, catalogoProdutos: [] }
});
assert.equal(respPromo.chamarAtendente, false);
assert.match(respPromo.resposta, /175,00/);

const respDesconhecida = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "Vocês fazem chaveiro de acrílico impresso em 3D para evento corporativo?",
  configIa: configIaTeste
});
assert.equal(respDesconhecida.chamarAtendente, true);
assert.match(respDesconhecida.resposta, /Gaicos em pessoa/i);

const respSeca = await iaAtendimento.gerarRespostaAtendimento({
  jid: "5511988887777@s.whatsapp.net",
  mensagemCliente: "hm",
  configIa: configIaTeste
});
assert.equal(respSeca.chamarAtendente, true);
assert.match(respSeca.motivoEscalacao, /interação/i);

// 4. Privacidade rigorosa: alerta NUNCA vai para o próprio cliente, apenas para o Grupo de Controle (e erro técnico também)
configSvc.salvarConfig({ grupoControleId: "120363999999@g.us" });
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

// Simula o próprio número de alerta enviando áudio como se fosse cliente
const tratouMidiaMesmoNumero = await triagem.processarTriagem(sockMock, {
  key: { remoteJid: "5511982308315@s.whatsapp.net", fromMe: false, id: "msg_1" },
  pushName: "Cliente Teste",
  message: { audioMessage: { seconds: 4 } }
});
assert.equal(tratouMidiaMesmoNumero, true);
// O cliente recebeu APENAS 1 mensagem educada (sem o bloco interno de alerta!), e o Grupo de Controle recebeu o alerta
const msgsParaCliente = mensagensEnviadas.filter(m => m.jid === "5511982308315@s.whatsapp.net");
const msgsParaGrupo = mensagensEnviadas.filter(m => m.jid === "120363999999@g.us");
assert.equal(msgsParaCliente.length, 1);
assert.doesNotMatch(msgsParaCliente[0].content.text, /Chamado para o/i);
assert.equal(msgsParaGrupo.length, 1);
assert.match(msgsParaGrupo[0].content.text, /Chamado para o Gaicos em pessoa/i);

// Erro técnico vai SOMENTE para o Grupo de Controle
await triagem.notificarErroGrupoControle(sockMock, { contexto: "Groq", erro: "404 test", nomeCliente: "Cliente Teste" });
assert.equal(mensagensEnviadas.filter(m => m.jid === "5511982308315@s.whatsapp.net").length, 1);
assert.equal(mensagensEnviadas.filter(m => m.jid === "120363999999@g.us").length, 2);

// 5. Aviso único após espera sem resposta do atendente ("finalizando alguns playmats") e pausa longa de 8000h
const msgsEspera = [];
const sockEspera = {
  sendMessage: async (jid, content) => {
    msgsEspera.push({ jid, content });
    return { key: { id: `esp_${msgsEspera.length}` } };
  }
};
const clienteEsperaJid = "5511912345678@s.whatsapp.net";
triagem.pausarAtendimentoHumano(clienteEsperaJid, {
  telefone: "5511912345678",
  nome: "Carlos",
  motivo: "Teste espera",
  horas: 8000
});
triagem.agendarAvisoEsperaHumano(sockEspera, configIaTeste, {
  jid: clienteEsperaJid,
  telefoneCliente: "5511912345678",
  nomeCliente: "Carlos",
  ultimaMensagem: "oi",
  horasPausa: 8000,
  delayMsOverride: 30
});

await new Promise(r => setTimeout(r, 120));
const avisoCliente = msgsEspera.filter(m => m.jid === clienteEsperaJid);
assert.equal(avisoCliente.length, 1);
assert.match(avisoCliente[0].content.text, /finalizando alguns playmats/i);
assert.equal(triagem.clienteEstaPausado(clienteEsperaJid), true);

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("triagemService: todos os testes passaram");
