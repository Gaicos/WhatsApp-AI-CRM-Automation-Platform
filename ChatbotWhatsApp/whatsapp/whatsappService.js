
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@itsliaaa/baileys";
import * as baileysLib from "@itsliaaa/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import fs from "fs";
import pino from "pino";
import { registrarHistorico, lerConfig } from "../services/configService.js";
import { statusProcesso, reiniciarProcesso } from "../services/processoService.js";
import { textoHistorico, textoAgendamentos, textoAjuda } from "../services/comandosService.js";
import { processarTriagem } from "../services/triagemService.js";
import {
    useSupabaseAuthState,
    restaurarAuthWhatsappDoSupabase,
    salvarCredsWhatsappNoSupabase,
    limparAuthWhatsappNoSupabase
} from "../services/supabaseAuthStateService.js";
import { obterClienteSupabase } from "../services/supabaseService.js";

function deveUsarAuthSupabase() {
    if (!obterClienteSupabase()) return false;
    if (process.env.USE_SUPABASE_AUTH === "true") return true;
    const emNuvem = Boolean(
        process.env.RENDER ||
        process.env.KOYEB_APP_NAME ||
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.FLY_APP_NAME ||
        process.env.CLOUD_MODE
    );
    if (emNuvem) return true;
    return Boolean(process.env.SUPABASE_URL) && !fs.existsSync("./auth_info/creds.json");
}

let sockAtual = null;
let desligadoManualmente = false;
let sessaoInvalida = false;
let whatsappConectado = false;
let qrAtual = null;

// Oculta objetos criptograficos internos da Baileys/libsignal.
const consoleInfoOriginal = console.info.bind(console);
console.info = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("Closing session:")) return;
    consoleInfoOriginal(...args);
};
const loggerBaileys = pino({ level: "silent" });

// O WhatsApp recusa (erro 405) quando o cliente se apresenta com uma versão antiga.
// Busca a versão atual do WhatsApp Web antes de conectar.
async function obterVersaoWhatsapp() {
    try {
        const buscar = baileysLib.fetchLatestWaWebVersion || baileysLib.fetchLatestBaileysVersion;
        if (typeof buscar !== "function") {
            return undefined;
        }
        const resultado = await buscar();
        const versao = resultado.version;
        return versao;
    } catch (err) {
        console.log("Não consegui buscar a versão atual do WhatsApp:", err.message);
        return undefined;
    }
}
let tentativasFalhas = 0;
let geracaoAtual = 0;
const gruposRecebidos = new Map(); // id -> metadados recebidos pelos eventos          // cada nova conexão ganha um número; eventos de conexões antigas são ignorados
let credenciaisAtuais = null;  // para saber se o aparelho já foi pareado (registered) ou ainda está no QR
let erroConexao = null;
const MAX_TENTATIVAS = 8;

function esperaEntreTentativas() {
    // 5s, 10s, 20s, 40s... até 5 minutos. Evita martelar o WhatsApp.
    return Math.min(5000 * 2 ** (tentativasFalhas - 1), 5 * 60 * 1000);
}

