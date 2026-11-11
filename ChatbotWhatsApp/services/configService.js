import fs from "fs";

const CAMINHO_GRUPOS = "./data/grupos.json";
const CAMINHO_AGENDAMENTOS = "./data/agendamentos.json";
const CAMINHO_ENVIOS = "./data/envios.json";
const CAMINHO_HISTORICO = "./data/historico.json";
const CAMINHO_CONFIG = "./data/config.json";
const CAMINHO_CONTATOS = "./data/contatos.json";
const CAMINHO_LISTAS = "./data/listasContatos.json";

export function lerGrupos() {
    return JSON.parse(fs.readFileSync(CAMINHO_GRUPOS, "utf-8"));
}

export function salvarGrupos(grupos) {
    fs.writeFileSync(CAMINHO_GRUPOS, JSON.stringify(grupos, null, 2));
}

export function lerAgendamentos() {
    return JSON.parse(fs.readFileSync(CAMINHO_AGENDAMENTOS, "utf-8"));
}

export function salvarAgendamentos(agendamentos) {
    fs.writeFileSync(CAMINHO_AGENDAMENTOS, JSON.stringify(agendamentos, null, 2));
}

export function lerEnvios() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_ENVIOS, "utf-8"));
    } catch {
        return {};
    }
}

export function salvarEnvios(envios) {
    fs.writeFileSync(CAMINHO_ENVIOS, JSON.stringify(envios, null, 2));
}

export function lerHistorico() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_HISTORICO, "utf-8"));
    } catch {
        return [];
    }
}

export function registrarHistorico(entrada) {
    const historico = lerHistorico();
    historico.unshift(entrada);
    if (historico.length > 300) historico.length = 300;
    fs.writeFileSync(CAMINHO_HISTORICO, JSON.stringify(historico, null, 2));
}

export function lerConfig() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_CONFIG, "utf-8"));
    } catch {
        return { grupoControleId: null };
    }
}

export function salvarConfig(config) {
    fs.writeFileSync(CAMINHO_CONFIG, JSON.stringify(config, null, 2));
}

export function lerContatos() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_CONTATOS, "utf-8"));
    } catch {
        return [];
    }
}

export function salvarContatos(contatos) {
    fs.writeFileSync(CAMINHO_CONTATOS, JSON.stringify(contatos, null, 2));
}

export function lerListasContatos() {
    try {
        return JSON.parse(fs.readFileSync(CAMINHO_LISTAS, "utf-8"));
    } catch {
        return [];
    }
}

export function salvarListasContatos(listas) {
    fs.writeFileSync(CAMINHO_LISTAS, JSON.stringify(listas, null, 2));
}