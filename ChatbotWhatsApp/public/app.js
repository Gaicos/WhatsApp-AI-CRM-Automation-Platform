const fetchOriginal = window.fetch.bind(window);
window.fetch = async (...args) => {
    const resposta = await fetchOriginal(...args);
    if (resposta.status === 401 && !window.location.pathname.endsWith("login.html")) {
        window.location.href = "./login.html";
    }
    return resposta;
};

let grupos = [];
let contatos = [];
let listasContatos = [];
let agendamentos = [];
let envios = {};
let midiasFormularioAtual = [];
let gruposWhatsappCache = [];
let previewAtualId = null;
let intervaloStatus = null;
let gruposControleCache = [];
const cacheBusterMidia = {};


function mostrarToast(mensagem, tipo = "ok") {
    const toast = document.getElementById("toast");
    toast.textContent = mensagem;
    toast.className = tipo === "erro" ? "mostrar erro" : "mostrar";
    setTimeout(() => { toast.className = ""; }, 3000);
}

function caminhoParaUrl(caminho) {
    if (!caminho) return "";
    if (/^https?:\/\//i.test(caminho)) return caminho;
    const base = caminho.replace("./midia/", "/midia/");
    const versao = cacheBusterMidia[caminho];
    return versao ? `${base}?v=${versao}` : base;
}

async function carregarTudo() {
    grupos = await fetch("/api/grupos").then(r => r.json());
    contatos = await fetch("/api/contatos").then(r => r.json());
    listasContatos = await fetch("/api/listas-contatos").then(r => r.json());
    agendamentos = await fetch("/api/agendamentos").then(r => r.json());
    envios = await fetch("/api/envios").then(r => r.json());

    renderizarGrupos();
    renderizarContatos();
    renderizarListasContatos();
    renderizarAgendamentos();
    renderizarCheckboxGrupos();
    renderizarCheckboxContatos();
    renderizarCheckboxListas();
    carregarGrupoControleAtual();
}

// ================= ABAS =================

document.querySelectorAll(".aba-botao").forEach(botao => {
    botao.addEventListener("click", () => {
        document.querySelectorAll(".aba-botao").forEach(b => b.classList.remove("ativa"));
        botao.classList.add("ativa");

        const aba = botao.dataset.aba;
        document.getElementById("abaAgendamentos").classList.toggle("oculto", aba !== "agendamentos");
        document.getElementById("abaTriagem").classList.toggle("oculto", aba !== "triagem");
        document.getElementById("abaWebhooks")?.classList.toggle("oculto", aba !== "webhooks");
        document.getElementById("abaStatus").classList.toggle("oculto", aba !== "status");
        document.getElementById("abaAdmin")?.classList.toggle("oculto", aba !== "admin");

        if (aba === "webhooks") {
            window.carregarPainelWebhooks?.();
        }

        if (aba === "admin") {
            window.carregarPainelAdmin?.();
        }

        if (aba === "status") {
            atualizarStatus();
            carregarHistorico();
            if (!intervaloStatus) {
                intervaloStatus = setInterval(() => {
                    atualizarStatus();
                    carregarHistorico();
                }, 5000);
            }
        } else {
            clearInterval(intervaloStatus);
            intervaloStatus = null;
        }
    });
});

// ================= STATUS DO BOT =================

async function atualizarStatus() {
    const dados = await fetch("/api/bot/status").then(r => r.json());

    document.getElementById("statusConexaoTexto").textContent =
        dados.conexaoWhatsapp.conectado ? "✅ conectado" : "🔌 desconectado";

    const div = document.getElementById("infoPm2");
    if (dados.processo) {
        const horas = (dados.processo.uptimeMs / 3600000).toFixed(1);
        const memMb = (dados.processo.memoria / 1024 / 1024).toFixed(1);
        div.innerHTML = `
            <div class="info-pm2-item"><strong>${dados.processo.status}</strong><span>situação</span></div>
            <div class="info-pm2-item"><strong>${horas}h</strong><span>no ar</span></div>
            <div class="info-pm2-item"><strong>${memMb} MB</strong><span>memória</span></div>
            <div class="info-pm2-item"><strong>${dados.processo.cpu}%</strong><span>cpu</span></div>
        `;
    } else {
        div.innerHTML = `<p style="color:#999">Informações do programa indisponíveis.</p>`;
    }
}

document.getElementById("btnLigarBot").addEventListener("click", async () => {
    await fetch("/api/bot/ligar", { method: "POST" });
    mostrarToast("Ligando o bot...");
    setTimeout(atualizarStatus, 2000);
});

document.getElementById("btnDesligarBot").addEventListener("click", async () => {
    if (!confirm("Desligar o bot agora?")) return;
    await fetch("/api/bot/desligar", { method: "POST" });
    mostrarToast("Bot desligado");
    setTimeout(atualizarStatus, 1000);
});

document.getElementById("btnReiniciarBot").addEventListener("click", async () => {
    if (!confirm("Reiniciar o servidor na nuvem? Leva alguns segundos.")) return;
    fetch("/api/bot/reiniciar", { method: "POST" }).catch(() => {});
    mostrarToast("Servidor reiniciando. Recarregue a página em alguns segundos.");
    await new Promise(r => setTimeout(r, 4000));
    for (let i = 0; i < 30; i++) {
        try {
            const resposta = await fetch("/api/sessao");
            if (resposta.ok) { location.reload(); return; }
        } catch { /* ainda reiniciando */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    mostrarToast("Servidor reiniciando. Recarregue a página em alguns segundos.", "erro");
});

document.getElementById("btnNovoQrPainel").addEventListener("click", () => {
    if (!confirm("Abrir tela de conexão / QR Code?")) return;
    window.location.href = "./conectar.html";
});

async function carregarHistorico() {
    const historico = await fetch("/api/historico").then(r => r.json());
    const corpo = document.getElementById("corpoHistorico");
    corpo.innerHTML = "";

    if (historico.length === 0) {
        corpo.innerHTML = `<tr><td colspan="6">Nenhum envio registrado ainda.</td></tr>`;
        return;
    }

    historico.slice(0, 50).forEach(item => {
        const dataFormatada = new Date(item.data).toLocaleString("pt-BR");
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${dataFormatada}</td>
            <td>${item.horario || "-"}</td>
            <td>${item.grupo}</td>
            <td>${item.origem}</td>
            <td class="${item.sucesso ? "status-sucesso" : "status-erro"}">${item.sucesso ? "✅ enviado" : "❌ falhou"}</td>
            <td>${item.erro || "-"}</td>
        `;
        corpo.appendChild(linha);
    });
}

// ================= CONTROLE REMOTO =================

async function carregarGrupoControleAtual() {
    const config = await fetch("/api/config").then(r => r.json());
    const nome = config.grupoControleId
        ? (grupos.find(g => g.id === config.grupoControleId)?.nome || config.grupoControleId)
        : "nenhum configurado ainda";
    document.getElementById("grupoControleAtual").textContent = `Grupo atual: ${nome}`;
}

document.getElementById("btnCarregarGruposControle").addEventListener("click", async () => {
    const select = document.getElementById("selectGrupoControle");
    select.innerHTML = "<option>Carregando...</option>";

    gruposControleCache = await fetch("/api/grupos-whatsapp").then(r => r.json());
    select.innerHTML = gruposControleCache.map(g => `<option value="${g.id}">${g.nome}</option>`).join("");
});

document.getElementById("btnSalvarGrupoControle").addEventListener("click", async () => {
    const select = document.getElementById("selectGrupoControle");
    if (!select.value) {
        mostrarToast("Carregue e escolha um grupo primeiro", "erro");
        return;
    }

    await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupoControleId: select.value }),
    });

    mostrarToast("Grupo de controle salvo ✅");
    carregarGrupoControleAtual();
});

// ================= GRUPOS =================

function renderizarGrupos() {
    const filtro = document.getElementById("filtroGrupos").value.toLowerCase();
    const corpo = document.getElementById("corpoTabelaGrupos");
    corpo.innerHTML = "";

    grupos.filter(g => g.nome.toLowerCase().includes(filtro)).forEach((grupo) => {
        const index = grupos.indexOf(grupo);
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${grupo.nome}</td>
            <td>${grupo.ativo ? "✅" : "❌"}</td>
            <td>
                <button onclick="alternarAtivoGrupo(${index})">${grupo.ativo ? "Desativar" : "Ativar"}</button>
                <button class="botao-perigo" onclick="removerGrupo(${index})">Remover</button>
            </td>
        `;
        corpo.appendChild(linha);
    });

    const ativos = grupos.filter(g => g.ativo).length;
    document.getElementById("contadorGrupos").textContent = `${ativos} de ${grupos.length} ativos`;
}

document.getElementById("filtroGrupos").addEventListener("input", renderizarGrupos);

document.getElementById("btnAtivarTodos").addEventListener("click", () => {
    grupos.forEach(g => g.ativo = true);
    salvarGrupos();
    renderizarGrupos();
    mostrarToast("Todos os grupos ativados");
});

document.getElementById("btnDesativarTodos").addEventListener("click", () => {
    if (!confirm("Desativar TODOS os grupos?")) return;
    grupos.forEach(g => g.ativo = false);
    salvarGrupos();
    renderizarGrupos();
    mostrarToast("Todos os grupos desativados");
});

async function salvarGrupos() {
    await fetch("/api/grupos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grupos),
    });
}

function alternarAtivoGrupo(index) {
    grupos[index].ativo = !grupos[index].ativo;
    salvarGrupos();
    renderizarGrupos();
}

function removerGrupo(index) {
    if (!confirm(`Remover "${grupos[index].nome}" da lista?`)) return;
    grupos.splice(index, 1);
    salvarGrupos();
    renderizarGrupos();
    renderizarCheckboxGrupos(pegarMarcados("checkboxGrupos"));
}

document.getElementById("btnBuscarGruposWhatsapp").addEventListener("click", async () => {
    const filtroNovos = document.getElementById("filtroGruposNovos");
    document.getElementById("listaGruposWhatsapp").innerHTML = "Buscando...";

    gruposWhatsappCache = await fetch("/api/grupos-whatsapp").then(r => r.json());
    filtroNovos.style.display = "block";
    filtroNovos.value = "";
    renderizarGruposNovos();
});

document.getElementById("filtroGruposNovos").addEventListener("input", renderizarGruposNovos);

function renderizarGruposNovos() {
    const div = document.getElementById("listaGruposWhatsapp");
    const filtro = document.getElementById("filtroGruposNovos").value.toLowerCase();
    const idsJaAdicionados = grupos.map(g => g.id);
    const novos = gruposWhatsappCache.filter(
        g => !idsJaAdicionados.includes(g.id) && g.nome.toLowerCase().includes(filtro)
    );

    if (novos.length === 0) {
        div.innerHTML = gruposWhatsappCache.length === 0
            ? "<p>Nenhum grupo encontrado ainda. Logo após conectar, o WhatsApp leva alguns minutos para enviar os grupos. Aguarde e clique em Buscar grupos de novo.</p>"
            : "<p>Nenhum grupo novo encontrado com esse filtro.</p>";
        return;
    }

    div.innerHTML = "";
    novos.forEach(g => {
        const span = document.createElement("span");
        span.className = "tag-grupo";
        span.textContent = `➕ ${g.nome}`;
        span.onclick = () => adicionarGrupo(g);
        div.appendChild(span);
    });
}

function adicionarGrupo(grupo) {
    grupos.push({ id: grupo.id, nome: grupo.nome, ativo: true });
    salvarGrupos();
    renderizarGrupos();
    renderizarCheckboxGrupos(pegarMarcados("checkboxGrupos"));
    renderizarGruposNovos();
    mostrarToast(`"${grupo.nome}" adicionado`);
}

// ================= CONTATOS =================

function renderizarContatos() {
    const filtro = document.getElementById("filtroContatos").value.toLowerCase();
    const corpo = document.getElementById("corpoTabelaContatos");
    corpo.innerHTML = "";

    contatos.filter(c => c.nome.toLowerCase().includes(filtro)).forEach((contato) => {
        const index = contatos.indexOf(contato);
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${contato.nome}</td>
            <td>${contato.telefone}</td>
            <td>${contato.ativo ? "✅" : "❌"}</td>
            <td>
                <button onclick="alternarAtivoContato(${index})">${contato.ativo ? "Desativar" : "Ativar"}</button>
                <button class="botao-perigo" onclick="removerContato(${index})">Remover</button>
            </td>
        `;
        corpo.appendChild(linha);
    });

    document.getElementById("contadorContatos").textContent = `${contatos.length} contato(s)`;
}

document.getElementById("filtroContatos").addEventListener("input", renderizarContatos);

async function salvarContatosArray() {
    await fetch("/api/contatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contatos),
    });
}

function alternarAtivoContato(index) {
    contatos[index].ativo = !contatos[index].ativo;
    salvarContatosArray();
    renderizarContatos();
}

function removerContato(index) {
    if (!confirm(`Remover "${contatos[index].nome}" da lista de contatos?`)) return;
    contatos.splice(index, 1);
    salvarContatosArray();
    renderizarContatos();
    renderizarCheckboxContatos(pegarMarcados("checkboxContatos"));
}

document.getElementById("btnAdicionarContato").addEventListener("click", async () => {
    const nome = document.getElementById("novoContatoNome").value.trim();
    const telefone = document.getElementById("novoContatoTelefone").value.trim();

    if (!nome || !telefone) {
        mostrarToast("Preencha nome e telefone", "erro");
        return;
    }

    const resposta = await fetch("/api/contatos/adicionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, telefone }),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
        mostrarToast(resultado.erro || "Erro ao adicionar contato", "erro");
        return;
    }

    const novoContato = resultado.contato || resultado;
    if (novoContato && novoContato.id) {
        contatos.unshift(novoContato);
    }
    renderizarContatos();
    renderizarCheckboxContatos(pegarMarcados("checkboxContatos"));
    renderizarCheckboxContatosLista();
    document.getElementById("novoContatoNome").value = "";
    document.getElementById("novoContatoTelefone").value = "";
    mostrarToast(`Contato "${nome}" adicionado ✅`);
});

// ================= LISTAS DE CONTATOS =================

function renderizarListasContatos() {
    const grade = document.getElementById("gradeListasContatos");
    grade.innerHTML = "";

    document.getElementById("contadorListas").textContent = `${listasContatos.length} lista(s)`;

    if (listasContatos.length === 0) {
        grade.innerHTML = "<p>Nenhuma lista criada ainda.</p>";
        return;
    }

    listasContatos.forEach(lista => {
        const card = document.createElement("div");
        card.className = "cartao-agendamento";
        card.innerHTML = `
            <strong>${lista.nome}</strong>
            <p class="cartao-texto">${(lista.contatos || []).length} contato(s)</p>
            <div class="cartao-rodape">
                <button class="editar" onclick="editarListaContato('${lista.id}')">Editar</button>
                <button class="botao-perigo" onclick="removerListaContato('${lista.id}')">Excluir</button>
            </div>
        `;
        grade.appendChild(card);
    });
}

async function salvarListasArray() {
    await fetch("/api/listas-contatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listasContatos),
    });
}

function renderizarCheckboxContatosLista(idsMarcados = []) {
    const div = document.getElementById("checkboxContatosLista");
    div.innerHTML = "";

    if (contatos.length === 0) {
        div.innerHTML = "<p style='color:#999; font-size:0.85em;'>Cadastre contatos primeiro, na seção acima.</p>";
        return;
    }

    contatos.forEach(contato => {
        const label = document.createElement("label");
        label.innerHTML = `
            <input type="checkbox" value="${contato.id}" ${idsMarcados.includes(contato.id) ? "checked" : ""}>
            ${contato.nome} <small style="color:#999;">(${contato.telefone})</small>
        `;
        div.appendChild(label);
    });
}

function editarListaContato(id) {
    const lista = listasContatos.find(l => l.id === id);
    if (!lista) return;

    document.getElementById("tituloFormLista").textContent = "Editando lista";
    document.getElementById("listaId").value = lista.id;
    document.getElementById("listaNome").value = lista.nome;
    renderizarCheckboxContatosLista(lista.contatos || []);
    document.getElementById("btnCancelarLista").style.display = "inline-block";
    document.getElementById("formListaContato").scrollIntoView({ behavior: "smooth" });
}

function removerListaContato(id) {
    if (!confirm("Excluir essa lista? Os contatos dela não são apagados, só a lista.")) return;
    listasContatos = listasContatos.filter(l => l.id !== id);
    salvarListasArray();
    renderizarListasContatos();
    renderizarCheckboxListas(pegarMarcados("checkboxListas"));
}

document.getElementById("btnCancelarLista").addEventListener("click", () => {
    limparFormularioLista();
});

function limparFormularioLista() {
    document.getElementById("tituloFormLista").textContent = "Nova lista";
    document.getElementById("formListaContato").reset();
    document.getElementById("listaId").value = "";
    renderizarCheckboxContatosLista();
    document.getElementById("btnCancelarLista").style.display = "none";
}

document.getElementById("formListaContato").addEventListener("submit", async (e) => {
    e.preventDefault();

    const idExistente = document.getElementById("listaId").value;
    const contatosMarcados = Array.from(
        document.querySelectorAll("#checkboxContatosLista input:checked")
    ).map(cb => cb.value);

    const dados = {
        id: idExistente || ("lista-" + Date.now()),
        nome: document.getElementById("listaNome").value,
        contatos: contatosMarcados,
    };

    if (idExistente) {
        const idx = listasContatos.findIndex(l => l.id === idExistente);
        listasContatos[idx] = dados;
    } else {
        listasContatos.push(dados);
    }

    await salvarListasArray();
    renderizarListasContatos();
    renderizarCheckboxListas(pegarMarcados("checkboxListas"));
    limparFormularioLista();
    mostrarToast("Lista salva ✅");
});

// ================= GRID DE AGENDAMENTOS =================

function jaEnviouAgendamentoHoje(id) {
    return envios[id] === new Date().toDateString() || envios[id] === hojeISO();
}

function renderizarAgendamentos() {
    const grade = document.getElementById("gradeAgendamentos");
    grade.innerHTML = "";

    if (agendamentos.length === 0) {
        grade.innerHTML = "<p>Nenhum agendamento criado ainda. Clique em “+ Novo agendamento”.</p>";
        return;
    }

    agendamentos.forEach((agendamento) => {
        const jaEnviouHoje = jaEnviouAgendamentoHoje(agendamento.id);
        const badge = !agendamento.ativo
            ? '<span class="cartao-badge badge-inativo">inativo</span>'
            : (jaEnviouHoje
                ? '<span class="cartao-badge badge-enviado">✅ enviado hoje</span>'
                : '<span class="cartao-badge badge-pendente">⏳ pendente</span>');

        const qtdContatos = (agendamento.contatos || []).length;
        const qtdListas = (agendamento.listas || []).length;
        const totalMidias = (agendamento.midias || []).length;
        const resumoMidia = agendamento.midiasAleatorias && totalMidias > 0
            ? `🎲 ${Math.min(Number(agendamento.qtdMidiasEnvio) || 3, totalMidias)}/${totalMidias}`
            : `📎 ${totalMidias}`;

        const card = document.createElement("div");
        card.className = "cartao-agendamento" + (agendamento.ativo ? "" : " inativo");
        card.innerHTML = `
            <span class="cartao-dica">2x clique</span>
            <div><span class="cartao-horario">${agendamento.horario}</span> ${badge}</div>
            <p class="cartao-texto">${agendamento.texto}</p>
            <div class="cartao-rodape">
                <span>${resumoMidia}</span>
                <span>🔁 ${descreverRecorrenciaCliente(agendamento)}</span>
                <span>👥 ${agendamento.grupos.length}</span>
                <span>📱 ${qtdContatos}</span>
                <span>📋 ${qtdListas}</span>
            </div>
        `;
        card.addEventListener("dblclick", () => abrirPreview(agendamento.id));
        grade.appendChild(card);
    });
}

async function salvarAgendamentos() {
    const resp = await fetch("/api/agendamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agendamentos),
    });
    if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        mostrarToast(dados.erro || "Não foi possível salvar os agendamentos.", "erro");
        agendamentos = await fetch("/api/agendamentos").then(r => r.json()).catch(() => agendamentos);
        renderizarAgendamentos();
        return false;
    }
    return true;
}

// ================= MODAL: PREVIEW =================

const overlayModal = document.getElementById("overlayModal");
const modoPreview = document.getElementById("modoPreview");
const formAgendamento = document.getElementById("formAgendamento");

function abrirPreview(id) {
    const agendamento = agendamentos.find(a => a.id === id);
    if (!agendamento) return;

    previewAtualId = id;

    renderizarPreviewMidias(agendamento.midias);
    document.getElementById("previewTexto").textContent = agendamento.texto;
    document.getElementById("previewHoraBolha").textContent = agendamento.horario;
    document.getElementById("previewHorarioInfo").textContent = `${agendamento.horario} · ${descreverRecorrenciaCliente(agendamento)}`;

    const jaEnviouHoje = jaEnviouAgendamentoHoje(agendamento.id);
    document.getElementById("previewBadge").innerHTML = !agendamento.ativo
        ? '<span class="cartao-badge badge-inativo">inativo</span>'
        : (jaEnviouHoje
            ? '<span class="cartao-badge badge-enviado">✅ enviado hoje</span>'
            : '<span class="cartao-badge badge-pendente">⏳ pendente</span>');

    const totalMidias = (agendamento.midias || []).length;
    const qtdSort = Math.min(Number(agendamento.qtdMidiasEnvio) || 3, totalMidias || 3);
    document.getElementById("previewMidiasInfo").textContent = totalMidias === 0
        ? "Nenhuma"
        : (agendamento.midiasAleatorias
            ? `🎲 ${qtdSort} aleatória(s) por envio (de ${totalMidias} cadastradas, sem repetir)`
            : `${totalMidias} arquivo(s) (envia todas)`);

    const nomesGrupos = agendamento.grupos.length
        ? agendamento.grupos.map(gid => grupos.find(g => g.id === gid)?.nome || "(removido)").join(", ")
        : "—";
    document.getElementById("previewGrupos").textContent = nomesGrupos;

    const nomesContatos = (agendamento.contatos || []).length
        ? agendamento.contatos.map(cid => contatos.find(c => c.id === cid)?.nome || "(removido)").join(", ")
        : "—";
    document.getElementById("previewContatos").textContent = nomesContatos;

    const nomesListas = (agendamento.listas || []).length
        ? agendamento.listas.map(lid => listasContatos.find(l => l.id === lid)?.nome || "(removida)").join(", ")
        : "—";
    document.getElementById("previewListas").textContent = nomesListas;

    modoPreview.classList.remove("oculto");
    formAgendamento.classList.add("oculto");
    overlayModal.classList.remove("oculto");
}

function renderizarPreviewMidias(midias) {
    const container = document.getElementById("previewMidias");
    container.innerHTML = "";
    if (!midias || midias.length === 0) return;

    let indiceAtual = 0;

    function desenhar() {
        const midia = midias[indiceAtual];
        const url = caminhoParaUrl(midia.caminho);
        container.innerHTML = `
            ${midia.tipo === "video"
                ? `<video src="${url}" controls class="preview-midia-grande"></video>`
                : `<img src="${url}" class="preview-midia-grande">`}
            ${midias.length > 1 ? `
                <div class="carrossel-controles">
                    <button type="button" id="btnPrevMidia">‹</button>
                    <span>${indiceAtual + 1} / ${midias.length}</span>
                    <button type="button" id="btnNextMidia">›</button>
                </div>` : ""}
        `;
        if (midias.length > 1) {
            document.getElementById("btnPrevMidia").onclick = () => {
                indiceAtual = (indiceAtual - 1 + midias.length) % midias.length;
                desenhar();
            };
            document.getElementById("btnNextMidia").onclick = () => {
                indiceAtual = (indiceAtual + 1) % midias.length;
                desenhar();
            };
        }
    }
    desenhar();
}

document.getElementById("btnFecharModal").addEventListener("click", fecharModal);
overlayModal.addEventListener("click", (e) => {
    if (e.target === overlayModal) fecharModal();
});

function fecharModal() {
    overlayModal.classList.add("oculto");
    previewAtualId = null;
}

document.getElementById("btnAbrirEdicao").addEventListener("click", () => editarAgendamento(previewAtualId));
document.getElementById("btnDuplicarModal").addEventListener("click", () => duplicarAgendamento(previewAtualId));
document.getElementById("btnTestarModal").addEventListener("click", () => testarAgendamento(previewAtualId));

document.getElementById("btnExcluirModal").addEventListener("click", () => {
    if (!confirm("Excluir esse agendamento?")) return;
    agendamentos = agendamentos.filter(a => a.id !== previewAtualId);
    salvarAgendamentos();
    renderizarAgendamentos();
    fecharModal();
    mostrarToast("Agendamento excluído");
});

// ================= MODAL: EDIÇÃO =================

document.getElementById("btnNovoAgendamento").addEventListener("click", () => {
    limparFormulario();
    document.getElementById("tituloForm").textContent = "Novo agendamento";
    modoPreview.classList.add("oculto");
    formAgendamento.classList.remove("oculto");
    overlayModal.classList.remove("oculto");
});

function editarAgendamento(id) {
    const agendamento = agendamentos.find(a => a.id === id);
    if (!agendamento) return;

    document.getElementById("tituloForm").textContent = "Editando agendamento";
    document.getElementById("agendamentoId").value = agendamento.id;
    document.getElementById("campoHorario").value = agendamento.horario;
    document.getElementById("campoTexto").value = agendamento.texto;
    document.getElementById("campoAtivo").checked = agendamento.ativo;
    preencherRecorrencia(agendamento);
    document.getElementById("campoMidiasAleatorias").checked = !!agendamento.midiasAleatorias;
    document.getElementById("campoQtdMidiasEnvio").value = agendamento.qtdMidiasEnvio || 3;
    atualizarContadorCaracteres();
    midiasFormularioAtual = [...agendamento.midias];
    renderizarListaMidias();
    renderizarCheckboxGrupos(agendamento.grupos);
    renderizarCheckboxContatos(agendamento.contatos || []);
    renderizarCheckboxListas(agendamento.listas || []);

    modoPreview.classList.add("oculto");
    formAgendamento.classList.remove("oculto");
    overlayModal.classList.remove("oculto");
}

function duplicarAgendamento(id) {
    const agendamento = agendamentos.find(a => a.id === id);
    if (!agendamento) return;

    document.getElementById("tituloForm").textContent = "Novo agendamento (duplicado)";
    document.getElementById("agendamentoId").value = "";
    document.getElementById("campoHorario").value = agendamento.horario;
    document.getElementById("campoTexto").value = agendamento.texto;
    document.getElementById("campoAtivo").checked = agendamento.ativo;
    preencherRecorrencia(agendamento);
    document.getElementById("campoMidiasAleatorias").checked = !!agendamento.midiasAleatorias;
    document.getElementById("campoQtdMidiasEnvio").value = agendamento.qtdMidiasEnvio || 3;
    atualizarContadorCaracteres();
    midiasFormularioAtual = [...agendamento.midias];
    renderizarListaMidias();
    renderizarCheckboxGrupos(agendamento.grupos);
    renderizarCheckboxContatos(agendamento.contatos || []);
    renderizarCheckboxListas(agendamento.listas || []);

    modoPreview.classList.add("oculto");
    formAgendamento.classList.remove("oculto");
    overlayModal.classList.remove("oculto");
    mostrarToast("Copiado — ajuste e salve como novo");
}

async function testarAgendamento(id) {
    if (!confirm("Enviar esse agendamento AGORA, sem esperar o horário?")) return;

    const resposta = await fetch(`/api/testar/${id}`, { method: "POST" });
    const resultado = await resposta.json();

    if (!resposta.ok) {
        mostrarToast(resultado.erro || "Erro ao testar", "erro");
        return;
    }
    mostrarToast(resultado.mensagem);
}

document.getElementById("btnCancelarEdicao").addEventListener("click", fecharModal);

function limparFormulario() {
    formAgendamento.reset();
    preencherRecorrencia(null);
    document.getElementById("agendamentoId").value = "";
    document.getElementById("campoMidiasAleatorias").checked = false;
    document.getElementById("campoQtdMidiasEnvio").value = 3;
    const statusUpload = document.getElementById("statusUploadMidias");
    if (statusUpload) statusUpload.textContent = "";
    atualizarContadorCaracteres();
    midiasFormularioAtual = [];
    renderizarListaMidias();
    renderizarCheckboxGrupos();
    renderizarCheckboxContatos();
    renderizarCheckboxListas();
}


// ================= CHECKBOXES (GRUPOS / CONTATOS / LISTAS) NO FORM =================

function pegarMarcados(idDiv) {
    return Array.from(document.querySelectorAll(`#${idDiv} input:checked`)).map(cb => cb.value);
}

function renderizarCheckboxGrupos(idsMarcados = null) {
    const div = document.getElementById("checkboxGrupos");
    div.innerHTML = "";

    const marcados = idsMarcados !== null ? idsMarcados : grupos.filter(g => g.ativo).map(g => g.id);

    grupos.forEach(grupo => {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${grupo.id}" ${marcados.includes(grupo.id) ? "checked" : ""}> ${grupo.nome}`;
        div.appendChild(label);
    });
}

function renderizarCheckboxContatos(idsMarcados = []) {
    const div = document.getElementById("checkboxContatos");
    div.innerHTML = "";

    if (contatos.length === 0) {
        div.innerHTML = "<p style='color:#999; font-size:0.85em;'>Nenhum contato cadastrado ainda.</p>";
        return;
    }

    contatos.forEach(contato => {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${contato.id}" ${idsMarcados.includes(contato.id) ? "checked" : ""}> ${contato.nome} <small style="color:#999;">(${contato.telefone})</small>`;
        div.appendChild(label);
    });
}

function renderizarCheckboxListas(idsMarcados = []) {
    const div = document.getElementById("checkboxListas");
    div.innerHTML = "";

    if (listasContatos.length === 0) {
        div.innerHTML = "<p style='color:#999; font-size:0.85em;'>Nenhuma lista criada ainda.</p>";
        return;
    }

    listasContatos.forEach(lista => {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${lista.id}" ${idsMarcados.includes(lista.id) ? "checked" : ""}> ${lista.nome} <small style="color:#999;">(${(lista.contatos || []).length} contato(s))</small>`;
        div.appendChild(label);
    });
}

document.getElementById("btnMarcarTodosGrupos").addEventListener("click", () => {
    document.querySelectorAll("#checkboxGrupos input").forEach(cb => cb.checked = true);
});

document.getElementById("btnDesmarcarTodosGrupos").addEventListener("click", () => {
    document.querySelectorAll("#checkboxGrupos input").forEach(cb => cb.checked = false);
});

// ================= CONTADOR DE CARACTERES =================

function atualizarContadorCaracteres() {
    const texto = document.getElementById("campoTexto").value;
    const contador = document.getElementById("contadorCaracteres");
    contador.textContent = `${texto.length} caracteres`;
    contador.style.color = texto.length > 1024 ? "#e74c3c" : "";
}

document.getElementById("campoTexto").addEventListener("input", atualizarContadorCaracteres);

// ================= UPLOAD, REORDENAÇÃO E ROTAÇÃO DE MÍDIA =================

function atualizarControlesMidiasAleatorias() {
    const total = midiasFormularioAtual.length;
    const contador = document.getElementById("contadorMidiasForm");
    if (contador) contador.textContent = `${total} arquivo(s)`;

    const btnLimpar = document.getElementById("btnLimparMidias");
    if (btnLimpar) btnLimpar.classList.toggle("oculto", total < 2);

    const chk = document.getElementById("campoMidiasAleatorias");
    const bloco = document.getElementById("blocoQtdMidiasAleatorias");
    const dica = document.getElementById("dicaMidiasAleatorias");
    const inpQtd = document.getElementById("campoQtdMidiasEnvio");

    if (!chk || !bloco) return;
    bloco.classList.toggle("oculto", !chk.checked);

    if (chk.checked && dica && inpQtd) {
        const qtd = Math.max(1, Math.min(50, Number(inpQtd.value) || 3));
        if (total === 0) {
            dica.textContent = "Adicione suas imagens abaixo (ex: 20 fotos) para o bot sortear automaticamente.";
        } else if (qtd >= total) {
            dica.textContent = `Como há ${total} mídia(s) cadastrada(s) e você pediu ${qtd}, todas serão enviadas (em ordem aleatória).`;
        } else {
            const ciclos = Math.ceil(total / qtd);
            dica.textContent = `De ${total} cadastradas, o bot sorteará ${qtd} diferentes por envio (~${ciclos} envios sem repetir!).`;
        }
    }
}

document.getElementById("campoMidiasAleatorias")?.addEventListener("change", atualizarControlesMidiasAleatorias);
document.getElementById("campoQtdMidiasEnvio")?.addEventListener("input", atualizarControlesMidiasAleatorias);
document.getElementById("btnLimparMidias")?.addEventListener("click", () => {
    if (!confirm(`Remover todas as ${midiasFormularioAtual.length} mídias deste agendamento?`)) return;
    midiasFormularioAtual = [];
    renderizarListaMidias();
});

document.getElementById("campoArquivos").addEventListener("change", async (e) => {
    const arquivos = Array.from(e.target.files || []);
    if (arquivos.length === 0) return;

    const statusEl = document.getElementById("statusUploadMidias");
    const btnSalvar = formAgendamento.querySelector('button[type="submit"]');
    if (btnSalvar) btnSalvar.disabled = true;

    let enviados = 0;
    let falhas = 0;
    const LOTE = 3;

    try {
        for (let i = 0; i < arquivos.length; i += LOTE) {
            const lote = arquivos.slice(i, i + LOTE);
            if (statusEl) {
                statusEl.textContent = `⏳ Enviando ${Math.min(i + lote.length, arquivos.length)} de ${arquivos.length} arquivo(s) para a nuvem...`;
            }

            await Promise.all(lote.map(async (arquivo) => {
                const formData = new FormData();
                formData.append("arquivo", arquivo);
                try {
                    const resposta = await fetch("/api/upload", { method: "POST", body: formData });
                    if (!resposta.ok) {
                        falhas++;
                        return;
                    }
                    const resultado = await resposta.json();
                    const tipo = arquivo.type.startsWith("video") ? "video" : "imagem";
                    midiasFormularioAtual.push({
                        tipo,
                        caminho: resultado.caminho,
                        urlPublica: resultado.urlPublica || undefined
                    });
                    enviados++;
                } catch {
                    falhas++;
                }
            }));
            renderizarListaMidias();
        }

        if (statusEl) {
            statusEl.textContent = falhas > 0
                ? `⚠️ ${enviados} enviada(s), ${falhas} falha(s).`
                : `✅ ${enviados} mídia(s) carregada(s)!`;
        }
        if (falhas > 0) mostrarToast(`${falhas} arquivo(s) falharam ao enviar`, "erro");
    } finally {
        if (btnSalvar) btnSalvar.disabled = false;
        e.target.value = "";
    }
});

function renderizarListaMidias() {
    const ul = document.getElementById("listaMidias");
    ul.innerHTML = "";
    atualizarControlesMidiasAleatorias();
    midiasFormularioAtual.forEach((midia, index) => {
        const url = caminhoParaUrl(midia.caminho);
        const li = document.createElement("li");

        const preview = midia.tipo === "video"
            ? `<video src="${url}" muted preload="metadata"></video>`
            : `<img src="${url}">`;

        const botoesRotacao = midia.tipo === "imagem"
            ? `<button type="button" data-acao="girar-esq" title="Girar à esquerda">↺</button>
               <button type="button" data-acao="girar-dir" title="Girar à direita">↻</button>`
            : "";

        li.innerHTML = `
            ${preview}
            <span class="nome-arquivo">${midia.caminho.split("/").pop()}</span>
            ${botoesRotacao}
            <button type="button" data-acao="subir">↑</button>
            <button type="button" data-acao="descer">↓</button>
            <button type="button" data-acao="remover" class="botao-perigo">x</button>
        `;

        li.querySelector('[data-acao="subir"]').onclick = () => moverMidia(index, -1);
        li.querySelector('[data-acao="descer"]').onclick = () => moverMidia(index, 1);
        li.querySelector('[data-acao="remover"]').onclick = () => {
            midiasFormularioAtual.splice(index, 1);
            renderizarListaMidias();
        };

        if (midia.tipo === "imagem") {
            li.querySelector('[data-acao="girar-esq"]').onclick = () => rotacionarMidia(midia.caminho, -90);
            li.querySelector('[data-acao="girar-dir"]').onclick = () => rotacionarMidia(midia.caminho, 90);
        }

        ul.appendChild(li);
    });
}

async function rotacionarMidia(caminho, graus) {
    try {
        const resposta = await fetch("/api/midia/rotacionar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caminho, graus }),
        });

        if (!resposta.ok) {
            const erro = await resposta.json();
            mostrarToast(erro.erro || "Erro ao girar imagem", "erro");
            return;
        }

        cacheBusterMidia[caminho] = Date.now();
        renderizarListaMidias();
        mostrarToast("Imagem girada ✅");
    } catch (err) {
        mostrarToast(`Erro ao girar: ${err.message}`, "erro");
    }
}

function moverMidia(index, direcao) {
    const novoIndex = index + direcao;
    if (novoIndex < 0 || novoIndex >= midiasFormularioAtual.length) return;
    [midiasFormularioAtual[index], midiasFormularioAtual[novoIndex]] =
        [midiasFormularioAtual[novoIndex], midiasFormularioAtual[index]];
    renderizarListaMidias();
}

// ================= SALVAR AGENDAMENTO =================

formAgendamento.addEventListener("submit", async (e) => {
    e.preventDefault();

    const idExistente = document.getElementById("agendamentoId").value;
    const gruposMarcados = pegarMarcados("checkboxGrupos");
    const contatosMarcados = pegarMarcados("checkboxContatos");
    const listasMarcadas = pegarMarcados("checkboxListas");

    if (gruposMarcados.length === 0 && contatosMarcados.length === 0 && listasMarcadas.length === 0) {
        if (!confirm("⚠️ Nenhum grupo, contato ou lista foi marcado — esse agendamento NÃO vai enviar pra ninguém. Salvar mesmo assim?")) return;
    }

    const midiasAleatorias = document.getElementById("campoMidiasAleatorias")?.checked || false;
    const qtdMidiasEnvio = Math.max(1, Math.min(50, Number(document.getElementById("campoQtdMidiasEnvio")?.value) || 3));

    const dados = {
        id: idExistente || ("agenda-" + Date.now()),
        horario: document.getElementById("campoHorario").value,
        texto: document.getElementById("campoTexto").value,
        midias: midiasFormularioAtual,
        midiasAleatorias,
        qtdMidiasEnvio,
        ativo: document.getElementById("campoAtivo").checked,
        grupos: gruposMarcados,
        contatos: contatosMarcados,
        listas: listasMarcadas,
        intervaloDias: lerIntervaloDoFormulario(),
        dataInicio: document.getElementById("campoDataInicio").value || hojeISO(),
    };

    if (idExistente) {
        const idx = agendamentos.findIndex(a => a.id === idExistente);
        agendamentos[idx] = dados;
    } else {
        agendamentos.push(dados);
    }

    const salvou = await salvarAgendamentos();
    if (!salvou) return;
    renderizarAgendamentos();
    fecharModal();
    mostrarToast("Agendamento salvo ✅");
});

// ================= VERIFICAÇÃO DE LOGIN AO ABRIR O PAINEL =================

// Recorrência -----------------------------------------------------------------

function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lerIntervaloDoFormulario() {
    const escolha = document.getElementById("campoRepeticao").value;
    if (escolha === "custom") {
        const n = Math.floor(Number(document.getElementById("campoIntervaloCustom").value));
        return Number.isFinite(n) ? Math.max(2, Math.min(365, n)) : 2;
    }
    return Number(escolha);
}

function preencherRecorrencia(agendamento) {
    const n = agendamento ? (agendamento.intervaloDias || 1) : 1;
    const seletor = document.getElementById("campoRepeticao");
    const campoN = document.getElementById("campoIntervaloCustom");

    seletor.value = (n === 1 || n === 2) ? String(n) : "custom";
    campoN.value = n >= 2 ? n : 3;
    campoN.style.display = seletor.value === "custom" ? "block" : "none";
    document.getElementById("campoDataInicio").value = (agendamento && agendamento.dataInicio) || hojeISO();
}

function descreverRecorrenciaCliente(agendamento) {
    const n = agendamento.intervaloDias || 1;
    if (n === 1) return "todo dia";
    if (n === 2) return "dia sim, dia não";
    return `a cada ${n} dias`;
}

document.getElementById("campoRepeticao").addEventListener("change", () => {
    const personalizado = document.getElementById("campoRepeticao").value === "custom";
    document.getElementById("campoIntervaloCustom").style.display = personalizado ? "block" : "none";
});

// Sair ------------------------------------------------------------------------

document.getElementById("btnSair").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "./login.html";
});

document.getElementById("btnSairBloqueado")?.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "./login.html";
});

