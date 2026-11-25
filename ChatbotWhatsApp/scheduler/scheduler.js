import { lerAgendamentos, lerEnvios, salvarEnvios } from "../services/configService.js";
import { getSock } from "../whatsapp/whatsappService.js";
import { deveEnviarNoDia } from "../services/recorrenciaService.js";

/**
 * Resolve hora atual, data ISO local e Date de referencia no fuso horario configurado,
 * garantindo que servidores em nuvem (UTC) disparem no horario correto do Brasil.
 */
export function obterDataHoraNoFuso(agora = new Date(), fuso = process.env.TZ || "America/Sao_Paulo") {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: fuso,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(agora);

    const mapa = {};
    for (const parte of partes) {
        if (parte.type !== "literal") mapa[parte.type] = parte.value;
    }

    const horaNormalizada = mapa.hour === "24" ? "00" : mapa.hour;
    const chaveDia = `${mapa.year}-${mapa.month}-${mapa.day}`;
    const horaAtual = `${horaNormalizada}:${mapa.minute}`;
    const dataReferencia = new Date(Number(mapa.year), Number(mapa.month) - 1, Number(mapa.day), 12, 0, 0);

    return { horaAtual, chaveDia, dataReferencia };
}

export function iniciarScheduler(enviarFn) {
    console.log("📅 Agendamentos monitorados e prontos para envio.");

    async function verificar() {
        try {
            if (!getSock()) return; // bot desligado/desconectado: espera reconectar

            const agendamentos = lerAgendamentos();
            const ultimoEnvio = lerEnvios();
            const agora = new Date();
            const { horaAtual, chaveDia, dataReferencia } = obterDataHoraNoFuso(agora);

            for (const agendamento of agendamentos) {
                if (!agendamento.ativo) continue;

                const jaEnviouHoje =
                    ultimoEnvio[agendamento.id] === chaveDia ||
                    ultimoEnvio[agendamento.id] === agora.toDateString();
                const horarioBate = agendamento.horario === horaAtual;

                // deveEnviarNoDia cuida da recorrência (todo dia, dia sim/dia não, a cada N dias)
                if (horarioBate && !jaEnviouHoje && deveEnviarNoDia(agendamento, dataReferencia)) {
                    ultimoEnvio[agendamento.id] = chaveDia;
                    salvarEnvios(ultimoEnvio);

                    await enviarFn(agendamento);
                }
            }
        } catch (err) {
            console.log("Erro no scheduler:", err.message);
        } finally {
            setTimeout(verificar, 20 * 1000);
        }
    }

    verificar();
}
