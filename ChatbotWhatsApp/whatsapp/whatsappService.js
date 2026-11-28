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
import {
    obterTenantAtual,
    normalizarTenantId,
    executarNoTenant,
    prefixoAuthWhatsappTenant,
    pastaAuthLocalTenant
} from "../services/tenantContext.js";

const sessoesWhatsapp = new Map();

function obterEstado(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    let st = sessoesWhatsapp.get(tid);
    if (!st) {
        st = {
            tenantId: tid,
            sockAtual: null,
            conectando: false,
            ultimoSalvamentoCreds: Promise.resolve(),
            desligadoManualmente: false,
            sessaoInvalida: false,
            whatsappConectado: false,
            qrAtual: null,
            tentativasFalhas: 0,
            geracaoAtual: 0,
            gruposRecebidos: new Map(),
            buscandoGruposPromise: null,
            credenciaisAtuais: null,
            erroConexao: null
        };
        sessoesWhatsapp.set(tid, st);
    }
    return st;
}

function mesclarGruposNoEstado(st, origem) {
    if (!origem) return;
    const itens = Array.isArray(origem) ? origem : Object.values(origem);
    for (const g of itens) {
        if (g?.id) {
            st.gruposRecebidos.set(g.id, {
                subject: g.subject || st.gruposRecebidos.get(g.id)?.subject || g.id,
                announce: !!g.announce,
                isCommunity: !!g.isCommunity
            });
        }
    }
}

function deveUsarAuthSupabase(pastaLocal) {
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
    return Boolean(process.env.SUPABASE_URL) && !fs.existsSync(`${pastaLocal}/creds.json`);
}

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
        return resultado.version;
    } catch (err) {
        console.log("Não consegui buscar a versão atual do WhatsApp:", err.message);
        return undefined;
    }
}

const MAX_TENTATIVAS = 8;

function esperaEntreTentativas(tentativasFalhas) {
    // 5s, 10s, 20s, 40s... até 5 minutos. Evita martelar o WhatsApp.
    return Math.min(5000 * 2 ** (tentativasFalhas - 1), 5 * 60 * 1000);
}

