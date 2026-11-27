import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CAMINHO_SUPABASE_CONFIG = "./data/supabase.json";

const MAPA_ARQUIVOS_CHAVES = {
  grupos: "./data/grupos.json",
  agendamentos: "./data/agendamentos.json",
  envios: "./data/envios.json",
  historico: "./data/historico.json",
  config: "./data/config.json",
  contatos: "./data/contatos.json",
  listasContatos: "./data/listasContatos.json",
  triagem: "./data/triagem.json",
  aprendizadoBot: "./data/aprendizadoBot.json",
  pausasTriagem: "./data/pausasTriagem.json",
  auth_painel: "./data/auth.json",
  webhooksConfig: "./data/webhooks.json",
  webhooksEventos: "./data/webhooksEventos.json",
  midiasHistorico: "./data/midiasHistorico.json"
};

let clienteCache = null;
let urlCache = "";
let keyCache = "";
let statusSupabase = {
  configurado: false,
  conectado: false,
  tabelasCriadas: false,
  ultimaSincronizacao: null,
  erro: null
};

const ultimoTimestampLocalPorChave = new Map();

export function lerConfigSupabase() {
  const envUrl = (process.env.SUPABASE_URL || "").trim();
  const envKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

  if (envUrl && envKey) {
    return { ativo: true, url: envUrl, publishableKey: envKey };
  }

  try {
    if (fs.existsSync(CAMINHO_SUPABASE_CONFIG)) {
      const lido = JSON.parse(fs.readFileSync(CAMINHO_SUPABASE_CONFIG, "utf-8"));
      return {
        ativo: lido.ativo !== false,
        url: String(lido.url || "").trim(),
        publishableKey: String(lido.publishableKey || "").trim()
      };
    }
  } catch {}

  return { ativo: false, url: "", publishableKey: "" };
}

export function salvarConfigSupabase(novaConfig) {
  fs.mkdirSync("./data", { recursive: true });
  const cfg = {
    ativo: novaConfig?.ativo !== false,
    url: String(novaConfig?.url || "").trim().replace(/\/+$/, ""),
    publishableKey: String(novaConfig?.publishableKey || "").trim()
  };
  fs.writeFileSync(CAMINHO_SUPABASE_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  clienteCache = null;
  return cfg;
}

export function obterClienteSupabase() {
  const cfg = lerConfigSupabase();
  if (!cfg.ativo || !cfg.url || !cfg.publishableKey) {
    statusSupabase.configurado = false;
    statusSupabase.conectado = false;
    return null;
  }

  statusSupabase.configurado = true;
  if (clienteCache && urlCache === cfg.url && keyCache === cfg.publishableKey) {
    return clienteCache;
  }

  urlCache = cfg.url;
  keyCache = cfg.publishableKey;
  clienteCache = createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return clienteCache;
}

export function getStatusSupabase() {
  const cfg = lerConfigSupabase();
  return {
    ...statusSupabase,
    configurado: !!(cfg.ativo && cfg.url && cfg.publishableKey),
    url: cfg.url || ""
  };
}

export async function verificarConexaoSupabase() {
  const supabase = obterClienteSupabase();
  if (!supabase) {
    return getStatusSupabase();
  }

  try {
    const { error } = await supabase
      .from("bot_kv_store")
      .select("chave")
      .limit(1);

    if (error) {
      const faltaTabela =
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        /relation .* does not exist|Could not find the table/i.test(error.message || "");

      statusSupabase.conectado = !faltaTabela;
      statusSupabase.tabelasCriadas = !faltaTabela;
      statusSupabase.erro = faltaTabela
        ? "Falta executar o script supabase/schema.sql no SQL Editor do Supabase."
        : error.message;
      return getStatusSupabase();
    }

    statusSupabase.conectado = true;
    statusSupabase.tabelasCriadas = true;
    statusSupabase.erro = null;
    return getStatusSupabase();
  } catch (err) {
    statusSupabase.conectado = false;
    statusSupabase.erro = err.message;
    return getStatusSupabase();
  }
}

export async function salvarChaveNoSupabase(chave, dados) {
  const supabase = obterClienteSupabase();
  if (!supabase) return false;

  try {
    const agoraIso = new Date().toISOString();
    ultimoTimestampLocalPorChave.set(chave, agoraIso);

    const { error } = await supabase
      .from("bot_kv_store")
      .upsert(
        { chave, dados, atualizado_em: agoraIso },
        { onConflict: "chave" }
      );

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        statusSupabase.tabelasCriadas = false;
        statusSupabase.erro = "Falta executar o script supabase/schema.sql no SQL Editor do Supabase.";
      }
      return false;
    }

    statusSupabase.conectado = true;
    statusSupabase.tabelasCriadas = true;
    statusSupabase.erro = null;
    statusSupabase.ultimaSincronizacao = agoraIso;
    return true;
  } catch {
    return false;
  }
}

function dadoTemConteudo(valor) {
  if (valor === null || valor === undefined) return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.keys(valor).length > 0;
  return true;
}

