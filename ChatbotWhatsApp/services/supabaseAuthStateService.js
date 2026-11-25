import fs from "node:fs";
import path from "node:path";
import { BufferJSON, initAuthCreds, proto } from "@itsliaaa/baileys";
import { obterClienteSupabase } from "./supabaseService.js";

const TAMANHO_LOTE = 100;
let limparCacheAtivo = null;

function normalizarNomeChave(chave) {
  return String(chave || "").replace(/\//g, "__").replace(/:/g, "-");
}

function desserializarValor(valor) {
  if (!valor) return null;
  if (typeof valor.raw === "string") {
    return JSON.parse(valor.raw, BufferJSON.reviver);
  }
  return JSON.parse(JSON.stringify(valor), BufferJSON.reviver);
}

/**
 * Implementa o contrato completo de autenticacao do Baileys diretamente na
 * tabela public.whatsapp_auth_state do Supabase, com cache em memoria e lotes.
 */
export async function useSupabaseAuthState(supabaseOverride = null) {
  const supabase = supabaseOverride || obterClienteSupabase();
  if (!supabase) {
    throw new Error("Supabase não está configurado para usar auth na nuvem.");
  }

  const cache = new Map();
  limparCacheAtivo = () => cache.clear();

  async function lerChavesEmLote(chavesBrutas) {
    const chaves = [...new Set(chavesBrutas.map(normalizarNomeChave).filter(Boolean))];
    const faltantes = chaves.filter((k) => !cache.has(k));

    for (let i = 0; i < faltantes.length; i += TAMANHO_LOTE) {
      const lote = faltantes.slice(i, i + TAMANHO_LOTE);
      const { data, error } = await supabase
        .from("whatsapp_auth_state")
        .select("chave, valor")
        .in("chave", lote);

      if (error) {
        throw new Error(`Falha ao ler chaves do WhatsApp no Supabase: ${error.message}`);
      }

      const encontrados = new Set();
      for (const item of data || []) {
        const chaveLimpa = normalizarNomeChave(item.chave);
        encontrados.add(chaveLimpa);
        cache.set(chaveLimpa, desserializarValor(item.valor));
      }
      for (const k of lote) {
        if (!encontrados.has(k)) {
          cache.set(k, null);
        }
      }
    }
  }

  async function escreverCredenciais(dadosCreds) {
    const chave = "creds.json";
    const agoraIso = new Date().toISOString();
    cache.set(chave, dadosCreds);

    const { error } = await supabase
      .from("whatsapp_auth_state")
      .upsert(
        {
          chave,
          valor: { raw: JSON.stringify(dadosCreds, BufferJSON.replacer) },
          atualizado_em: agoraIso
        },
        { onConflict: "chave" }
      );

    if (error) {
      throw new Error(`Falha ao salvar creds.json no Supabase: ${error.message}`);
    }
  }

  await lerChavesEmLote(["creds.json"]);
  const credsExistentes = cache.get("creds.json");
  const creds = credsExistentes || initAuthCreds();
  if (!credsExistentes) {
    cache.set("creds.json", creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          const listaIds = Array.isArray(ids) ? ids : [];
          const chaves = listaIds.map((id) => normalizarNomeChave(`${type}-${id}.json`));
          await lerChavesEmLote(chaves);

          for (const id of listaIds) {
            const chave = normalizarNomeChave(`${type}-${id}.json`);
            let value = cache.get(chave) ?? null;
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const agoraIso = new Date().toISOString();
          const paraUpsert = [];
          const paraDeletar = [];

          for (const category in data || {}) {
            for (const id in data[category]) {
              const value = data[category][id];
              const chave = normalizarNomeChave(`${category}-${id}.json`);
              if (value) {
                cache.set(chave, value);
                paraUpsert.push({
                  chave,
                  valor: { raw: JSON.stringify(value, BufferJSON.replacer) },
                  atualizado_em: agoraIso
                });
              } else {
                cache.set(chave, null);
                paraDeletar.push(chave);
              }
            }
          }

          for (let i = 0; i < paraUpsert.length; i += TAMANHO_LOTE) {
            const lote = paraUpsert.slice(i, i + TAMANHO_LOTE);
            const { error } = await supabase
              .from("whatsapp_auth_state")
              .upsert(lote, { onConflict: "chave" });
            if (error) {
              throw new Error(`Falha ao salvar chaves no Supabase: ${error.message}`);
            }
          }

          for (let i = 0; i < paraDeletar.length; i += TAMANHO_LOTE) {
            const lote = paraDeletar.slice(i, i + TAMANHO_LOTE);
            const { error } = await supabase
              .from("whatsapp_auth_state")
              .delete()
              .in("chave", lote);
            if (error) {
              throw new Error(`Falha ao remover chaves no Supabase: ${error.message}`);
            }
          }
        }
      }
    },
    saveCreds: async () => escreverCredenciais(creds),
    clearCache: () => cache.clear()
  };
}

// Sincroniza a sessão do WhatsApp (auth_info) entre o disco local e a tabela
// public.whatsapp_auth_state no Supabase, permitindo rodar 24h na nuvem sem perder o QR Code.
export async function restaurarAuthWhatsappDoSupabase(pastaLocal = "auth_info") {
  const supabase = obterClienteSupabase();
  if (!supabase) return false;

  const caminhoCreds = path.join(pastaLocal, "creds.json");
  if (fs.existsSync(caminhoCreds)) {
    return false; // já existe sessão local ativa no disco
  }

  try {
    const { data, error } = await supabase
      .from("whatsapp_auth_state")
      .select("chave, valor");

    if (error || !Array.isArray(data) || data.length === 0) {
      return false;
    }

    fs.mkdirSync(pastaLocal, { recursive: true });
    for (const item of data) {
      if (!item.chave || !item.valor) continue;
      const nomeSeguro = path.basename(item.chave);
      const conteudo = typeof item.valor.raw === "string"
        ? item.valor.raw
        : JSON.stringify(JSON.parse(JSON.stringify(item.valor), BufferJSON.reviver));
      fs.writeFileSync(path.join(pastaLocal, nomeSeguro), conteudo, "utf-8");
    }
    console.log(`☁️ Sessão do WhatsApp restaurada da nuvem (Supabase: ${data.length} arquivo(s)).`);
    return true;
  } catch {
    return false;
  }
}

export async function salvarCredsWhatsappNoSupabase(pastaLocal = "auth_info") {
  const supabase = obterClienteSupabase();
  if (!supabase) return;

  try {
    const caminhoCreds = path.join(pastaLocal, "creds.json");
    if (!fs.existsSync(caminhoCreds)) return;
    const raw = fs.readFileSync(caminhoCreds, "utf-8");

    await supabase
      .from("whatsapp_auth_state")
      .upsert(
        {
          chave: "creds.json",
          valor: { raw },
          atualizado_em: new Date().toISOString()
        },
        { onConflict: "chave" }
      );
  } catch {}
}

export async function limparAuthWhatsappNoSupabase() {
  if (typeof limparCacheAtivo === "function") {
    limparCacheAtivo();
  }
  const supabase = obterClienteSupabase();
  if (!supabase) return;
  try {
    await supabase.from("whatsapp_auth_state").delete().neq("chave", "");
  } catch {}
}
