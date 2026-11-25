import fs from "node:fs";
import path from "node:path";
import {
  lerConfigSupabase,
  enviarMidiaParaSupabaseStorage,
  sincronizarTudoComSupabase,
  salvarChaveNoSupabase
} from "../services/supabaseService.js";

const MIME_POR_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};

function obterMimeType(caminhoArquivo) {
  const ext = path.extname(caminhoArquivo).toLowerCase();
  return MIME_POR_EXT[ext] || "application/octet-stream";
}

function resolverCaminhoLocalMidia(caminho) {
  const limpo = String(caminho || "").trim();
  if (!limpo || /^https?:\/\//i.test(limpo)) return null;
  if (fs.existsSync(limpo)) return limpo;
  const semPonto = limpo.replace(/^\.\//, "");
  if (fs.existsSync(semPonto)) return semPonto;
  return null;
}

async function main() {
  const cfg = lerConfigSupabase();
  if (!cfg.ativo || !cfg.url || !cfg.publishableKey) {
    console.error("Supabase não configurado. Defina ./data/supabase.json ou SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY.");
    process.exit(1);
  }

  const sync = await sincronizarTudoComSupabase();
  if (!sync.ok) {
    console.error("Falha na sincronização com Supabase:", sync.erro || sync.motivo);
    process.exit(1);
  }

  let arquivosEnviados = 0;
  let midiasReaproveitadas = 0;
  let midiasComFalha = 0;
  let agendamentosAtualizados = false;

  const caminhoAgendamentos = "./data/agendamentos.json";
  let agendamentos = [];
  if (fs.existsSync(caminhoAgendamentos)) {
    agendamentos = JSON.parse(fs.readFileSync(caminhoAgendamentos, "utf-8"));
  }

  for (const agendamento of agendamentos) {
    if (!Array.isArray(agendamento.midias)) continue;
    for (const midia of agendamento.midias) {
      if (midia.urlPublica && /^https?:\/\//i.test(midia.urlPublica)) {
        if (midia.caminho !== midia.urlPublica) {
          midia.caminhoLocal = midia.caminhoLocal || midia.caminho;
          midia.caminho = midia.urlPublica;
          agendamentosAtualizados = true;
        }
        midiasReaproveitadas++;
        continue;
      }

      const localPath = resolverCaminhoLocalMidia(midia.caminhoLocal || midia.caminho);
      if (!localPath) continue;

      const mimeType = obterMimeType(localPath);
      const urlPublica = await enviarMidiaParaSupabaseStorage(localPath, mimeType);
      if (!urlPublica) {
        console.warn(`Aviso: falha ao enviar mídia ${path.basename(localPath)} para o Supabase Storage.`);
        midiasComFalha++;
        continue;
      }

      midia.caminhoLocal = midia.caminhoLocal || midia.caminho;
      midia.urlPublica = urlPublica;
      midia.caminho = urlPublica;
      agendamentosAtualizados = true;
      arquivosEnviados++;
    }
  }

  if (agendamentosAtualizados) {
    fs.writeFileSync(caminhoAgendamentos, JSON.stringify(agendamentos, null, 2), "utf-8");
    const salvo = await salvarChaveNoSupabase("agendamentos", agendamentos);
    if (!salvo) {
      console.error("Falha ao atualizar agendamentos com URLs públicas no Supabase.");
      process.exit(1);
    }
  }

  if (fs.existsSync("./data/auth.json")) {
    try {
      const authData = JSON.parse(fs.readFileSync("./data/auth.json", "utf-8"));
      await salvarChaveNoSupabase("auth_painel", authData);
    } catch {}
  }

  console.log(
    JSON.stringify({
      ok: true,
      syncInicial: { enviados: sync.enviadosParaNuvem, baixados: sync.baixadosDaNuvem },
      midiasEnviadas: arquivosEnviados,
      midiasJaPublicas: midiasReaproveitadas,
      midiasComFalha,
      agendamentosAtualizados
    })
  );
}

main();
