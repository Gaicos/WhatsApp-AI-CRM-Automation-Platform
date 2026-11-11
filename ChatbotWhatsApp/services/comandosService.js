import { lerHistorico, lerAgendamentos } from "./configService.js";

export function textoHistorico() {
    const historico = lerHistorico();
    if (historico.length === 0) return "Nenhum envio registrado ainda.";

    const ultimos = historico.slice(0, 10);
    let texto = "📜 Últimos envios:\n\n";
    ultimos.forEach(item => {
        const data = new Date(item.data).toLocaleString("pt-BR");
        const status = item.sucesso ? "✅" : "❌";
        texto += `${status} ${data} — ${item.grupo}`;
        if (!item.sucesso) texto += ` (${item.erro})`;
        texto += "\n";
    });
    return texto;
}

export function textoAgendamentos() {
    const agendamentos = lerAgendamentos();
    if (agendamentos.length === 0) return "Nenhum agendamento cadastrado.";

    let texto = "📅 Agendamentos:\n\n";
    agendamentos.forEach(a => {
        texto += `${a.ativo ? "✅" : "❌"} ${a.horario} — ${a.grupos.length} grupo(s), ${a.midias.length} mídia(s)\n`;
    });
    return texto;
}

export function textoAjuda() {
    return "🤖 Comandos disponíveis:\n\n!status — status da conexão e do processo\n!historico — últimos envios\n!agendamentos — lista de agendamentos\n!restart — reinicia o processo (pm2 restart)\n!ajuda — essa lista";
}