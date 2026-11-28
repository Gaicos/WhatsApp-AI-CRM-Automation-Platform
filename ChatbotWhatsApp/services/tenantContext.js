import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

export const TENANT_PADRAO = "admin";
const storageTenant = new AsyncLocalStorage();

export function normalizarTenantId(id) {
  const bruto = String(id || "").trim().toLowerCase();
  if (!bruto || bruto === TENANT_PADRAO) return TENANT_PADRAO;
  const limpo = bruto.replace(/[^a-z0-9_-]/g, "");
  return limpo || TENANT_PADRAO;
}

export function obterTenantAtual() {
  return storageTenant.getStore() || TENANT_PADRAO;
}

export function executarNoTenant(tenantId, fn) {
  return storageTenant.run(normalizarTenantId(tenantId), fn);
}

export function caminhoArquivoTenant(nomeArquivo, tenantId = obterTenantAtual()) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) {
    fs.mkdirSync("./data", { recursive: true });
    return `./data/${nomeArquivo}`;
  }
  const dir = `./data/tenants/${tid}`;
  fs.mkdirSync(dir, { recursive: true });
  return `${dir}/${nomeArquivo}`;
}

export function chaveSupabaseTenant(chave, tenantId = obterTenantAtual()) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) return chave;
  return `tenant:${tid}:${chave}`;
}

export function prefixoAuthWhatsappTenant(tenantId = obterTenantAtual()) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) return "";
  return `tenant:${tid}/`;
}

export function pastaAuthLocalTenant(tenantId = obterTenantAtual()) {
  const tid = normalizarTenantId(tenantId);
  if (tid === TENANT_PADRAO) return "auth_info";
  return path.join("auth_info_tenants", tid);
}
