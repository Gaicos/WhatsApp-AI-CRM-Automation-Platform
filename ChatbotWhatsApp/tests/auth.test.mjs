import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-auth-"));
process.chdir(tmp); // authService grava em ./data, então trabalha numa pasta temporária

const auth = await import(pathToFileURL(path.join(raiz, "services/authService.js")).href);

await auth.garantirUsuarioPadrao();

// login padrão
let r = await auth.verificarCredenciais("ADMIN", "123");
assert.equal(r.ok, true);
assert.equal(r.precisaTrocarSenha, true);
assert.equal((await auth.verificarCredenciais("admin", "123")).ok, true, "usuário sem diferença de maiúsculas");
assert.equal((await auth.verificarCredenciais("ADMIN", "errada")).ok, false);
assert.equal((await auth.verificarCredenciais("OUTRO", "123")).ok, false);
assert.equal((await auth.verificarCredenciais(undefined, undefined)).ok, false);

// validação de senha nova
assert.ok(auth.validarNovaSenha("123456"), "curta/comum");
assert.ok(auth.validarNovaSenha("abc"), "curta");
assert.ok(auth.validarNovaSenha("aaaaaaaaa"), "caractere repetido");
assert.ok(auth.validarNovaSenha("senha1234"), "comum");
assert.equal(auth.validarNovaSenha("Minha-Senha-2026"), null);

// troca de senha
let t = await auth.trocarSenha("errada", "Minha-Senha-2026");
assert.equal(t.ok, false);
t = await auth.trocarSenha("123", "Minha-Senha-2026");
assert.equal(t.ok, true);
assert.equal((await auth.verificarCredenciais("ADMIN", "123")).ok, false, "senha antiga não vale mais");
r = await auth.verificarCredenciais("ADMIN", "Minha-Senha-2026");
assert.equal(r.ok, true);
assert.equal(r.precisaTrocarSenha, false);

// senha nunca fica em texto puro no arquivo
assert.equal(fs.readFileSync(path.join(tmp, "data/auth.json"), "utf-8").includes("Minha-Senha-2026"), false);

// limite de tentativas
for (let i = 0; i < 5; i++) auth.registrarFalha("ip-teste");
assert.equal(auth.verificarBloqueio("ip-teste").bloqueado, true);
auth.limparFalhas("ip-teste");
assert.equal(auth.verificarBloqueio("ip-teste").bloqueado, false);

// sessões
const token = auth.criarSessao("ADMIN", false);
assert.equal(auth.obterSessao(token).usuario, "ADMIN");
assert.equal(auth.obterSessao("token-falso"), null);
assert.equal(auth.obterSessao(null), null);
assert.equal(fs.readFileSync(path.join(tmp, "data/sessoes.json"), "utf-8").includes(token), false, "guarda só o hash do token");
auth.encerrarSessao(token);
assert.equal(auth.obterSessao(token), null);

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("authService: todos os testes passaram");
