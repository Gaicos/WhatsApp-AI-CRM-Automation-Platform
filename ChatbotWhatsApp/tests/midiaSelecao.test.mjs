import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-midia-"));
process.chdir(tmp);

const { selecionarMidiasParaEnvio, lerHistoricoMidias } = await import(
  pathToFileURL(path.join(raiz, "services/midiaSelecaoService.js")).href
);

// 1. Quando midiasAleatorias está desativado, devolve todas as mídias sem alterar
const todas = Array.from({ length: 5 }, (_, i) => ({ tipo: "imagem", caminho: `https://cdn/img-${i + 1}.jpg` }));
const semSorteio = selecionarMidiasParaEnvio({ id: "ag-fixo", midias: todas, midiasAleatorias: false });
assert.deepEqual(semSorteio, todas);

// 2. Cenário real: 20 imagens cadastradas, sorteando 3 por envio sem repetir até passar por todas
const vinteImagens = Array.from({ length: 20 }, (_, i) => ({
  tipo: "imagem",
  caminho: `https://cdn/foto-${i + 1}.jpg`,
  urlPublica: `https://cdn/foto-${i + 1}.jpg`
}));
const agendamento20 = {
  id: "agenda-teste-20",
  midias: vinteImagens,
  midiasAleatorias: true,
  qtdMidiasEnvio: 3
};

const vistasNosPrimeiros6Envios = new Set();
for (let dia = 1; dia <= 6; dia++) {
  const lote = selecionarMidiasParaEnvio(agendamento20);
  assert.equal(lote.length, 3, `envio ${dia} deve retornar 3 mídias`);
  for (const item of lote) {
    assert.equal(vistasNosPrimeiros6Envios.has(item.caminho), false, `não deve repetir ${item.caminho} antes de fechar o ciclo`);
    vistasNosPrimeiros6Envios.add(item.caminho);
  }
}
assert.equal(vistasNosPrimeiros6Envios.size, 18, "após 6 envios de 3, 18 imagens únicas foram enviadas");

// 7º envio: pega as 2 últimas restantes do 1º ciclo + 1 sorteada do novo ciclo (3 únicas no lote)
const lote7 = selecionarMidiasParaEnvio(agendamento20);
assert.equal(lote7.length, 3);
const chavesLote7 = new Set(lote7.map(m => m.caminho));
assert.equal(chavesLote7.size, 3, "lote 7 não pode ter duplicata interna na virada de ciclo");

let usadasDas2Restantes = 0;
for (const m of lote7) {
  if (!vistasNosPrimeiros6Envios.has(m.caminho)) usadasDas2Restantes++;
}
assert.equal(usadasDas2Restantes, 2, "as 2 últimas imagens do 1º ciclo precisam sair antes de reiniciar");

// Histórico salvo para o próximo envio deve conter apenas a 1 imagem que iniciou o novo ciclo
const hist = lerHistoricoMidias();
assert.equal(hist["agenda-teste-20"].length, 1);

// 3. Lista vazia ou qtd maior que o total cadastrado
assert.deepEqual(selecionarMidiasParaEnvio({ id: "vazio", midias: [], midiasAleatorias: true, qtdMidiasEnvio: 3 }), []);
const poucas = vinteImagens.slice(0, 2);
const loteMaior = selecionarMidiasParaEnvio({ id: "poucas", midias: poucas, midiasAleatorias: true, qtdMidiasEnvio: 5 });
assert.equal(loteMaior.length, 2);

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("midiaSelecaoService: todos os testes passaram");