// Conexão com o WhatsApp
export async function conectarWhatsApp() {
    desligadoManualmente = false;
    sessaoInvalida = false;
    whatsappConectado = false;
    qrAtual = null;

    const usandoSupabaseAuth = deveUsarAuthSupabase();
    let state;
    let saveCreds;
    if (usandoSupabaseAuth) {
        const authNuvem = await useSupabaseAuthState();
        state = authNuvem.state;
        saveCreds = authNuvem.saveCreds;
        console.log("☁️ Usando sessão do WhatsApp 100% na nuvem (Supabase).");
    } else {
        await restaurarAuthWhatsappDoSupabase("auth_info");
        const authLocal = await useMultiFileAuthState("auth_info");
        state = authLocal.state;
        saveCreds = authLocal.saveCreds;
    }
    credenciaisAtuais = state.creds;
    const minhaGeracao = ++geracaoAtual;

    const versao = await obterVersaoWhatsapp();
    const sock = versao
        ? makeWASocket({ auth: state, version: versao, logger: loggerBaileys })
        : makeWASocket({ auth: state, logger: loggerBaileys });
    sockAtual = sock;

    sock.ev.on("creds.update", async () => {
        await saveCreds();
        if (!usandoSupabaseAuth) {
            await salvarCredsWhatsappNoSupabase("auth_info");
        }
    });

    // Grupos chegam aos poucos durante a sincronização; guarda os que forem recebidos.
    const registrarGrupos = (lista) => {
        for (const g of lista || []) {
            if (g?.id) gruposRecebidos.set(g.id, { subject: g.subject, announce: !!g.announce, isCommunity: !!g.isCommunity });
        }
    };
    sock.ev.on("groups.upsert", registrarGrupos);
    sock.ev.on("groups.update", (lista) => registrarGrupos(lista));

    sock.ev.on("connection.update", async (update) => {
        if (minhaGeracao !== geracaoAtual) return; // evento de uma conexão substituída
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            qrcodeTerminal.generate(qr, { small: true });

            try {
                qrAtual = await QRCode.toDataURL(qr);
            } catch (err) {
                console.log("Erro ao gerar imagem do QR Code:", err.message);
            }
        }

        if (connection === "open") {
            whatsappConectado = true;
            qrAtual = null;
            sessaoInvalida = false;
            tentativasFalhas = 0;
            erroConexao = null;
            salvarCredsWhatsappNoSupabase("auth_info");
            console.log("✅ WhatsApp conectado e pronto para enviar mensagens.");
        }

        if (connection === "close") {
            whatsappConectado = false;
            qrAtual = null;
            sockAtual = null;

            if (desligadoManualmente) {
                console.log("🔌 Bot desligado manualmente — não vai reconectar sozinho.");
                return;
            }

            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const deveReconectar = statusCode !== DisconnectReason.loggedOut;

            console.log(`❌ Conexão encerrada (código ${statusCode}).`);

                        if (statusCode === 440) {
                erroConexao = "Outro programa assumiu esta conta do WhatsApp. Feche o outro bot e clique em Ligar.";
                console.log("⛔ Outro programa usou esta conta do WhatsApp. Não vou reconectar para não brigar com ele.");
                return;
            }

            if (deveReconectar) {
                tentativasFalhas++;
                const pareando = !credenciaisAtuais?.registered;

                if (statusCode === 405) {
                    erroConexao = "O WhatsApp recusou a conexão: a biblioteca está desatualizada. Feche o programa e clique duas vezes em Atualizar Bibliotecas.bat.";
                } else if (pareando) {
                    erroConexao = null; // ainda no QR Code: não é erro, só aguardando a leitura
                } else {
                    erroConexao = `Não foi possível conectar (código ${statusCode}).`;
                }

                // Enquanto o aparelho não foi pareado, nunca desiste: sempre gera um novo QR Code.
                if (!pareando && tentativasFalhas >= MAX_TENTATIVAS) {
                    console.log("⛔ Muitas tentativas sem sucesso. Use o botão Ligar ou Gerar novo QR Code depois de resolver.");
                    return;
                }
                const espera = pareando
                    ? Math.min(2000 * tentativasFalhas, 15000)
                    : esperaEntreTentativas();
                console.log(`${pareando ? "Gerando novo QR Code" : "Nova tentativa"} em ${espera / 1000}s...`);
                setTimeout(() => {
                    conectarWhatsApp().catch(err => console.log("Erro ao reconectar:", err.message));
                }, espera);
            } else {
                sessaoInvalida = true;
                // Credenciais já não valem mais: apaga a sessão antiga e gera um QR Code novo.
                fs.rmSync("./auth_info", { recursive: true, force: true });
                limparAuthWhatsappNoSupabase();
                console.log("⚠️ Sessão encerrada pelo WhatsApp. Pasta auth_info removida; gerando novo QR Code...");
                setTimeout(() => conectarWhatsApp(), 1000);
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type && type !== "notify") return;
        for (const msg of messages) {
            await processarComando(sock, msg);
        }
    });

    return sock;
}

// Retorna o QR Code atual
export function getQrAtual() {
    return qrAtual;
}

// Processamento dos comandos recebidos
async function processarComando(sock, msg) {
    if (!msg.message) return;

    // Triagem automática de mensagens privadas. Comandos remotos continuam separados abaixo.
    try {
        const respondeuTriagem = await processarTriagem(sock, msg);
        if (respondeuTriagem) return;
    } catch (err) {
        console.log("Erro ao processar triagem automática:", err.message);
    }

    const config = lerConfig();
    if (!config.grupoControleId) return;
    if (msg.key.remoteJid !== config.grupoControleId) return;

    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!texto.startsWith("!")) return;

    const comando = texto.trim().toLowerCase();
    const destino = msg.key.remoteJid;

    try {
        if (comando === "!status") {
            const pm2Info = statusProcesso();
            const conexao = statusConexao();

            let resposta = `🤖 Status do bot\n\n`;
            resposta += `Conexão WhatsApp: ${conexao.conectado ? "✅ conectado" : "🔌 desconectado"}\n`;

            if (pm2Info) {
                const horas = (pm2Info.uptimeMs / 3600000).toFixed(1);
                const memMb = (pm2Info.memoria / 1024 / 1024).toFixed(1);

                resposta += `Programa: ${pm2Info.status}\nNo ar: ${horas}h\nMemória: ${memMb} MB\nCPU: ${pm2Info.cpu}%`;
            } else {
                resposta += `Programa: indisponível`;
            }

            await sock.sendMessage(destino, { text: resposta });

        } else if (comando === "!historico") {
            await sock.sendMessage(destino, { text: textoHistorico() });

        } else if (comando === "!agendamentos") {
            await sock.sendMessage(destino, { text: textoAgendamentos() });

        } else if (comando === "!restart") {
            await sock.sendMessage(destino, {
                text: "🔄 Reiniciando o programa... aguarde alguns segundos."
            });
            reiniciarProcesso();

        } else if (comando === "!ajuda" || comando === "!help") {
            await sock.sendMessage(destino, { text: textoAjuda() });
        }
    } catch (err) {
        console.log("Erro ao processar comando:", err.message);
    }
}

