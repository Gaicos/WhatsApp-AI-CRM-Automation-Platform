// Autenticação do painel: usuário/senha com hash (scrypt), sessões por cookie
// e proteção contra tentativas repetidas (força bruta).
// Usa apenas módulos nativos do Node — nenhuma dependência extra.

import crypto from "node:crypto";
import fs from "node:fs";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

const CAMINHO_AUTH = "./data/auth.json";
const CAMINHO_SESSOES = "./data/sessoes.json";

export const USUARIO_PADRAO = "ADMIN";
const SENHA_PADRAO = "123";

const SCRYPT = { N: 16384, r: 8, p: 1 };
const TAMANHO_CHAVE = 64;

export const SESSAO_MAX_OCIOSA_MS = 12 * 60 * 60 * 1000;      // 12h sem usar = desloga
export const SESSAO_MAX_TOTAL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 dias no máximo
const MAX_SESSOES = 10;

const MAX_FALHAS = 5;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

const SENHAS_FRACAS = new Set([
    "123", "1234", "12345", "123456", "1234567", "12345678", "123456789", "0123456789",
    "senha", "senha123", "senha1234", "password", "password1", "qwerty123", "admin123",
    "admin1234", "abc12345", "mudar123", "trocar123", "11111111", "00000000",
]);

// ---------- armazenamento ----------

function escreverArquivoAtomico(caminho, conteudo) {
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, conteudo, { mode: 0o600 });
    fs.renameSync(tmp, caminho);
}

async function hashSenha(senha, saltHex) {
    const salt = Buffer.from(saltHex, "hex");
    const chave = await scrypt(senha.normalize("NFKC"), salt, TAMANHO_CHAVE, SCRYPT);
    return chave.toString("hex");
}

async function montarRegistro(usuario, senha, precisaTrocarSenha) {
    const salt = crypto.randomBytes(16).toString("hex");
    return {
        usuario,
        salt,
        hash: await hashSenha(senha, salt),
        precisaTrocarSenha,
        atualizadoEm: new Date().toISOString(),
    };
}

function lerAuth() {
    return JSON.parse(fs.readFileSync(CAMINHO_AUTH, "utf-8"));
}

function salvarAuth(registro) {
    escreverArquivoAtomico(CAMINHO_AUTH, JSON.stringify(registro, null, 2));
}

// Cria o usuário padrão na primeira execução. A senha padrão obriga troca no primeiro acesso.
export async function garantirUsuarioPadrao() {
    fs.mkdirSync("./data", { recursive: true });

    if (fs.existsSync(CAMINHO_AUTH)) {
        try {
            const r = lerAuth();
            if (r.usuario && r.salt && r.hash) return;
        } catch { /* cai para a recriação abaixo */ }

        const backup = `${CAMINHO_AUTH}.corrompido-${Date.now()}`;
        fs.renameSync(CAMINHO_AUTH, backup);
        console.log(`⚠️ Arquivo de login estava inválido e foi movido para ${backup}. Usuário padrão recriado.`);
    }

    salvarAuth(await montarRegistro(USUARIO_PADRAO, SENHA_PADRAO, true));
    console.log(`🔐 Login criado: usuário ${USUARIO_PADRAO} / senha ${SENHA_PADRAO} (será pedido para trocar a senha no primeiro acesso).`);
}

// Volta ao usuário/senha padrão (usado pelo script resetar-senha.js, rodado na máquina).
export async function resetarParaPadrao() {
    fs.mkdirSync("./data", { recursive: true });
    salvarAuth(await montarRegistro(USUARIO_PADRAO, SENHA_PADRAO, true));
    escreverArquivoAtomico(CAMINHO_SESSOES, "{}"); // derruba todas as sessões
    sessoes = new Map();
}

// ---------- validação de credenciais ----------

