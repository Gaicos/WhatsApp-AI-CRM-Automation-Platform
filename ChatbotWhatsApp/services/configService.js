import fs from "fs";
import { salvarChaveNoSupabase } from "./supabaseService.js";
import { caminhoArquivoTenant, chaveSupabaseTenant } from "./tenantContext.js";

function lerJsonTenant(nomeArquivo, padrao) {
    try {
        return JSON.parse(fs.readFileSync(caminhoArquivoTenant(nomeArquivo), "utf-8"));
    } catch {
        return padrao;
    }
}

function salvarJsonTenant(nomeArquivo, chaveSupabase, dados) {
    const caminho = caminhoArquivoTenant(nomeArquivo);
    fs.writeFileSync(caminho, JSON.stringify(dados, null, 2));
    salvarChaveNoSupabase(chaveSupabaseTenant(chaveSupabase), dados);
}

export function lerGrupos() {
    return lerJsonTenant("grupos.json", []);
}

export function salvarGrupos(grupos) {
    salvarJsonTenant("grupos.json", "grupos", grupos);
}

export function lerAgendamentos() {
    return lerJsonTenant("agendamentos.json", []);
}

export function salvarAgendamentos(agendamentos) {
    salvarJsonTenant("agendamentos.json", "agendamentos", agendamentos);
}

export function lerEnvios() {
    return lerJsonTenant("envios.json", {});
}

export function salvarEnvios(envios) {
    salvarJsonTenant("envios.json", "envios", envios);
}

export function lerHistorico() {
    return lerJsonTenant("historico.json", []);
}

export function registrarHistorico(entrada) {
    const historico = lerHistorico();
    historico.unshift(entrada);
    if (historico.length > 300) historico.length = 300;
    salvarJsonTenant("historico.json", "historico", historico);
}

export function lerConfig() {
    return lerJsonTenant("config.json", { grupoControleId: null });
}

export function salvarConfig(config) {
    salvarJsonTenant("config.json", "config", config);
}

export function lerContatos() {
    return lerJsonTenant("contatos.json", []);
}

export function salvarContatos(contatos) {
    salvarJsonTenant("contatos.json", "contatos", contatos);
}

export function lerListasContatos() {
    return lerJsonTenant("listasContatos.json", []);
}

export function salvarListasContatos(listas) {
    salvarJsonTenant("listasContatos.json", "listasContatos", listas);
}
