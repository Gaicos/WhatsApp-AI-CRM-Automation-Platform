import assert from "node:assert/strict";
import { resolverJidDestino } from "../whatsapp/whatsappService.js";

// 1. Grupo com @g.us mantém o JID original sem consultar onWhatsApp
const jidGrupo = await resolverJidDestino(null, { id: "120363123456@g.us", nome: "Grupo VIP" });
assert.equal(jidGrupo, "120363123456@g.us");

// 2. Contato legado com id numérico (timestamp) e telefone BR 11 dígitos sem 55
const jidContatoLegado = await resolverJidDestino(null, {
  id: "1795770000000",
  telefone: "11999998888",
  nome: "Danilo Marques"
});
assert.equal(jidContatoLegado, "5511999998888@s.whatsapp.net");

// 3. Usa JID oficial retornado por sock.onWhatsApp quando disponível (ex: 9º dígito BR)
const mockSock = {
  async onWhatsApp(numero) {
    assert.equal(numero, "5511988887777");
    return [{ exists: true, jid: "551188887777@s.whatsapp.net" }];
  }
};
const jidVerificado = await resolverJidDestino(mockSock, "(11) 98888-7777");
assert.equal(jidVerificado, "551188887777@s.whatsapp.net");

// 4. Número inválido lança erro explícito
await assert.rejects(
  () => resolverJidDestino(null, { id: "1795770000000", telefone: "123", nome: "Inválido" }),
  /inválido/i
);

console.log("destinos/JID: todos os testes passaram");