// Retorna o socket atual
export function getSock() {
    return sockAtual;
}

export function getGruposRecebidos() {
    return Object.fromEntries(gruposRecebidos);
}

// Gera um novo QR Code (usado quando o usuário perdeu ou não conseguiu ler o anterior)
export async function gerarNovoQr() {
    tentativasFalhas = 0;
    erroConexao = null;
    desligadoManualmente = false;
    if (sockAtual) {
        try { sockAtual.end(new Error("Novo QR Code solicitado")); } catch {}
        sockAtual = null;
    }
    whatsappConectado = false;
    qrAtual = null;
    if (!credenciaisAtuais?.registered) {
        // ainda não pareado: apaga a tentativa anterior para começar limpo
        fs.rmSync("./auth_info", { recursive: true, force: true });
        await limparAuthWhatsappNoSupabase();
    }
    await conectarWhatsApp();
}

// Desconecta o WhatsApp e remove este aparelho da conta (usado na desinstalação)
export async function sairDoWhatsapp() {
    desligadoManualmente = true;
    const sock = sockAtual;
    if (sock) {
        try { await sock.logout(); } catch (err) { console.log("Aviso ao sair do WhatsApp:", err.message); }
    }
    sockAtual = null;
    whatsappConectado = false;
}

// Desliga o bot manualmente
export function desligarBot() {
    desligadoManualmente = true;
    whatsappConectado = false;
    qrAtual = null;

    if (sockAtual) {
        try {
            sockAtual.end(new Error("Desligado manualmente pelo painel"));
        } catch {}

        sockAtual = null;
        console.log("🔌 Bot desligado manualmente pelo painel.");
    }
}

// Liga o bot novamente
export async function ligarBot() {
    if (sockAtual) return;
    tentativasFalhas = 0;
    erroConexao = null;

    console.log("🔌 Ligando o bot novamente...");
    await conectarWhatsApp();
}

// Status real da conexão
export function statusConexao() {
    return {
        conectado: whatsappConectado,
        desligadoManualmente,
        sessaoInvalida,
        erroConexao
    };
}

// Intervalo aleatório entre envios
function delayAleatorio(minMs, maxMs) {
    const tempo = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, tempo));
}

async function carregarBufferMidia(midia) {
    const caminho = midia?.caminho || "";
    const urlRemota = midia?.urlPublica || (/^https?:\/\//i.test(caminho) ? caminho : "");
    if (caminho && !/^https?:\/\//i.test(caminho) && fs.existsSync(caminho)) {
        return fs.readFileSync(caminho);
    }
    if (urlRemota) {
        const resp = await fetch(urlRemota);
        if (!resp.ok) throw new Error(`Falha ao baixar mídia da nuvem (${resp.status})`);
        return Buffer.from(await resp.arrayBuffer());
    }
    return fs.readFileSync(caminho);
}

// Envio de mensagens e mídias para um grupo
async function enviarParaGrupo(sock, grupoId, mensagem) {
    const { texto, midias } = mensagem;

    if (!midias || midias.length === 0) {
        await sock.sendMessage(grupoId, { text: texto });
        return;
    }

    if (midias.length === 1) {
        const midia = midias[0];
        const buffer = await carregarBufferMidia(midia);

        if (midia.tipo === "imagem") {
            await sock.sendMessage(grupoId, { image: buffer, caption: texto });
        } else {
            await sock.sendMessage(grupoId, { video: buffer, caption: texto });
        }

        return;
    }

    const itensAlbum = [];
    for (const [index, midia] of midias.entries()) {
        const buffer = await carregarBufferMidia(midia);
        const caption = index === 0 ? texto : undefined;

        if (midia.tipo === "imagem") {
            itensAlbum.push({ image: buffer, caption });
        } else {
            itensAlbum.push({ video: buffer, caption });
        }
    }

    await sock.sendMessage(grupoId, { album: itensAlbum });
}

/**
 * Resolve o JID válido do WhatsApp a partir de um objeto (grupo ou contato) ou número em string.
 * Suporta contatos legados cujo `id` é um timestamp numérico sem `@s.whatsapp.net`.
 */
export async function resolverJidDestino(sock, destino) {
    const ehObjeto = destino && typeof destino === "object";
    const idBruto = ehObjeto ? String(destino.id || "").trim() : String(destino || "").trim();

    if (idBruto.includes("@")) {
        return idBruto;
    }

    const candidato = ehObjeto ? String(destino.telefone || destino.id || "").trim() : idBruto;
    let digits = candidato.replace(/\D/g, "");
    if (!digits) {
        throw new Error("Destino de WhatsApp não informado.");
    }
    if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
        digits = digits.slice(1);
    }
    if (digits.length === 10 || digits.length === 11) {
        digits = `55${digits}`;
    }
    if (digits.length < 10 || digits.length > 15) {
        throw new Error("Número de telefone inválido para envio no WhatsApp.");
    }

    let jid = `${digits}@s.whatsapp.net`;
    if (sock && typeof sock.onWhatsApp === "function") {
        try {
            const verificado = await sock.onWhatsApp(digits);
            if (Array.isArray(verificado) && verificado[0]?.jid) {
                jid = verificado[0].jid;
            }
        } catch {}
    }
    return jid;
}

