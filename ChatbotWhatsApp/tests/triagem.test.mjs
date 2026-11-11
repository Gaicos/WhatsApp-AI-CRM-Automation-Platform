import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-triagem-"));
process.chdir(tmp);

const triagem = await import(pathToFileURL(path.join(raiz, "services/triagemService.js")).href);

const valido = {
  ativo: true,
  boasVindas: "Olá!",
  nodeInicial: "inicio",
  nodes: [{
    id: "inicio",
    titulo: "Escolha",
    texto: "O que você precisa?",
    opcoes: [
      { texto: "Vendas", proxima: "vendas", resposta: "Vou te ajudar com vendas." },
      { texto: "Suporte", proxima: null, resposta: "" }
    ]
  }, {
    id: "vendas",
    titulo: "Vendas",
    texto: "Qual produto?",
    opcoes: [{ texto: "Plano mensal", proxima: null }]
  }]
};

assert.equal(triagem.validarTriagem(valido).ok, true);
triagem.salvarTriagem(valido);
assert.equal(triagem.lerTriagem().nodeInicial, "inicio");

const dezOpcoes = {
  ...valido,
  nodes: [{ ...valido.nodes[0], opcoes: Array.from({ length: 10 }, (_, i) => ({ texto: `Opção ${i + 1}`, proxima: null })) }]
};
assert.equal(triagem.validarTriagem(dezOpcoes).ok, false, "limite máximo de 9 opções");

const destinoInexistente = JSON.parse(JSON.stringify(valido));
destinoInexistente.nodes[0].opcoes[0].proxima = "nao-existe";
assert.equal(triagem.validarTriagem(destinoInexistente).ok, false, "não aceita destino inexistente");

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("triagemService: todos os testes passaram");
