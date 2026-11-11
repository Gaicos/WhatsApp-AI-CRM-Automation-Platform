// Controle do próprio programa. Não precisa de PM2 nem de terminal.
// O "Iniciar Painel.bat" sobe o programa de novo quando ele sai com o código 42 (pedido de reinício).
export const CODIGO_REINICIO = 42;   // reiniciar o programa
export const CODIGO_ATUALIZACAO = 43; // atualizar a biblioteca do WhatsApp antes de subir de novo

export function sairComCodigo(codigo) {
    setTimeout(() => process.exit(codigo), 800);
}

export function reiniciarProcesso() {
    setTimeout(() => process.exit(CODIGO_REINICIO), 800);
}

export function encerrarProcesso() {
    setTimeout(() => process.exit(0), 800);
}

export function statusProcesso() {
    const uptimeMs = process.uptime() * 1000;
    const cpu = process.cpuUsage();
    const cpuPct = uptimeMs > 0 ? ((cpu.user + cpu.system) / 1000 / uptimeMs) * 100 : 0;
    return {
        status: "online",
        uptimeMs,
        memoria: process.memoryUsage().rss,
        cpu: Number(cpuPct.toFixed(1)),
    };
}
