import fs from "node:fs";
import { salvarChaveNoSupabase } from "./supabaseService.js";
import { caminhoArquivoTenant, chaveSupabaseTenant } from "./tenantContext.js";

function embaralhar(lista, rng = Math.random) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function chaveMidia(midia, idx) {
  return String(midia?.urlPublica || midia?.caminho || idx);
}

export function normalizarQtdMidiasEnvio(valor) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 50);
}

export function lerHistoricoMidias() {
  const caminho = caminhoArquivoTenant("midiasHistorico.json");
  if (!fs.existsSync(caminho)) return {};
  try {
    const lido = JSON.parse(fs.readFileSync(caminho, "utf-8"));
    return lido && typeof lido === "object" && !Array.isArray(lido) ? lido : {};
  } catch {
    return {};
  }
}

function salvarHistoricoMidias(dados) {
  try {
    const caminho = caminhoArquivoTenant("midiasHistorico.json");
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), "utf-8");
    fs.renameSync(tmp, caminho);
    salvarChaveNoSupabase(chaveSupabaseTenant("midiasHistorico"), dados);
  } catch {}
}

/**
 * Seleciona aleatoriamente `qtdMidiasEnvio` mídias de um agendamento sem repetir
 * até passar por todas as mídias cadastradas (ciclo embaralhado salvo em disco/Supabase).
 */
export function selecionarMidiasParaEnvio(agendamento, { persistir = true, rng = Math.random } = {}) {
  const todas = Array.isArray(agendamento?.midias) ? agendamento.midias : [];
  if (todas.length === 0 || !agendamento?.midiasAleatorias) {
    return todas;
  }

  const qtdDesejada = normalizarQtdMidiasEnvio(agendamento.qtdMidiasEnvio) || todas.length;
  const qtd = Math.min(qtdDesejada, todas.length);

  if (qtd >= todas.length) {
    return embaralhar(todas, rng);
  }

  const chavesTodas = todas.map((m, i) => ({ midia: m, chave: chaveMidia(m, i) }));
  const historico = lerHistoricoMidias();
  const usadasLista = Array.isArray(historico[agendamento.id]) ? historico[agendamento.id] : [];
  const usadas = new Set(usadasLista);

  const naoUsadas = chavesTodas.filter(item => !usadas.has(item.chave));
  const jaUsadas = chavesTodas.filter(item => usadas.has(item.chave));

  const escolhidas = [];
  const chavesEscolhidas = new Set();

  for (const item of embaralhar(naoUsadas, rng)) {
    if (escolhidas.length >= qtd) break;
    if (chavesEscolhidas.has(item.chave)) continue;
    escolhidas.push(item);
    chavesEscolhidas.add(item.chave);
  }

  if (escolhidas.length < qtd) {
    // Fim do ciclo atual: inicia um novo ciclo completando o lote com itens restantes do pool antigo.
    const novasDoNovoCiclo = [];
    for (const item of embaralhar(jaUsadas, rng)) {
      if (escolhidas.length >= qtd) break;
      if (chavesEscolhidas.has(item.chave)) continue;
      escolhidas.push(item);
      chavesEscolhidas.add(item.chave);
      novasDoNovoCiclo.push(item.chave);
    }
    if (agendamento.id) {
      historico[agendamento.id] = novasDoNovoCiclo;
    }
  } else if (agendamento.id) {
    for (const item of escolhidas) {
      usadas.add(item.chave);
    }
    historico[agendamento.id] = [...usadas];
  }

  if (persistir && agendamento.id) {
    salvarHistoricoMidias(historico);
  }

  return escolhidas.map(item => item.midia);
}