// Conexão com o WhatsApp isolada por tenantId
export async function conectarWhatsApp(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);

    if (st.conectando) {
        return st.sockAtual;
    }

    st.conectando = true;
    st.desligadoManualmente = false;
    st.sessaoInvalida = false;
    st.whatsappConectado = false;
    st.qrAtual = null;

    let sock;
    let pastaLocal = pastaAuthLocalTenant(tid);
    const prefixo = prefixoAuthWhatsappTenant(tid);
    let usandoSupabaseAuth = false;

    try {
        if (st.sockAtual) {
            try { st.sockAtual.end(new Error("Reconectando sessão")); } catch {}
            st.sockAtual = null;
        }

        usandoSupabaseAuth = deveUsarAuthSupabase(pastaLocal);

        let state;
        let saveCreds;
        if (usandoSupabaseAuth) {
            const authNuvem = await useSupabaseAuthState(null, prefixo);
            state = authNuvem.state;
            saveCreds = authNuvem.saveCreds;
            console.log(`☁️ [${tid}] Usando sessão do WhatsApp 100% na nuvem (Supabase).`);
        } else {
            await restaurarAuthWhatsappDoSupabase(pastaLocal, prefixo);
            const authLocal = await useMultiFileAuthState(pastaLocal);
            state = authLocal.state;
            saveCreds = authLocal.saveCreds;
        }

        st.credenciaisAtuais = state.creds;
        const minhaGeracao = ++st.geracaoAtual;

        const versao = await obterVersaoWhatsapp();
        const browserConfig = baileysLib.Browsers?.ubuntu?.("Chrome") || ["Ubuntu", "Chrome", "22.04.4"];
        sock = makeWASocket({
            auth: state,
            ...(versao ? { version: versao } : {}),
            browser: browserConfig,
            logger: loggerBaileys,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });
        st.sockAtual = sock;

        sock.ev.on("creds.update", () => {
            const tarefa = executarNoTenant(tid, async () => {
                await saveCreds();
                if (!usandoSupabaseAuth) {
                    await salvarCredsWhatsappNoSupabase(pastaLocal, prefixo);
                }
            }).catch(() => {});
            st.ultimoSalvamentoCreds = tarefa;
            return tarefa;
        });

        // Grupos chegam aos poucos durante a sincronização; guarda os que forem recebidos.
        const registrarGrupos = (lista) => {
            mesclarGruposNoEstado(st, lista);
        };
        sock.ev.on("groups.upsert", registrarGrupos);
        sock.ev.on("groups.update", registrarGrupos);

        sock.ev.on("connection.update", (update) => executarNoTenant(tid, async () => {
            if (minhaGeracao !== st.geracaoAtual) return;
            const { connection, qr, lastDisconnect } = update;

            if (qr) {
                if (tid === "admin") qrcodeTerminal.generate(qr, { small: true });
                try {
                    st.qrAtual = await QRCode.toDataURL(qr, {
                        width: 360,
                        margin: 3,
                        errorCorrectionLevel: "M",
                        color: { dark: "#000000", light: "#ffffff" }
                    });
                } catch (err) {
                    console.log(`[${tid}] Erro ao gerar imagem do QR Code:`, err.message);
                }
            }

            if (connection === "open") {
                st.whatsappConectado = true;
                st.qrAtual = null;
                st.sessaoInvalida = false;
                st.tentativasFalhas = 0;
                st.erroConexao = null;
                if (!usandoSupabaseAuth) {
                    salvarCredsWhatsappNoSupabase(pastaLocal, prefixo);
                }
                console.log(`✅ [${tid}] WhatsApp conectado e pronto para enviar mensagens.`);
                setTimeout(() => {
                    if (st.whatsappConectado) {
                        buscarGruposWhatsapp(tid).catch(() => {});
                    }
                }, 1500);
            }

            if (connection === "close") {
                st.whatsappConectado = false;
                st.qrAtual = null;
                st.sockAtual = null;

                if (st.desligadoManualmente) {
                    console.log(`🔌 [${tid}] Bot desligado manualmente — não vai reconectar sozinho.`);
                    return;
                }

                const statusCode = lastDisconnect?.error?.output?.statusCode;

                // Código 515 (restartRequired) faz parte do handshake normal após ler o QR Code
                if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                    console.log(`🔄 [${tid}] Reinício de pareamento solicitado pelo WhatsApp (515). Aguardando gravação de credenciais...`);
                    await st.ultimoSalvamentoCreds.catch(() => {});
                    setTimeout(() => {
                        conectarWhatsApp(tid).catch(err => console.log(`[${tid}] Erro ao reconectar após 515:`, err.message));
                    }, 500);
                    return;
                }

                const deveReconectar = statusCode !== DisconnectReason.loggedOut;

                console.log(`❌ [${tid}] Conexão encerrada (código ${statusCode}).`);

                if (statusCode === 440) {
                    st.erroConexao = "Outro aparelho/instância assumiu esta conta do WhatsApp. Feche o outro e clique em Ligar.";
                    console.log(`⛔ [${tid}] Conflito 440 no WhatsApp. Não vou reconectar automaticamente.`);
                    return;
                }

                if (deveReconectar) {
                    st.tentativasFalhas++;
                    const pareando = !st.credenciaisAtuais?.registered;

                    if (statusCode === 405) {
                        st.erroConexao = "O WhatsApp recusou a conexão (código 405).";
                    } else if (pareando) {
                        st.erroConexao = null;
                    } else {
                        st.erroConexao = `Não foi possível conectar (código ${statusCode}).`;
                    }

                    if (!pareando && st.tentativasFalhas >= MAX_TENTATIVAS) {
                        console.log(`⛔ [${tid}] Muitas tentativas sem sucesso. Use o botão Ligar ou Gerar novo QR Code.`);
                        return;
                    }
                    const espera = pareando
                        ? Math.min(2000 * st.tentativasFalhas, 15000)
                        : esperaEntreTentativas(st.tentativasFalhas);
                    console.log(`[${tid}] ${pareando ? "Gerando novo QR Code" : "Nova tentativa"} em ${espera / 1000}s...`);
                    setTimeout(() => {
                        conectarWhatsApp(tid).catch(err => console.log(`[${tid}] Erro ao reconectar:`, err.message));
                    }, espera);
                } else {
                    st.sessaoInvalida = true;
                    fs.rmSync(pastaLocal, { recursive: true, force: true });
                    await limparAuthWhatsappNoSupabase(prefixo);
                    console.log(`⚠️ [${tid}] Sessão encerrada pelo WhatsApp. Credenciais removidas; gerando novo QR Code...`);
                    setTimeout(() => {
                        conectarWhatsApp(tid).catch(err => console.log(`[${tid}] Erro ao regenerar QR:`, err.message));
                    }, 1000);
                }
            }
        }));

        sock.ev.on("messages.upsert", ({ messages, type }) => executarNoTenant(tid, async () => {
            if (type && type !== "notify") return;
            for (const msg of messages) {
                await processarComando(sock, msg, tid);
            }
        }));

        return sock;
    } finally {
        st.conectando = false;
    }
}