export async function sincronizarTudoComSupabase() {
  const supabase = obterClienteSupabase();
  if (!supabase) return { ok: false, motivo: "Supabase não configurado." };

  fs.mkdirSync("./data", { recursive: true });

  try {
    const { data: linhasRemotas, error } = await supabase
      .from("bot_kv_store")
      .select("chave, dados, atualizado_em");

    if (error) {
      statusSupabase.tabelasCriadas = false;
      statusSupabase.conectado = false;
      statusSupabase.erro =
        error.code === "42P01" || error.code === "PGRST205"
          ? "Execute o arquivo supabase/schema.sql no SQL Editor do seu projeto Supabase para criar as tabelas."
          : error.message;
      return { ok: false, erro: statusSupabase.erro };
    }

    statusSupabase.conectado = true;
    statusSupabase.tabelasCriadas = true;
    statusSupabase.erro = null;

    const mapaRemoto = new Map();
    for (const item of linhasRemotas || []) {
      mapaRemoto.set(item.chave, item);
    }

    let enviadosParaNuvem = 0;
    let baixadosDaNuvem = 0;

    for (const [chave, caminhoArquivo] of Object.entries(MAPA_ARQUIVOS_CHAVES)) {
      let dadoLocal = null;
      if (fs.existsSync(caminhoArquivo)) {
        try {
          dadoLocal = JSON.parse(fs.readFileSync(caminhoArquivo, "utf-8"));
        } catch {}
      }

      const remoto = mapaRemoto.get(chave);

      if (!remoto && dadoTemConteudo(dadoLocal)) {
        // Sobe os dados locais atuais do PC para o Supabase automaticamente
        await salvarChaveNoSupabase(chave, dadoLocal);
        enviadosParaNuvem++;
      } else if (remoto && dadoTemConteudo(remoto.dados)) {
        // Se na nuvem já existe e local está vazio (ou a nuvem foi atualizada pelo GitHub Pages), atualiza local
        const tsLocal = ultimoTimestampLocalPorChave.get(chave);
        if (!dadoTemConteudo(dadoLocal) || (!tsLocal && remoto.atualizado_em) || (tsLocal && remoto.atualizado_em > tsLocal)) {
          fs.writeFileSync(caminhoArquivo, JSON.stringify(remoto.dados, null, 2), "utf-8");
          ultimoTimestampLocalPorChave.set(chave, remoto.atualizado_em);
          baixadosDaNuvem++;
        }
      }
    }

    statusSupabase.ultimaSincronizacao = new Date().toISOString();
    return { ok: true, enviadosParaNuvem, baixadosDaNuvem };
  } catch (err) {
    statusSupabase.erro = err.message;
    return { ok: false, erro: err.message };
  }
}

// Sincroniza alterações feitas pelo Painel Online (GitHub Pages) para o motor do bot
export async function puxarAtualizacoesRemotasDoSupabase() {
  const supabase = obterClienteSupabase();
  if (!supabase || !statusSupabase.tabelasCriadas) return;

  try {
    const { data: linhasRemotas, error } = await supabase
      .from("bot_kv_store")
      .select("chave, dados, atualizado_em");

    if (error || !Array.isArray(linhasRemotas)) return;

    for (const item of linhasRemotas) {
      const caminhoArquivo = MAPA_ARQUIVOS_CHAVES[item.chave];
      if (!caminhoArquivo) continue;

      const tsConhecido = ultimoTimestampLocalPorChave.get(item.chave);
      if (!tsConhecido || (item.atualizado_em && item.atualizado_em > tsConhecido)) {
        fs.mkdirSync("./data", { recursive: true });
        fs.writeFileSync(caminhoArquivo, JSON.stringify(item.dados, null, 2), "utf-8");
        ultimoTimestampLocalPorChave.set(item.chave, item.atualizado_em);
      }
    }
    statusSupabase.ultimaSincronizacao = new Date().toISOString();
  } catch {}
}

// Faz upload de imagem/vídeo para o Supabase Storage (bucket 'midia')
export async function enviarMidiaParaSupabaseStorage(caminhoLocal, mimeType = "application/octet-stream") {
  const supabase = obterClienteSupabase();
  if (!supabase) return null;

  try {
    const buffer = fs.readFileSync(caminhoLocal);
    const nomeArquivo = path.basename(caminhoLocal);

    const { error } = await supabase.storage
      .from("midia")
      .upload(nomeArquivo, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (error) return null;

    const { data } = supabase.storage.from("midia").getPublicUrl(nomeArquivo);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

// Publica o status em tempo real do WhatsApp + QR Code + Grupos para o Painel Online (GitHub Pages)
export async function publicarStatusVivoNoSupabase(dadosStatus) {
  await salvarChaveNoSupabase("status_vivo", {
    ...dadosStatus,
    atualizadoEm: new Date().toISOString()
  });
}

// Escuta e executa comandos enviados pelo Painel Online (GitHub Pages) via tabela bot_comandos_fila
export function iniciarMonitoramentoComandosSupabase(executorComandos) {
  let processando = false;

  async function verificarFila() {
    if (processando) return;
    const supabase = obterClienteSupabase();
    if (!supabase || !statusSupabase.tabelasCriadas) return;

    processando = true;
    try {
      const { data: pendentes, error } = await supabase
        .from("bot_comandos_fila")
        .select("*")
        .eq("status", "pendente")
        .order("criado_em", { ascending: true })
        .limit(5);

      if (error || !Array.isArray(pendentes) || pendentes.length === 0) return;

      for (const cmd of pendentes) {
        await supabase
          .from("bot_comandos_fila")
          .update({ status: "processando" })
          .eq("id", cmd.id);

        try {
          const resultado = await executorComandos(cmd.acao, cmd.payload || {});
          await supabase
            .from("bot_comandos_fila")
            .update({
              status: "concluido",
              resultado: resultado || { ok: true },
              processado_em: new Date().toISOString()
            })
            .eq("id", cmd.id);
        } catch (errCmd) {
          await supabase
            .from("bot_comandos_fila")
            .update({
              status: "erro",
              resultado: { ok: false, erro: errCmd.message || "Erro ao executar comando" },
              processado_em: new Date().toISOString()
            })
            .eq("id", cmd.id);
        }
      }
    } catch {
      // ignora falhas temporárias de rede
    } finally {
      processando = false;
    }
  }

  setInterval(() => {
    verificarFila();
    puxarAtualizacoesRemotasDoSupabase();
  }, 4000);
}