function igualSeguro(a, b) {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const SALT_FALSO = crypto.randomBytes(16).toString("hex");

export async function verificarCredenciais(usuario, senha) {
    if (typeof usuario !== "string" || typeof senha !== "string") return { ok: false };
    if (usuario.length > 100 || senha.length > 200) return { ok: false };

    const r = lerAuth();
    const usuarioOk = usuario.trim().toLowerCase() === r.usuario.toLowerCase();

    // Sempre calcula o hash (mesmo com usuário errado) para o tempo de resposta não revelar se o usuário existe.
    const hashCalculado = await hashSenha(senha, usuarioOk ? r.salt : SALT_FALSO);
    const senhaOk = usuarioOk && igualSeguro(hashCalculado, r.hash);

    return senhaOk ? { ok: true, usuario: r.usuario, precisaTrocarSenha: !!r.precisaTrocarSenha } : { ok: false };
}

export function validarNovaSenha(novaSenha, usuario = USUARIO_PADRAO) {
    if (typeof novaSenha !== "string") return "Senha inválida.";
    if (novaSenha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
    if (novaSenha.length > 200) return "A senha é longa demais.";
    if (SENHAS_FRACAS.has(novaSenha.toLowerCase())) return "Essa senha é muito comum. Escolha outra.";
    if (novaSenha.toLowerCase() === String(usuario).toLowerCase()) return "A senha não pode ser igual ao usuário.";
    if (/^(.)\1+$/.test(novaSenha)) return "A senha não pode ser só um caractere repetido.";
    return null;
}

export async function trocarSenha(senhaAtual, novaSenha) {
    const r = lerAuth();
    const atual = await verificarCredenciais(r.usuario, senhaAtual);
    if (!atual.ok) return { ok: false, erro: "Senha atual incorreta." };

    const erro = validarNovaSenha(novaSenha, r.usuario);
    if (erro) return { ok: false, erro };

    if (senhaAtual === novaSenha) return { ok: false, erro: "A nova senha precisa ser diferente da atual." };

    salvarAuth(await montarRegistro(r.usuario, novaSenha, false));
    return { ok: true };
}

// ---------- limite de tentativas (força bruta) ----------

const tentativas = new Map(); // chave (ip) -> { falhas: [timestamps], bloqueadoAte }

export function verificarBloqueio(chave) {
    const t = tentativas.get(chave);
    if (t?.bloqueadoAte && t.bloqueadoAte > Date.now()) {
        return { bloqueado: true, segundos: Math.ceil((t.bloqueadoAte - Date.now()) / 1000) };
    }
    return { bloqueado: false };
}

export function registrarFalha(chave) {
    const agora = Date.now();
    const t = tentativas.get(chave) || { falhas: [], bloqueadoAte: 0 };
    t.falhas = t.falhas.filter(x => agora - x < JANELA_FALHAS_MS);
    t.falhas.push(agora);
    if (t.falhas.length >= MAX_FALHAS) {
        t.bloqueadoAte = agora + BLOQUEIO_MS;
        t.falhas = [];
    }
    tentativas.set(chave, t);
}

export function limparFalhas(chave) {
    tentativas.delete(chave);
}

// ---------- sessões ----------

let sessoes = carregarSessoes();

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function carregarSessoes() {
    try {
        const obj = JSON.parse(fs.readFileSync(CAMINHO_SESSOES, "utf-8"));
        return new Map(Object.entries(obj));
    } catch {
        return new Map();
    }
}

function persistirSessoes() {
    try {
        fs.mkdirSync("./data", { recursive: true });
        escreverArquivoAtomico(CAMINHO_SESSOES, JSON.stringify(Object.fromEntries(sessoes)));
    } catch (err) {
        console.log("Aviso: não foi possível salvar sessões:", err.message);
    }
}

function expirada(s, agora = Date.now()) {
    return agora - s.ultimoUso > SESSAO_MAX_OCIOSA_MS || agora - s.criadaEm > SESSAO_MAX_TOTAL_MS;
}

function limparExpiradas() {
    const agora = Date.now();
    let mudou = false;
    for (const [k, s] of sessoes) {
        if (expirada(s, agora)) { sessoes.delete(k); mudou = true; }
    }
    if (mudou) persistirSessoes();
}

export function criarSessao(usuario, precisaTrocarSenha) {
    limparExpiradas();

    // limite de sessões simultâneas: descarta as mais antigas
    const ordenadas = [...sessoes.entries()].sort((a, b) => a[1].criadaEm - b[1].criadaEm);
    while (ordenadas.length >= MAX_SESSOES) sessoes.delete(ordenadas.shift()[0]);

    const token = crypto.randomBytes(32).toString("hex");
    const agora = Date.now();
    sessoes.set(hashToken(token), { usuario, precisaTrocarSenha, criadaEm: agora, ultimoUso: agora });
    persistirSessoes();
    return token;
}

export function obterSessao(token) {
    if (!token || typeof token !== "string" || token.length > 200) return null;
    const chave = hashToken(token);
    const s = sessoes.get(chave);
    if (!s) return null;
    if (expirada(s)) {
        sessoes.delete(chave);
        persistirSessoes();
        return null;
    }
    s.ultimoUso = Date.now();
    return s;
}

export function encerrarSessao(token) {
    if (!token) return;
    if (sessoes.delete(hashToken(token))) persistirSessoes();
}

// Depois de trocar a senha: derruba todas as outras sessões e libera a atual.
export function aposTrocaDeSenha(tokenAtual) {
    const chaveAtual = tokenAtual ? hashToken(tokenAtual) : null;
    for (const k of [...sessoes.keys()]) if (k !== chaveAtual) sessoes.delete(k);
    const atual = chaveAtual && sessoes.get(chaveAtual);
    if (atual) atual.precisaTrocarSenha = false;
    persistirSessoes();
}