/**
 * Alternativa sem câmera ao QR Code: gera código de pareamento de 8 dígitos para o celular.
 */
export async function solicitarCodigoPareamento(telefone, tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);

    if (st.whatsappConectado) {
        throw new Error("Este WhatsApp já está conectado.");
    }

    let digits = String(telefone || "").replace(/\D/g, "");
    if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) {
        digits = digits.slice(1);
    }
    if (digits.length === 10 || digits.length === 11) {
        digits = `55${digits}`;
    }
    if (digits.length < 10 || digits.length > 15) {
        throw new Error("Informe um número válido com DDD (ex: 5511999999999).");
    }

    if (st.sockAtual) {
        try { st.sockAtual.end(new Error("Solicitando código de pareamento")); } catch {}
        st.sockAtual = null;
    }
    fs.rmSync(pastaAuthLocalTenant(tid), { recursive: true, force: true });
    await limparAuthWhatsappNoSupabase(prefixoAuthWhatsappTenant(tid));

    const sock = await conectarWhatsApp(tid);
    if (!sock || typeof sock.requestPairingCode !== "function") {
        throw new Error("Não foi possível inicializar o pareamento por código neste momento.");
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    const bruto = await sock.requestPairingCode(digits);
    const limpo = String(bruto || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const formatado = limpo.length === 8 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
    return { ok: true, codigo: formatado, telefone: digits };
}

export function getQrAtual(tenantId = obterTenantAtual()) {
    return obterEstado(tenantId).qrAtual;
}

// Processamento dos comandos recebidos dentro do tenant correspondente
async function processarComando(sock, msg, tenantId = obterTenantAtual()) {
    if (!msg.message) return;

    try {
        const respondeuTriagem = await processarTriagem(sock, msg);
        if (respondeuTriagem) return;
    } catch (err) {
        console.log(`[${tenantId}] Erro ao processar triagem automática:`, err.message);
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
            const conexao = statusConexao(tenantId);

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

        } else if (comando === "!restart" && normalizarTenantId(tenantId) === "admin") {
            await sock.sendMessage(destino, {
                text: "🔄 Reiniciando o servidor... aguarde alguns segundos."
            });
            reiniciarProcesso();

        } else if (comando === "!ajuda" || comando === "!help") {
            await sock.sendMessage(destino, { text: textoAjuda() });
        }
    } catch (err) {
        console.log(`[${tenantId}] Erro ao processar comando:`, err.message);
    }
}

export function getSock(tenantId = obterTenantAtual()) {
    return obterEstado(tenantId).sockAtual;
}

export function getGruposRecebidos(tenantId = obterTenantAtual()) {
    return Object.fromEntries(obterEstado(tenantId).gruposRecebidos);
}

export async function buscarGruposWhatsapp(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);
    const sock = st.sockAtual;

    if (sock && st.whatsappConectado && typeof sock.groupFetchAllParticipating === "function") {
        if (!st.buscandoGruposPromise) {
            st.buscandoGruposPromise = (async () => {
                try {
                    const mapa = await Promise.race([
                        sock.groupFetchAllParticipating(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Tempo esgotado ao buscar grupos.")), 20000))
                    ]);
                    mesclarGruposNoEstado(st, mapa);
                } catch (err) {
                    console.log(`⚠️ [${tid}] Erro ao buscar grupos participantes:`, err?.message || err);
                } finally {
                    st.buscandoGruposPromise = null;
                }
            })();
        }
        await st.buscandoGruposPromise;
    }

    return Object.fromEntries(st.gruposRecebidos);
}

