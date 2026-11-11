import { lerAgendamentos, lerEnvios, salvarEnvios } from "../services/configService.js";
import { getSock } from "../whatsapp/whatsappService.js";
import { deveEnviarNoDia } from "../services/recorrenciaService.js";

export function iniciarScheduler(enviarFn) {
    let ultimoEnvio = lerEnvios();

    console.log("📅 Agendamentos monitorados e prontos para envio.");

    async function verificar() {
        try {
            if (!getSock()) return; // bot desligado/desconectado: espera reconectar

            const agendamentos = lerAgendamentos();
            const agora = new Date();
            const horaAtual = agora.toTimeString().slice(0, 5);
            const hoje = agora.toDateString();

            for (const agendamento of agendamentos) {
                if (!agendamento.ativo) continue;

                const jaEnviouHoje = ultimoEnvio[agendamento.id] === hoje;
                const horarioBate = agendamento.horario === horaAtual;

                // deveEnviarNoDia cuida da recorrência (todo dia, dia sim/dia não, a cada N dias)
                if (horarioBate && !jaEnviouHoje && deveEnviarNoDia(agendamento, agora)) {
                    ultimoEnvio[agendamento.id] = hoje;
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
