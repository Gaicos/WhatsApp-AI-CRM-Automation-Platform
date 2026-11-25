import assert from "node:assert/strict";
import { proto } from "@itsliaaa/baileys";
import { obterDataHoraNoFuso } from "../scheduler/scheduler.js";
import { useSupabaseAuthState } from "../services/supabaseAuthStateService.js";

// 1. Testes de fuso horario no scheduler (garante horario de Brasilia mesmo em servidor UTC)
const meiaNoiteCrossing = new Date("2026-11-25T01:30:00Z"); // 22:30 do dia 24 em UTC-3
const brCrossing = obterDataHoraNoFuso(meiaNoiteCrossing, "America/Sao_Paulo");
assert.equal(brCrossing.horaAtual, "22:30");
assert.equal(brCrossing.chaveDia, "2026-11-24");
assert.equal(brCrossing.dataReferencia.getFullYear(), 2026);
assert.equal(brCrossing.dataReferencia.getMonth(), 10);
assert.equal(brCrossing.dataReferencia.getDate(), 24);

const madrugadaBr = new Date("2026-11-25T03:05:00Z"); // 00:05 do dia 25 em UTC-3
const brMadrugada = obterDataHoraNoFuso(madrugadaBr, "America/Sao_Paulo");
assert.equal(brMadrugada.horaAtual, "00:05");
assert.equal(brMadrugada.chaveDia, "2026-11-25");

// 2. Testes do auth state do WhatsApp no Supabase (serializacao de Buffers + lotes + cache)
function criarMockSupabaseAuth() {
  const tabela = new Map();
  let consultasSelect = 0;

  return {
    tabela,
    getConsultasSelect: () => consultasSelect,
    from(nome) {
      assert.equal(nome, "whatsapp_auth_state");
      return {
        select() {
          return {
            async in(_col, chaves) {
              consultasSelect++;
              const data = [];
              for (const k of chaves) {
                if (tabela.has(k)) {
                  data.push({ chave: k, valor: tabela.get(k) });
                }
              }
              return { data, error: null };
            }
          };
        },
        async upsert(itens) {
          const lista = Array.isArray(itens) ? itens : [itens];
          for (const item of lista) {
            tabela.set(item.chave, item.valor);
          }
          return { error: null };
        },
        delete() {
          return {
            async in(_col, chaves) {
              for (const k of chaves) tabela.delete(k);
              return { error: null };
            },
            async neq() {
              tabela.clear();
              return { error: null };
            }
          };
        }
      };
    }
  };
}

const mockSb = criarMockSupabaseAuth();
const auth1 = await useSupabaseAuthState(mockSb);
assert.ok(auth1.state.creds.registrationId, "deve gerar creds iniciais");
await auth1.saveCreds();
assert.ok(mockSb.tabela.has("creds.json"), "deve persistir creds.json no Supabase");

await auth1.state.keys.set({
  "pre-key": {
    "1": { public: Buffer.from("chave-pub-1") },
    "2": { public: Buffer.from("chave-pub-2") }
  },
  "app-state-sync-key": {
    "k1": { keyData: Buffer.from("segredo-sync") }
  }
});
assert.equal(mockSb.tabela.has("pre-key-1.json"), true);
assert.equal(mockSb.tabela.has("app-state-sync-key-k1.json"), true);

// Remove pre-key 2
await auth1.state.keys.set({
  "pre-key": {
    "2": null
  }
});
assert.equal(mockSb.tabela.has("pre-key-2.json"), false);

// Leitura em cache (nao deve disparar nova consulta select para chaves em memoria)
const selectsAntes = mockSb.getConsultasSelect();
const lidoCache = await auth1.state.keys.get("pre-key", ["1", "2"]);
assert.equal(mockSb.getConsultasSelect(), selectsAntes);
assert.equal(Buffer.isBuffer(lidoCache["1"].public), true);
assert.equal(lidoCache["1"].public.toString("utf-8"), "chave-pub-1");
assert.equal(lidoCache["2"], null);

// Reinicio simulado de container: nova instancia restaura creds e keys com Buffers intactos
const auth2 = await useSupabaseAuthState(mockSb);
assert.equal(auth2.state.creds.registrationId, auth1.state.creds.registrationId);
assert.equal(Buffer.isBuffer(auth2.state.creds.noiseKey.private), true);
assert.equal(
  Buffer.compare(auth2.state.creds.noiseKey.private, auth1.state.creds.noiseKey.private),
  0
);

const syncKeys = await auth2.state.keys.get("app-state-sync-key", ["k1"]);
assert.ok(syncKeys["k1"] instanceof proto.Message.AppStateSyncKeyData);
assert.equal(Buffer.from(syncKeys["k1"].keyData).toString("utf-8"), "segredo-sync");

console.log("cloud: todos os testes passaram");
