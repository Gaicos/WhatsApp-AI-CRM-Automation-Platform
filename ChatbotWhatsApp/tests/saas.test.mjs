import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-saas-"));
process.chdir(tmp);

const auth = await import(pathToFileURL(path.join(raiz, "services/authService.js")).href);
const tenantCtx = await import(pathToFileURL(path.join(raiz, "services/tenantContext.js")).href);
const tenants = await import(pathToFileURL(path.join(raiz, "services/tenantService.js")).href);
const configSvc = await import(pathToFileURL(path.join(raiz, "services/configService.js")).href);
const triagemSvc = await import(pathToFileURL(path.join(raiz, "services/triagemService.js")).href);
const webhookSvc = await import(pathToFileURL(path.join(raiz, "services/webhookService.js")).href);
const midiaSvc = await import(pathToFileURL(path.join(raiz, "services/midiaSelecaoService.js")).href);

// 1. Migracao automática da conta legada (auth.json -> admin superadmin)
await auth.garantirUsuarioPadrao();
await auth.trocarSenha("123", "Senha-Gaicos-2026");
await tenants.garantirTenantsIniciais();

const loginAdmin = await tenants.verificarCredenciaisTenant("ADMIN", "Senha-Gaicos-2026");
assert.equal(loginAdmin.ok, true);
assert.equal(loginAdmin.tenant.id, "admin");
assert.equal(loginAdmin.tenant.papel, "superadmin");
assert.equal(tenants.avaliarAcessoTenant(loginAdmin.tenant).liberado, true);

// 2. Auto-cadastro gratuito (7 dias) + bloqueio de usuario duplicado
const regFree = await tenants.registrarContaGratuita({
  nome: "Loja Teste Gratis",
  usuario: "testegratis",
  email: "teste@loja.com",
  senha: "Senha-Cliente-2026"
});
assert.equal(regFree.ok, true);
assert.equal(regFree.tenant.plano, "free");
assert.equal(regFree.tenant.papel, "cliente");

const regDup = await tenants.registrarContaGratuita({
  nome: "Outra",
  usuario: "TesteGratis",
  senha: "Senha-Cliente-2026"
});
assert.equal(regDup.ok, false);

const loginFree = await tenants.verificarCredenciaisTenant("testegratis", "Senha-Cliente-2026");
assert.equal(loginFree.ok, true);
assert.equal(tenants.avaliarAcessoTenant(loginFree.tenant).liberado, true);
assert.equal(tenants.avaliarAcessoTenant(loginFree.tenant).diasRestantes, 7);

// 3. Cadastro pelo Super Admin (Plano Pro) + Renovacao + Suspensao + Exclusao
const cliProRes = await tenants.criarClienteAdmin({
  nome: "Cliente Pro",
  usuario: "clientepro",
  email: "pro@loja.com",
  senha: "Senha-Pro-2026",
  plano: "pro",
  diasValidade: 30
});
assert.equal(cliProRes.ok, true);
const cliPro = cliProRes.tenant;

// Isolamento estrito entre admin, testegratis e clientepro
await tenantCtx.executarNoTenant("admin", () => {
  configSvc.salvarAgendamentos([{ id: "ag-admin", horario: "09:00", texto: "Admin Post", midias: [], grupos: [] }]);
  triagemSvc.salvarTriagem({ ativo: true, boasVindas: "Admin", nodeInicial: null, nodes: [], ia: { ativa: true } });
});

await tenantCtx.executarNoTenant(cliPro.id, () => {
  configSvc.salvarAgendamentos([{ id: "ag-pro", horario: "14:00", texto: "Pro Post", midias: [], grupos: [] }]);
  const wh = webhookSvc.lerConfigWebhook();
  assert.ok(wh.segredo.startsWith("whsec_"));
  const escolhidas = midiaSvc.selecionarMidiasParaEnvio({
    id: "ag-pro",
    midias: [{ tipo: "imagem", caminho: "a.jpg" }, { tipo: "imagem", caminho: "b.jpg" }],
    midiasAleatorias: true,
    qtdMidiasEnvio: 1
  });
  assert.equal(escolhidas.length, 1);
});

