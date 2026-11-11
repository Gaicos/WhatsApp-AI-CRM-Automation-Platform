import assert from "node:assert/strict";
import { deveEnviarNoDia, proximoEnvio, normalizarIntervalo, descreverRecorrencia } from "../services/recorrenciaService.js";

const d = (s) => { const [a, m, dd] = s.split("-").map(Number); return new Date(a, m - 1, dd, 12, 0); };

// padrão: todo dia
assert.equal(deveEnviarNoDia({ horario: "12:00" }, d("2026-10-05")), true);

// dia sim, dia não a partir de 01/10
const a2 = { horario: "12:00", intervaloDias: 2, dataInicio: "2026-10-01" };
assert.deepEqual(["01","02","03","04","05","06"].map(x => deveEnviarNoDia(a2, d("2026-10-" + x))), [true,false,true,false,true,false]);

// a cada 3 dias
const a3 = { horario: "12:00", intervaloDias: 3, dataInicio: "2026-10-01" };
assert.deepEqual(["01","02","03","04","05","06","07"].map(x => deveEnviarNoDia(a3, d("2026-10-" + x))), [true,false,false,true,false,false,true]);

// antes do início: não envia
assert.equal(deveEnviarNoDia(a2, d("2026-09-29")), false);

// virada de mês e de ano
const am = { intervaloDias: 2, dataInicio: "2026-03-28" };
assert.equal(deveEnviarNoDia(am, d("2026-03-30")), true);
assert.equal(deveEnviarNoDia(am, d("2026-03-31")), false);
assert.equal(deveEnviarNoDia(am, d("2026-04-01")), true);
assert.equal(deveEnviarNoDia(am, d("2026-04-12")), false);
assert.equal(deveEnviarNoDia({ intervaloDias: 2, dataInicio: "2026-12-31" }, d("2027-01-02")), true);

// valores inválidos
assert.equal(normalizarIntervalo("abc"), 1);
assert.equal(normalizarIntervalo(0), 1);
assert.equal(normalizarIntervalo(-3), 1);
assert.equal(normalizarIntervalo(2.9), 2);
assert.equal(normalizarIntervalo(99999), 365);
assert.equal(deveEnviarNoDia({ intervaloDias: 3, dataInicio: "lixo" }, d("2026-10-02")), true);

// próximo envio
const agora = new Date(2026, 9, 2, 10, 0);
assert.equal(proximoEnvio({ horario: "12:00", intervaloDias: 2, dataInicio: "2026-10-01" }, agora), "2026-10-03");
assert.equal(proximoEnvio({ horario: "12:00", intervaloDias: 2, dataInicio: "2026-10-02" }, agora), "2026-10-02");
assert.equal(proximoEnvio({ horario: "09:00", intervaloDias: 2, dataInicio: "2026-10-02" }, agora), "2026-10-04");
assert.equal(descreverRecorrencia({ intervaloDias: 2 }), "dia sim, dia não");

// verificação cruzada com soma de dias (método independente)
for (const intervalo of [2, 3, 4, 7, 10]) {
    for (const inicio of ["2026-02-27", "2026-10-25", "2026-12-20"]) {
        const [a, m, dd] = inicio.split("-").map(Number);
        const esperado = new Set();
        for (let k = 0; k < 400; k++) esperado.add(new Date(a, m - 1, dd + k * intervalo, 12).toDateString());
        for (let i = 0; i < 800; i++) {
            const x = new Date(a, m - 1, dd + i, 12);
            assert.equal(
                deveEnviarNoDia({ intervaloDias: intervalo, dataInicio: inicio }, x),
                esperado.has(x.toDateString()),
                `intervalo ${intervalo}, início ${inicio}, +${i} dias`
            );
        }
    }
}
console.log("recorrenciaService: todos os testes passaram");
