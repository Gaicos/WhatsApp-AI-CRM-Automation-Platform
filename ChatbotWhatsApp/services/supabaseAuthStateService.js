import fs from "node:fs";
import path from "node:path";
import { BufferJSON, initAuthCreds, proto } from "@itsliaaa/baileys";
import { obterClienteSupabase } from "./supabaseService.js";

const TAMANHO_LOTE = 100;
const cachesPorPrefixo = new Map();

function normalizarNomeChave(chave) {
  return String(chave || "").replace(/\//g, "__").replace(/:/g, "-");
}

function prefixarChave(chave, prefixo = "") {
  const limpa = normalizarNomeChave(chave);
  return prefixo ? `${prefixo}${limpa}` : limpa;
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
 * tabela public.whatsapp_auth_state do Supabase, com cache isolado por tenant (prefixo).
 */
export async function useSupabaseAuthState(supabaseOverride = null, prefixo = "") {
  const supabase = supabaseOverride || obterClienteSupabase();
  if (!supabase) {
    throw new Error("Supabase não está configurado para usar auth na nuvem.");
  }

  const cache = new Map();
  cachesPorPrefixo.set(prefixo, () => cache.clear());

  async function lerChavesEmLote(chavesComPrefixo) {
    const chaves = [...new Set(chavesComPrefixo.filter(Boolean))];
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
        encontrados.add(item.chave);
        cache.set(item.chave, desserializarValor(item.valor));
      }
      for (const k of lote) {
        if (!encontrados.has(k)) {
          cache.set(k, null);
        }
      }
    }
  }

  const chaveCreds = prefixarChave("creds.json", prefixo);

  async function escreverCredenciais(dadosCreds) {
    const agoraIso = new Date().toISOString();
    cache.set(chaveCreds, dadosCreds);

    const { error } = await supabase
      .from("whatsapp_auth_state")
      .upsert(
        {
          chave: chaveCreds,
          valor: { raw: JSON.stringify(dadosCreds, BufferJSON.replacer) },
          atualizado_em: agoraIso
        },
        { onConflict: "chave" }
      );

    if (error) {
      throw new Error(`Falha ao salvar creds.json no Supabase: ${error.message}`);
    }
  }

  await lerChavesEmLote([chaveCreds]);
  const credsExistentes = cache.get(chaveCreds);
  const creds = credsExistentes || initAuthCreds();
  if (!credsExistentes) {
    cache.set(chaveCreds, creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          const listaIds = Array.isArray(ids) ? ids : [];
          const chaves = listaIds.map((id) => prefixarChave(`${type}-${id}.json`, prefixo));
          await lerChavesEmLote(chaves);

          for (const id of listaIds) {
            const chave = prefixarChave(`${type}-${id}.json`, prefixo);
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
              const chave = prefixarChave(`${category}-${id}.json`, prefixo);
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

export async function tenantTemCredsNoSupabase(prefixo = "") {
  const supabase = obterClienteSupabase();
  if (!supabase) return false;
  try {
    const chaveCreds = prefixarChave("creds.json", prefixo);
    const { data, error } = await supabase
      .from("whatsapp_auth_state")
      .select("chave")
      .eq("chave", chaveCreds)
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

// Sincroniza a sessão do WhatsApp (auth_info) entre o disco local e a tabela
// public.whatsapp_auth_state no Supabase, permitindo rodar 24h na nuvem sem perder o QR Code.
export async function restaurarAuthWhatsappDoSupabase(pastaLocal = "auth_info", prefixo = "") {
  const supabase = obterClienteSupabase();
  if (!supabase) return false;

  const caminhoCreds = path.join(pastaLocal, "creds.json");
  if (fs.existsSync(caminhoCreds)) {
    return false; // já existe sessão local ativa no disco
  }

  try {
    let query = supabase.from("whatsapp_auth_state").select("chave, valor");
    if (prefixo) {
      query = query.like("chave", `${prefixo}%`);
    } else {
      query = query.not("chave", "like", "tenant:%");
    }
    const { data, error } = await query;

    if (error || !Array.isArray(data) || data.length === 0) {
      return false;
    }

    fs.mkdirSync(pastaLocal, { recursive: true });
    for (const item of data) {
      if (!item.chave || !item.valor) continue;
      const semPrefixo = prefixo && item.chave.startsWith(prefixo)
        ? item.chave.slice(prefixo.length)
        : item.chave;
      const nomeSeguro = path.basename(semPrefixo);
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

export async function salvarCredsWhatsappNoSupabase(pastaLocal = "auth_info", prefixo = "") {
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
          chave: prefixarChave("creds.json", prefixo),
          valor: { raw },
          atualizado_em: new Date().toISOString()
        },
        { onConflict: "chave" }
      );
  } catch {}
}

export async function limparAuthWhatsappNoSupabase(prefixo = "") {
  const limparCache = cachesPorPrefixo.get(prefixo);
  if (typeof limparCache === "function") {
    limparCache();
  }
  const supabase = obterClienteSupabase();
  if (!supabase) return;
  try {
    if (prefixo) {
      await supabase.from("whatsapp_auth_state").delete().like("chave", `${prefixo}%`);
    } else {
      await supabase.from("whatsapp_auth_state").delete().not("chave", "like", "tenant:%");
    }
  } catch {}
}
