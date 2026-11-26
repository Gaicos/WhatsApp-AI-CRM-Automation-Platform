import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-webhook-"));
process.chdir(tmp);

const { salvarConfig } = await import(pathToFileURL(path.join(raiz, "services/configService.js")).href);
const webhook = await import(pathToFileURL(path.join(raiz, "services/webhookService.js")).href);

// 1. Geracao e validacao de token em tempo constante + extracao de header/query
const cfgInicial = webhook.lerConfigWebhook();
assert.equal(cfgInicial.ativo, true);
assert.ok(cfgInicial.segredo.startsWith("whsec_"));
assert.equal(webhook.validarSegredoWebhook(cfgInicial.segredo), true);
assert.equal(webhook.validarSegredoWebhook("token-errado"), false);
assert.equal(webhook.validarSegredoWebhook(""), false);

assert.equal(
  webhook.extrairTokenRequisicao({ headers: { "x-webhook-secret": "abc123" } }),
  "abc123"
);
assert.equal(
  webhook.extrairTokenRequisicao({ headers: { authorization: "Bearer meu_token" } }),
  "meu_token"
);
assert.equal(
  webhook.extrairTokenRequisicao({ headers: {}, query: { secret: "q_token" } }),
  "q_token"
);

const cfgRegenerada = webhook.regenerarSegredoWebhook();
assert.notEqual(cfgRegenerada.segredo, cfgInicial.segredo);
assert.equal(webhook.validarSegredoWebhook(cfgInicial.segredo), false);
assert.equal(webhook.validarSegredoWebhook(cfgRegenerada.segredo), true);

// 2. Normalizacao de telefone WhatsApp
assert.equal(webhook.normalizarTelefoneWhatsapp("(11) 99999-8888"), "5511999998888");
assert.equal(webhook.normalizarTelefoneWhatsapp("011999998888"), "5511999998888");
assert.equal(webhook.normalizarTelefoneWhatsapp("+55 21 98765-4321"), "5521987654321");
assert.equal(webhook.normalizarTelefoneWhatsapp("12345"), null);

// 3. Aliases de evento, formatacao de moeda/produtos e extracao de payload aninhado
assert.equal(webhook.normalizarEvento("order.paid"), "pedido_pago");
assert.equal(webhook.normalizarEvento("Shipping-Updated"), "pedido_enviado");
assert.equal(webhook.normalizarEvento("orçamento"), "novo_contato");

const extraido = webhook.extrairDadosPayload({
  event: "order_paid",
  customer: { name: "Maria", phone: "(11) 98888-7777" },
  order: {
    id: "9001",
    total: 149.9,
    items: ["Playmat Custom", { nome: "Sleeves", quantidade: 2 }],
    url: "https://www.gaicos-store.com.br/pedido/9001"
  }
});
assert.equal(extraido.evento, "pedido_pago");
assert.equal(extraido.nome, "Maria");
assert.equal(extraido.telefone, "5511988887777");
assert.equal(extraido.pedido, "9001");
assert.equal(extraido.valorTexto, "R$ 149,90");
assert.equal(extraido.produtos, "Playmat Custom, 2x Sleeves");

// 4. Renderizacao de template com variaveis vazias limpas
const render = webhook.renderizarTemplate(
  "Olá {{nome}}! Pedido #{{pedido}}{{valor}}.\n{{rastreio}}\n{{link}}",
  { nome: "Carlos", pedido: "55", valor: " (R$ 50,00)", rastreio: "", link: "https://site.com" }
);
assert.equal(render, "Olá Carlos! Pedido #55 (R$ 50,00).\nhttps://site.com");

// 5. Fluxo completo de processarWebhookSite (cliente + grupo de controle + historico)
salvarConfig({ grupoControleId: "120363999999@g.us" });

const enviosSimulados = [];
const mockEnviar = async (destino, payload, ctx) => {
  enviosSimulados.push({ destino, payload, ctx });
  return { ok: true };
};

const resPago = await webhook.processarWebhookSite(
  {
    evento: "order_paid",
    telefone: "11999991111",
    nome: "Ana",
    pedido: "777",
    valor: 199.5,
    link: "https://www.gaicos-store.com.br/pedido/777"
  },
  mockEnviar
);
assert.equal(resPago.ok, true);
assert.equal(resPago.enviadoCliente, true);
assert.equal(resPago.avisadoGrupo, true);
assert.equal(enviosSimulados.length, 2);
assert.equal(enviosSimulados[0].destino, "5511999991111");
assert.ok(enviosSimulados[0].payload.texto.includes("#777"));
assert.equal(enviosSimulados[1].destino, "120363999999@g.us");
assert.ok(enviosSimulados[1].payload.texto.includes("Ana"));

// Evento mensagem livre com midiaUrl
enviosSimulados.length = 0;
const resLivre = await webhook.processarWebhookSite(
  {
    evento: "mensagem",
    telefone: "5511988880000",
    mensagem: "Segue a arte do seu playmat!",
    midiaUrl: "https://exemplo.com/arte.png",
    tipoMidia: "imagem"
  },
  mockEnviar
);
assert.equal(resLivre.ok, true);
assert.equal(enviosSimulados.length, 1);
assert.equal(enviosSimulados[0].payload.midiaUrl, "https://exemplo.com/arte.png");
assert.equal(enviosSimulados[0].payload.texto, "Segue a arte do seu playmat!");

// Evento desativado deve ser ignorado sem enviar
const cfgEdit = webhook.lerConfigWebhook();
cfgEdit.eventos.carrinho_abandonado.ativo = false;
webhook.salvarConfigWebhook(cfgEdit);
enviosSimulados.length = 0;
const resIgnorado = await webhook.processarWebhookSite(
  { evento: "carrinho_abandonado", telefone: "11999991111", nome: "Pedro" },
  mockEnviar
);
assert.equal(resIgnorado.ok, true);
assert.equal(resIgnorado.ignorado, true);
assert.equal(enviosSimulados.length, 0);

// Erro 400 se telefone invalido e sem grupo de controle
salvarConfig({ grupoControleId: null });
const resErro = await webhook.processarWebhookSite(
  { evento: "pedido_pago", telefone: "123", nome: "Sem Tel" },
  mockEnviar
);
assert.equal(resErro.ok, false);
assert.equal(resErro.statusHttp, 400);

// Historico de eventos e limpeza
const eventos = webhook.lerEventosWebhook();
assert.ok(eventos.length >= 4);
webhook.limparEventosWebhook();
assert.equal(webhook.lerEventosWebhook().length, 0);

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("webhookService: todos os testes passaram");