export async function gerarNovoQr(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);
    st.tentativasFalhas = 0;
    st.erroConexao = null;
    st.desligadoManualmente = false;
    if (st.sockAtual) {
        try { st.sockAtual.end(new Error("Novo QR Code solicitado")); } catch {}
        st.sockAtual = null;
    }
    st.whatsappConectado = false;
    st.qrAtual = null;
    if (!st.credenciaisAtuais?.registered) {
        fs.rmSync(pastaAuthLocalTenant(tid), { recursive: true, force: true });
        await limparAuthWhatsappNoSupabase(prefixoAuthWhatsappTenant(tid));
    }
    await conectarWhatsApp(tid);
}

export async function sairDoWhatsapp(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);
    st.desligadoManualmente = true;
    const sock = st.sockAtual;
    if (sock) {
        try { await sock.logout(); } catch (err) { console.log(`[${tid}] Aviso ao sair do WhatsApp:`, err.message); }
    }
    st.sockAtual = null;
    st.whatsappConectado = false;
    st.qrAtual = null;
    st.gruposRecebidos.clear();
    fs.rmSync(pastaAuthLocalTenant(tid), { recursive: true, force: true });
    await limparAuthWhatsappNoSupabase(prefixoAuthWhatsappTenant(tid));
}

export function desligarBot(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);
    st.desligadoManualmente = true;
    st.whatsappConectado = false;
    st.qrAtual = null;

    if (st.sockAtual) {
        try {
            st.sockAtual.end(new Error("Desligado manualmente pelo painel"));
        } catch {}

        st.sockAtual = null;
        console.log(`🔌 [${tid}] Bot desligado manualmente pelo painel.`);
    }
}

export async function ligarBot(tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const st = obterEstado(tid);
    if (st.sockAtual) return;
    st.tentativasFalhas = 0;
    st.erroConexao = null;

    console.log(`🔌 [${tid}] Ligando o bot...`);
    await conectarWhatsApp(tid);
}

export function statusConexao(tenantId = obterTenantAtual()) {
    const st = obterEstado(tenantId);
    return {
        conectado: st.whatsappConectado,
        desligadoManualmente: st.desligadoManualmente,
        sessaoInvalida: st.sessaoInvalida,
        erroConexao: st.erroConexao
    };
}

export function listarStatusSessoesWhatsapp() {
    const mapa = {};
    for (const [tid, st] of sessoesWhatsapp.entries()) {
        mapa[tid] = {
            conectado: !!st.whatsappConectado,
            erroConexao: st.erroConexao || null
        };
    }
    return mapa;
}

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

// Envio para vários grupos e contatos de um tenant
export async function enviarMensagemGrupos(grupos, mensagem, contexto = {}, tenantId = obterTenantAtual()) {
    const tid = normalizarTenantId(tenantId);
    const resultado = { enviados: 0, falhas: 0 };

    return executarNoTenant(tid, async () => {
        for (const grupo of grupos) {
            const st = obterEstado(tid);
            const sock = st.sockAtual;
            const nomeDestino = grupo.nome || grupo.id || "destino";

            if (!sock || !st.whatsappConectado) {
                console.log(`⚠️ [${tid}] WhatsApp não conectado, abortando envios.`);

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

                console.log(`[${tid}] [${new Date().toLocaleTimeString()}] ✅ Enviado para: ${grupo.nome}`);

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
                console.log(`[${tid}] [${new Date().toLocaleTimeString()}] ❌ Falhou em: ${grupo.nome} — ${err.message}`);

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

        console.log(`🏁 [${tid}] Envio para todos os destinos concluído.`);
        return resultado;
    });
}

/**
 * Envia uma mensagem direta (texto ou mídia por URL pública) para um número ou JID de grupo.
 * Usada pelo Webhook de integração com o site e alertas no Grupo de Controle.
 */
export async function enviarMensagemDireta(
    destino,
    { texto = "", midiaUrl = "", tipoMidia = "imagem" } = {},
    contexto = {},
    tenantId = obterTenantAtual()
) {
    const tid = normalizarTenantId(tenantId);
    return executarNoTenant(tid, async () => {
        const st = obterEstado(tid);
        const sock = st.sockAtual;
        if (!sock || !st.whatsappConectado) {
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
    });
}