assert.equal(tenantCtx.executarNoTenant("admin", () => configSvc.lerAgendamentos()[0].id), "ag-admin");
assert.equal(tenantCtx.executarNoTenant(cliPro.id, () => configSvc.lerAgendamentos()[0].id), "ag-pro");
assert.equal(tenantCtx.executarNoTenant(regFree.tenant.id, () => configSvc.lerAgendamentos().length), 0);

// 4. Regras e limites do Plano Gratuito vs Pro
const freeLimitsCheck = tenants.validarAgendamentosNoPlano(
  [
    { id: "1", grupos: ["g1"], contatos: [], midias: [] },
    { id: "2", grupos: ["g1"], contatos: [], midias: [] }
  ],
  regFree.tenant
);
assert.equal(freeLimitsCheck.ok, false);
assert.equal(freeLimitsCheck.codigoLimite, "max_agendamentos");

assert.equal(
  tenants.validarAgendamentosNoPlano(
    [{ id: "1", grupos: ["g1", "g2", "g3"], contatos: [], midias: [] }],
    regFree.tenant
  ).codigoLimite,
  "max_grupos"
);

assert.equal(
  tenants.validarAgendamentosNoPlano(
    [{ id: "1", grupos: ["g1"], contatos: ["c1", "c2", "c3", "c4"], midias: [] }],
    regFree.tenant
  ).codigoLimite,
  "max_contatos"
);

assert.equal(
  tenants.validarAgendamentosNoPlano(
    [{ id: "1", grupos: ["g1"], contatos: [], midias: [{}, {}] }],
    regFree.tenant
  ).codigoLimite,
  "max_midias"
);

assert.equal(
  tenants.validarAgendamentosNoPlano(
    [{ id: "1", grupos: ["g1"], contatos: [], midias: [{}], midiasAleatorias: true }],
    regFree.tenant
  ).codigoLimite,
  "rodizio_midias"
);

assert.equal(
  tenants.validarAgendamentosNoPlano(
    [{ id: "1", grupos: ["g1", "g2"], contatos: ["c1", "c2", "c3"], midias: [{}] }],
    regFree.tenant
  ).ok,
  true
);

assert.equal(tenants.validarTriagemNoPlano({ ia: { provedor: "gemini" } }, regFree.tenant).ok, false);
assert.equal(tenants.validarTriagemNoPlano({ ia: { provedor: "gemini" } }, cliPro).ok, true);

// 5. Bloqueio automático por vencimento e desbloqueio por renovação (+30d)
const ontemIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
tenants.atualizarClienteAdmin(cliPro.id, { expiraEm: ontemIso });
const vencido = tenants.obterTenantPorId(cliPro.id);
assert.equal(tenants.avaliarAcessoTenant(vencido).liberado, false);
assert.equal(tenants.avaliarAcessoTenant(vencido).motivo, "assinatura_vencida");

const renovado = tenants.renovarClienteAdmin(cliPro.id, 30);
assert.equal(renovado.ok, true);
assert.equal(tenants.avaliarAcessoTenant(renovado.tenant).liberado, true);
assert.equal(tenants.avaliarAcessoTenant(renovado.tenant).diasRestantes, 30);

// 6. Exclusão limpa dados do tenant sem afetar admin
const excluiu = await tenants.excluirClienteAdmin(cliPro.id);
assert.equal(excluiu.ok, true);
assert.equal(tenants.obterTenantPorId(cliPro.id), null);
assert.equal(tenantCtx.executarNoTenant("admin", () => configSvc.lerAgendamentos()[0].id), "ag-admin");

process.chdir(raiz);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("saas multi-tenant: todos os testes passaram");
