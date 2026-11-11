// Regras de recorrência dos agendamentos.
//
// Cada agendamento pode ter:
//   intervaloDias : 1 = todo dia (padrão) | 2 = dia sim / dia não | 3 = a cada 3 dias ...
//   dataInicio    : "AAAA-MM-DD" = dia do 1º envio (âncora do ciclo)
//
// A conta é feita a partir da data de início (e não do "último envio"),
// então reiniciar o programa ou falhar um dia não bagunça o ciclo.

export const INTERVALO_MAXIMO = 365;

function diasDesdeEpoch(ano, mes, dia) {
    // Date.UTC evita problema de horário de verão na subtração de datas.
    return Math.floor(Date.UTC(ano, mes - 1, dia) / 86400000);
}

export function dataLocalISO(data = new Date()) {
    const a = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, "0");
    const d = String(data.getDate()).padStart(2, "0");
    return `${a}-${m}-${d}`;
}

function partesISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    return { ano: +m[1], mes: +m[2], dia: +m[3] };
}

export function normalizarIntervalo(valor) {
    const n = Math.floor(Number(valor));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, INTERVALO_MAXIMO);
}

// true se o agendamento deve disparar no dia informado (padrão: hoje)
export function deveEnviarNoDia(agendamento, dia = new Date()) {
    const intervalo = normalizarIntervalo(agendamento.intervaloDias);
    if (intervalo === 1) return true;

    const inicio = partesISO(agendamento.dataInicio);
    if (!inicio) return true; // sem data de início válida: cai no comportamento "todo dia"

    const hoje = partesISO(dataLocalISO(dia));
    const diff = diasDesdeEpoch(hoje.ano, hoje.mes, hoje.dia) - diasDesdeEpoch(inicio.ano, inicio.mes, inicio.dia);

    return diff >= 0 && diff % intervalo === 0;
}

// Próxima data (AAAA-MM-DD) em que o agendamento deve disparar, a partir de hoje.
// Se hoje é dia de envio e o horário ainda não passou, retorna hoje.
export function proximoEnvio(agendamento, agora = new Date()) {
    const intervalo = normalizarIntervalo(agendamento.intervaloDias);
    const [hh, mm] = String(agendamento.horario || "00:00").split(":").map(Number);
    const jaPassouHoje = agora.getHours() > hh || (agora.getHours() === hh && agora.getMinutes() > mm);

    for (let i = 0; i <= intervalo + 1; i++) {
        if (i === 0 && jaPassouHoje) continue;
        const candidato = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
        if (deveEnviarNoDia(agendamento, candidato)) return dataLocalISO(candidato);
    }
    return null;
}

export function descreverRecorrencia(agendamento) {
    const n = normalizarIntervalo(agendamento.intervaloDias);
    if (n === 1) return "todo dia";
    if (n === 2) return "dia sim, dia não";
    return `a cada ${n} dias`;
}