document.getElementById("btnConfirmarAvisoDemo")?.addEventListener("click", async () => {
    await fetch("/api/conta/confirmar-aviso-demo", { method: "POST" }).catch(() => {});
    document.getElementById("modalAvisoDemo")?.classList.add("oculto");
});

// Início: confere sessão, troca de senha obrigatória, assinatura e conexão do WhatsApp -----

async function iniciarPagina() {
    const sessao = await fetch("/api/sessao").then(r => r.json()).catch(() => ({ logado: false }));
    if (!sessao.logado) { window.location.href = "./login.html"; return; }
    if (sessao.precisaTrocarSenha) { window.location.href = "./trocar-senha.html"; return; }

    window.SESSAO_ATUAL = sessao;
    const tenant = sessao.tenant || {};
    const acesso = sessao.acesso || { liberado: true };
    const ehSuper = tenant.papel === "superadmin";

    const badge = document.getElementById("badgePlanoUsuario");
    if (badge) {
        const planoTxt = ehSuper ? "👑 Admin" : (tenant.plano === "pro" ? "⭐ Plano Pro" : `🎁 DEMO (${acesso.diasRestantes ?? 0}d)`);
        const codTxt = tenant.codigoUnico ? ` · ${tenant.codigoUnico}` : "";
        badge.textContent = `${tenant.nome || tenant.usuario || ""} · ${planoTxt}${codTxt}`;
    }

    document.getElementById("btnAbaAdmin")?.classList.toggle("oculto", !ehSuper);
    document.getElementById("cartaoSupabaseAdmin")?.classList.toggle("oculto", !ehSuper);
    document.getElementById("btnReiniciarBot")?.classList.toggle("oculto", !ehSuper);

    if (!acesso.liberado) {
        document.querySelector("main")?.classList.add("oculto");
        document.querySelector(".abas")?.classList.add("oculto");
        const telaBloq = document.getElementById("telaAssinaturaBloqueada");
        const msgBloq = document.getElementById("msgAssinaturaBloqueada");
        if (msgBloq) msgBloq.textContent = acesso.mensagem || "Assinatura vencida ou suspensa.";
        telaBloq?.classList.remove("oculto");
        return;
    }

    if (tenant.plano === "free") {
        const banner = document.getElementById("bannerPlanoGratis");
        if (banner) {
            banner.innerHTML = `🎁 <strong>Conta DEMO (${tenant.codigoUnico || ""})</strong> — restam <strong>${acesso.diasRestantes ?? 7} dia(s)</strong> | Limite: <strong>1 agendamento</strong>, até <strong>2 grupos / 3 contatos</strong> e <strong>1 mídia</strong>. Fale com o administrador para ativar o <strong>Plano Pro</strong>!`;
            banner.classList.remove("oculto");
        }
        if (tenant.avisoDemoVisto === false) {
            const modalDemo = document.getElementById("modalAvisoDemo");
            const codPainel = document.getElementById("demoCodigoPainel");
            if (codPainel) codPainel.textContent = `Código único da sua conta: ${tenant.codigoUnico || "-"}`;
            modalDemo?.classList.remove("oculto");
        }
    }

    const status = await fetch("/api/bot/status").then(r => r.json()).catch(() => null);
    if (!status || !status.conexaoWhatsapp.conectado) { window.location.href = "./conectar.html"; return; }

    carregarTudo();
}

iniciarPagina();