// Envio para vários grupos e contatos
export async function enviarMensagemGrupos(grupos, mensagem, contexto = {}) {
    const resultado = { enviados: 0, falhas: 0 };
    for (const grupo of grupos) {
        const sock = getSock();
        const nomeDestino = grupo.nome || grupo.id || "destino";

        if (!sock || !whatsappConectado) {
            console.log("⚠️ WhatsApp não conectado, abortando envios.");

            registrarHistorico({
                data: new Date().toISOString(),
                horario: contexto.horario || null,
                origem: contexto.origem || "agendado",
                grupo: nomeDestino,
                sucesso: false,
                erro: "WhatsApp não conectado",
            });
            resultado.falhas++;
            return resultado;
        }

        try {
            const jidDestino = await resolverJidDestino(sock, grupo);
            await enviarParaGrupo(sock, jidDestino, mensagem);

            console.log(`[${new Date().toLocaleTimeString()}] ✅ Enviado para: ${grupo.nome}`);

            registrarHistorico({
                data: new Date().toISOString(),
                horario: contexto.horario || null,
                origem: contexto.origem || "agendado",
                grupo: nomeDestino,
                sucesso: true,
                erro: null,
            });
            resultado.enviados++;

        } catch (err) {
            console.log(`[${new Date().toLocaleTimeString()}] ❌ Falhou em: ${grupo.nome} — ${err.message}`);

            registrarHistorico({
                data: new Date().toISOString(),
                horario: contexto.horario || null,
                origem: contexto.origem || "agendado",
                grupo: nomeDestino,
                sucesso: false,
                erro: err.message,
            });
            resultado.falhas++;
        }

        await delayAleatorio(8000, 20000);
    }

    console.log("🏁 Envio para todos os grupos concluído.");
    return resultado;
}

/**
 * Envia uma mensagem direta (texto ou mídia por URL pública) para um número ou JID de grupo.
 * Usada pelo Webhook de integração com o site e alertas no Grupo de Controle.
 */
export async function enviarMensagemDireta(destino, { texto = "", midiaUrl = "", tipoMidia = "imagem" } = {}, contexto = {}) {
    const sock = getSock();
    if (!sock || !whatsappConectado) {
        throw new Error("WhatsApp não conectado.");
    }

    const jid = await resolverJidDestino(sock, destino);

    try {
        if (midiaUrl) {
            const buffer = await carregarBufferMidia({ caminho: midiaUrl, urlPublica: midiaUrl });
            const payloadMidia = tipoMidia === "video"
                ? { video: buffer, caption: texto || undefined }
                : { image: buffer, caption: texto || undefined };
            await sock.sendMessage(jid, payloadMidia);
        } else {
            await sock.sendMessage(jid, { text: texto });
        }

        registrarHistorico({
            data: new Date().toISOString(),
            horario: contexto.horario || null,
            origem: contexto.origem || "webhook",
            grupo: contexto.nomeDestino || String(destino),
            sucesso: true,
            erro: null
        });

        return { ok: true, jid };
    } catch (err) {
        registrarHistorico({
            data: new Date().toISOString(),
            horario: contexto.horario || null,
            origem: contexto.origem || "webhook",
            grupo: contexto.nomeDestino || String(destino),
            sucesso: false,
            erro: err.message
        });
        throw err;
    }
}
