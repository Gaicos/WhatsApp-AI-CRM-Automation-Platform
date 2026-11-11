import { lerGrupos, lerContatos, lerListasContatos } from "./configService.js";

// Junta grupos + contatos individuais + contatos vindos de listas,
// removendo duplicatas (ex: o mesmo contato numa lista E marcado direto).
export function resolverDestinos(agendamento) {
    const grupos = lerGrupos().filter(
        g => g.ativo && (agendamento.grupos || []).includes(g.id)
    );

    const contatos = lerContatos();

    const contatosDiretos = contatos.filter(
        c => c.ativo && (agendamento.contatos || []).includes(c.id)
    );

    const listas = lerListasContatos().filter(
        l => (agendamento.listas || []).includes(l.id)
    );
    const idsContatosDeListas = listas.flatMap(l => l.contatos || []);
    const contatosDeListas = contatos.filter(
        c => c.ativo && idsContatosDeListas.includes(c.id)
    );

    const todosContatos = [...contatosDiretos, ...contatosDeListas];
    const contatosUnicos = Array.from(new Map(todosContatos.map(c => [c.id, c])).values());

    return [...grupos, ...contatosUnicos];
}