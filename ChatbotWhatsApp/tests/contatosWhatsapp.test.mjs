import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-contatos-wpp-"));
process.chdir(tmp);

const tenantCtx = await import(pathToFileURL(path.join(raiz, "services/tenantContext.js")).href);
const configSvc = await import(pathToFileURL(path.join(raiz, "services/configService.js")).href);
const whatsappSvc = await import(pathToFileURL(path.join(raiz, "whatsapp/whatsappService.js")).href);

// 1. Normalização de contato salvo no WhatsApp
const c1 = whatsappSvc.normalizarContatoWhatsapp({
  id: "11999998888:12@s.whatsapp.net",
  name: "Maria Silva",
  notify: "Maria :)"
});
assert.deepEqual(c1, {
  id: "5511999998888@s.whatsapp.net",
  nome: "Maria Silva",
  telefone: "5511999998888",
  temNomeSalvo: true
});

// 2. Resolução via LID quando há mapeamento lid -> pn
const mapaLid = new Map([["987654321", "5521988887777@s.whatsapp.net"]]);
const cLid = whatsappSvc.normalizarContatoWhatsapp(
  { id: "987654321:0@lid", name: "João Pedro" },
  { lidParaPn: mapaLid }
);
assert.deepEqual(cLid, {
  id: "5521988887777@s.whatsapp.net",
  nome: "João Pedro",
  telefone: "5521988887777",
  temNomeSalvo: true
});

// 3. Rejeita grupos, newsletter, broadcast, LID sem PN e o próprio número
assert.equal(whatsappSvc.normalizarContatoWhatsapp({ id: "12036300000@g.us", name: "Grupo" }), null);
assert.equal(whatsappSvc.normalizarContatoWhatsapp({ id: "12345@newsletter", name: "Canal" }), null);
assert.equal(whatsappSvc.normalizarContatoWhatsapp({ id: "status@broadcast", name: "Status" }), null);
assert.equal(whatsappSvc.normalizarContatoWhatsapp({ id: "111222333@lid", name: "Sem PN" }), null);
assert.equal(
  whatsappSvc.normalizarContatoWhatsapp(
    { id: "5511977776666@s.whatsapp.net", name: "Eu" },
    { meuTelefone: "5511977776666" }
  ),
  null
);

// 4. Fallback de nome (verifiedName -> notify -> telefone)
const cNotify = whatsappSvc.normalizarContatoWhatsapp({
  id: "5531988881111@s.whatsapp.net",
  notify: "Carlos Loja"
});
assert.equal(cNotify.nome, "Carlos Loja");
assert.equal(cNotify.temNomeSalvo, false);

// 5. Persistência isolada por tenant e ordenação alfabética em buscarContatosWhatsapp
tenantCtx.executarNoTenant("admin", () => {
  configSvc.salvarContatosWhatsapp([
    { id: "5511911112222@s.whatsapp.net", nome: "Zuleica", telefone: "5511911112222" },
    { id: "5511933334444@s.whatsapp.net", nome: "Ana Paula", telefone: "5511933334444" }
  ]);
});

tenantCtx.executarNoTenant("cli_teste_1", () => {
  configSvc.salvarContatosWhatsapp([
    { id: "5541955556666@s.whatsapp.net", nome: "Bruno Cliente", telefone: "5541955556666" }
  ]);
});

const listaAdmin = await whatsappSvc.buscarContatosWhatsapp("admin");
assert.deepEqual(
  listaAdmin.map((c) => c.nome),
  ["Ana Paula", "Zuleica"]
);

const listaCliente = await whatsappSvc.buscarContatosWhatsapp("cli_teste_1");
assert.deepEqual(listaCliente, [
  { id: "5541955556666@s.whatsapp.net", nome: "Bruno Cliente", telefone: "5541955556666" }
]);

console.log("contatosWhatsapp: todos os testes passaram");
