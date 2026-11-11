let fluxoTriagem = {
  ativo: false,
  boasVindas: "",
  nodeInicial: null,
  nodes: [],
  ia: {
    ativa: true,
    provedor: "local",
    apiKey: "",
    modelo: "",
    urlSite: "https://www.gaicos-store.com.br/",
    conhecimentoSite: "",
    conhecimentoExtra: "",
    ultimaSincronizacao: null,
    promptSistema: "",
    mensagemTransferenciaHumano: "",
    horasPausaHumano: 24,
    pausarAoResponderManual: false,
    avisarGrupoControle: true
  }
};

let dadosAprendizado = {
  exemplos: [],
  interacoesRecentes: []
};

let ultimaPerguntaSimulada = "";

const $ = (id) => document.getElementById(id);

const MODELOS_PADRAO = {
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  local: ""
};

const DICAS_PROVEDOR = {
  local: "Funciona imediatamente sem chave de API, usando respostas curtas baseadas no site e nos exemplos que você ensinar.",
  gemini: "Crie sua chave gratuita em aistudio.google.com/apikey (Modelo sugerido: gemini-2.5-flash).",
  groq: "Crie sua chave gratuita em console.groq.com/keys (Modelo sugerido: llama-3.3-70b-versatile).",
  openai: "Use sua chave da plataforma OpenAI em platform.openai.com/api-keys (Modelo sugerido: gpt-4o-mini)."
};

function escapar(valor) {
  const div = document.createElement("div");
  div.textContent = valor ?? "";
  return div.innerHTML;
}

function novoId() {
  return `pergunta_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function atualizarVisibilidadeProvedor() {
  const provedor = $("iaProvedor").value || "local";
  const ehLocal = provedor === "local";
  $("blocoModeloIa").style.display = ehLocal ? "none" : "block";
  $("blocoChaveIa").style.display = ehLocal ? "none" : "block";
  $("dicaProvedorIa").textContent = DICAS_PROVEDOR[provedor] || "";

  if (!ehLocal && !$("iaModelo").value.trim()) {
    $("iaModelo").value = MODELOS_PADRAO[provedor] || "";
  }
}

function formatarDataHora(iso) {
  if (!iso) return "Base padrão da Gaicos Store carregada.";
  try {
    return "Última leitura do site: " + new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "";
  }
}

async function carregarTriagem() {
  fluxoTriagem = await fetch("/api/triagem").then(r => r.json());
  const ia = fluxoTriagem.ia || {};

  $("triagemAtivo").checked = !!fluxoTriagem.ativo;
  $("triagemBoasVindas").value = fluxoTriagem.boasVindas || "";

  $("iaAtiva").checked = ia.ativa !== false;
  $("iaUrlSite").value = ia.urlSite || "https://www.gaicos-store.com.br/";
  $("iaProvedor").value = ia.provedor || "local";
  $("iaModelo").value = ia.modelo || MODELOS_PADRAO[ia.provedor] || "";
  $("iaApiKey").value = ia.apiKey || "";
  $("iaConhecimentoExtra").value = ia.conhecimentoExtra || "";
  $("iaConhecimentoSite").value = ia.conhecimentoSite || "";
  $("iaPromptSistema").value = ia.promptSistema || "";
  $("iaMensagemHumano").value = ia.mensagemTransferenciaHumano || "";
  $("iaHorasPausa").value = ia.horasPausaHumano || 24;
  $("iaPausarManual").checked = !!ia.pausarAoResponderManual;
  $("iaAvisarGrupo").checked = ia.avisarGrupoControle !== false;
  $("statusSincronizacaoSite").textContent = formatarDataHora(ia.ultimaSincronizacao);

  atualizarVisibilidadeProvedor();
  atualizarTriagem();
  carregarPausasHumano();
  carregarAprendizado();
}

function atualizarTriagem() {
  $("triagemInicial").innerHTML = `<option value="">Sem menu numerado (Apenas conversa livre com IA)</option>` +
    fluxoTriagem.nodes.map(n => `<option value="${escapar(n.id)}">${escapar(n.titulo || n.id)}</option>`).join("");
  $("triagemInicial").value = fluxoTriagem.nodeInicial || "";

  $("triagemLista").innerHTML = fluxoTriagem.nodes.length
    ? fluxoTriagem.nodes.map((node, index) => renderizarPergunta(node, index)).join("")
    : `<p class="texto-ajuda">Nenhuma pergunta numerada cadastrada. O bot responderá diretamente de forma dinâmica usando a IA e o aprendizado.</p>`;
}

function renderizarPergunta(node) {
  const opcoes = (node.opcoes || []).map((opcao, indice) => {
    const destinos = fluxoTriagem.nodes.map(n => `<option value="${escapar(n.id)}" ${opcao.proxima === n.id ? "selected" : ""}>${escapar(n.titulo || n.id)}</option>`).join("");
    return `<div class="linha-acoes" style="margin-bottom:8px">
      <strong>${indice + 1}.</strong>
      <input data-node="${escapar(node.id)}" data-campo="opcao-texto" data-indice="${indice}" value="${escapar(opcao.texto || "")}" placeholder="Texto da opção (ex: Falar com atendente)" style="flex:1">
      <input data-node="${escapar(node.id)}" data-campo="opcao-resposta" data-indice="${indice}" value="${escapar(opcao.resposta || "")}" placeholder="Resposta enviada ao escolher esta opção" style="flex:1">
      <select data-node="${escapar(node.id)}" data-campo="opcao-next" data-indice="${indice}">
        <option value="">Encerrar / IA assume</option>${destinos}
      </select>
    </div>`;
  }).join("");

  return `<div class="cartao-status" data-pergunta="${escapar(node.id)}">
    <div class="linha-acoes">
      <input data-campo="titulo" value="${escapar(node.titulo || "")}" placeholder="Nome interno da pergunta" style="flex:1">
      <button type="button" class="botao-perigo" data-remover="${escapar(node.id)}">Excluir</button>
    </div>
    <textarea data-campo="texto" rows="3" maxlength="4000" placeholder="Mensagem enviada ao cliente">${escapar(node.texto || "")}</textarea>
    <strong>Respostas aceitas no menu: 1 a ${node.opcoes?.length || 0}</strong>
    <div style="margin-top:10px">${opcoes}</div>
    <div class="linha-acoes">
      <button type="button" class="botao-secundario" data-add-opcao="${escapar(node.id)}" ${(node.opcoes?.length || 0) >= 9 ? "disabled" : ""}>+ Opção</button>
      <button type="button" class="botao-secundario" data-rem-opcao="${escapar(node.id)}" ${(node.opcoes?.length || 0) <= 1 ? "disabled" : ""}>- Opção</button>
    </div>
  </div>`;
}

function coletarConfigIaDaTela() {
  return {
    ativa: $("iaAtiva").checked,
    urlSite: $("iaUrlSite").value.trim() || "https://www.gaicos-store.com.br/",
    provedor: $("iaProvedor").value || "local",
    modelo: $("iaModelo").value.trim(),
    apiKey: $("iaApiKey").value.trim(),
    conhecimentoExtra: $("iaConhecimentoExtra").value,
    conhecimentoSite: $("iaConhecimentoSite").value,
    ultimaSincronizacao: fluxoTriagem.ia?.ultimaSincronizacao || null,
    promptSistema: $("iaPromptSistema").value,
    mensagemTransferenciaHumano: $("iaMensagemHumano").value,
    horasPausaHumano: Number($("iaHorasPausa").value) || 24,
    pausarAoResponderManual: $("iaPausarManual").checked,
    avisarGrupoControle: $("iaAvisarGrupo").checked
  };
}

function atualizarModeloPelaTela() {
  document.querySelectorAll("[data-pergunta]").forEach(cartao => {
    const node = fluxoTriagem.nodes.find(n => n.id === cartao.dataset.pergunta);
    if (!node) return;
    node.titulo = cartao.querySelector('[data-campo="titulo"]').value;
    node.texto = cartao.querySelector('[data-campo="texto"]').value;
  });
  document.querySelectorAll("[data-node][data-campo]").forEach(input => {
    const node = fluxoTriagem.nodes.find(n => n.id === input.dataset.node);
    const opcao = node?.opcoes?.[Number(input.dataset.indice)];
    if (!opcao) return;
    if (input.dataset.campo === "opcao-texto") opcao.texto = input.value;
    if (input.dataset.campo === "opcao-resposta") opcao.resposta = input.value;
    if (input.dataset.campo === "opcao-next") opcao.proxima = input.value || null;
  });
  fluxoTriagem.ativo = $("triagemAtivo").checked;
  fluxoTriagem.boasVindas = $("triagemBoasVindas").value;
  fluxoTriagem.nodeInicial = $("triagemInicial").value || null;
  fluxoTriagem.ia = coletarConfigIaDaTela();
}

$("iaProvedor").addEventListener("change", () => {
  const p = $("iaProvedor").value;
  if (MODELOS_PADRAO[p]) {
    $("iaModelo").value = MODELOS_PADRAO[p];
  }
  atualizarVisibilidadeProvedor();
});

$("btnSincronizarSite").addEventListener("click", async () => {
  const btn = $("btnSincronizarSite");
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Lendo páginas do site...";
  try {
    const resp = await fetch("/api/triagem/sincronizar-site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urlSite: $("iaUrlSite").value.trim() })
    });
    const dados = await resp.json();
    if (!resp.ok || !dados.ok) {
      mostrarToast(dados.erro || "Falha ao sincronizar o site.", "erro");
      return;
    }
    $("iaConhecimentoSite").value = dados.conhecimentoSite || "";
    fluxoTriagem.ia = fluxoTriagem.ia || {};
    fluxoTriagem.ia.ultimaSincronizacao = dados.ultimaSincronizacao;
    $("statusSincronizacaoSite").textContent =
      `${formatarDataHora(dados.ultimaSincronizacao)} (${(dados.paginasLidas || []).length} página(s) verificada(s))`;
    mostrarToast("Conteúdo do site atualizado com sucesso! ✅", "ok");
  } catch (err) {
    mostrarToast("Erro ao ler o site: " + err.message, "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

// ---------------- SIMULADOR + ENSINAR DIRETO ----------------

async function executarSimulacao() {
  const pergunta = $("inputSimularPergunta").value.trim();
  if (!pergunta) {
    mostrarToast("Digite uma pergunta para testar.", "erro");
    return;
  }
  ultimaPerguntaSimulada = pergunta;
  const btn = $("btnSimularPergunta");
  const box = $("resultadoSimulacao");
  const blocoCorrigir = $("blocoCorrigirSimulacao");

  btn.disabled = true;
  btn.textContent = "⏳ Gerando...";
  box.classList.remove("oculto");
  box.textContent = "Consultando...";

  try {
    const resp = await fetch("/api/triagem/simular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mensagem: pergunta,
        ia: coletarConfigIaDaTela()
      })
    });
    const dados = await resp.json();
    if (!resp.ok || !dados.ok) {
      box.textContent = "❌ Erro: " + (dados.erro || "Não foi possível simular.");
      blocoCorrigir.classList.add("oculto");
      return;
    }
    const badgeAtendente = dados.chamarAtendente
      ? "\n\n🔔 [AÇÃO: Pausou o robô para este cliente e avisou o Atendente Humano!]"
      : "";
    const etiquetaOrigem = dados.origem === "aprendizado-treinado"
      ? "🧠 Resposta que você ensinou"
      : `🤖 Resposta do Bot (${dados.origem || "ia"})`;

    box.textContent = `${etiquetaOrigem}:\n\n${dados.resposta}${badgeAtendente}`;
    $("inputCorrigirSimulacao").value = dados.resposta || "";
    blocoCorrigir.classList.remove("oculto");
    carregarAprendizado();
  } catch (err) {
    box.textContent = "❌ Erro: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Testar Resposta";
  }
}

$("btnSimularPergunta").addEventListener("click", executarSimulacao);
$("inputSimularPergunta").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    executarSimulacao();
  }
});

$("btnEnsinarDaSimulacao").addEventListener("click", async () => {
  const pergunta = ultimaPerguntaSimulada || $("inputSimularPergunta").value.trim();
  const respostaIdeal = $("inputCorrigirSimulacao").value.trim();
  if (!pergunta || !respostaIdeal) {
    mostrarToast("Preencha a resposta ideal para ensinar ao bot.", "erro");
    return;
  }
  const resp = await fetch("/api/triagem/aprendizado", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pergunta, resposta: respostaIdeal })
  });
  const dados = await resp.json();
  if (!resp.ok || !dados.ok) {
    mostrarToast(dados.erro || "Erro ao salvar aprendizado.", "erro");
    return;
  }
  mostrarToast("O bot aprendeu essa resposta! 🧠✅", "ok");
  $("resultadoSimulacao").textContent = `🧠 Resposta que você ensinou:\n\n${respostaIdeal}`;
  carregarAprendizado();
});

// ---------------- APRENDIZADO CONTÍNUO (MACHINE LEARNING DO BOT) ----------------

async function carregarAprendizado() {
  try {
    dadosAprendizado = await fetch("/api/triagem/aprendizado").then(r => r.json());
    renderizarAprendizado();
  } catch {}
}

function renderizarAprendizado() {
  const exemplos = dadosAprendizado.exemplos || [];
  const interacoes = dadosAprendizado.interacoesRecentes || [];

  $("contadorExemplosTreinados").textContent = exemplos.length;
  $("contadorInteracoesRecentes").textContent = interacoes.length;

  const boxExemplos = $("listaExemplosTreinados");
  if (exemplos.length === 0) {
    boxExemplos.innerHTML = `<p class="texto-ajuda" style="margin:6px 0;">Você ainda não ensinou nenhuma resposta personalizada. Use o formulário acima ou o simulador para treinar o bot!</p>`;
  } else {
    boxExemplos.innerHTML = `
      <table>
        <thead>
          <tr><th>Quando perguntarem algo como...</th><th>O bot responde...</th><th style="width:150px;">Ação</th></tr>
        </thead>
        <tbody>
          ${exemplos.map(item => `
            <tr>
              <td><strong>${escapar(item.pergunta)}</strong></td>
              <td style="white-space:pre-wrap;">${escapar(item.resposta)}</td>
              <td>
                <button type="button" class="botao-secundario" data-editar-treino="${escapar(item.id)}" style="padding:5px 10px; font-size:0.82em;">✏️ Editar</button>
                <button type="button" class="botao-perigo" data-excluir-treino="${escapar(item.id)}" style="padding:5px 10px; font-size:0.82em;">🗑️</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  const boxInteracoes = $("listaInteracoesRecentes");
  if (interacoes.length === 0) {
    boxInteracoes.innerHTML = `<p class="texto-ajuda" style="margin:6px 0;">Nenhuma conversa registrada ainda.</p>`;
  } else {
    boxInteracoes.innerHTML = `
      <table>
        <thead>
          <tr><th>Pergunta recebida</th><th>Resposta dada pelo bot</th><th style="width:140px;">Treinar</th></tr>
        </thead>
        <tbody>
          ${interacoes.map((item, idx) => `
            <tr>
              <td>
                <small style="color:var(--texto-suave);">${escapar(item.cliente || "")}</small><br>
                <strong>${escapar(item.pergunta)}</strong>
              </td>
              <td style="white-space:pre-wrap;">${escapar(item.resposta)}</td>
              <td>
                <button type="button" class="botao-alerta" data-corrigir-interacao="${idx}" style="padding:6px 10px; font-size:0.84em;">🎯 Adequar</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
}

function limparFormularioTreino() {
  $("treinoId").value = "";
  $("treinoPergunta").value = "";
  $("treinoResposta").value = "";
  $("btnSalvarTreino").textContent = "🧠 Ensinar Resposta ao Bot";
  $("btnCancelarTreino").classList.add("oculto");
}

$("btnSalvarTreino").addEventListener("click", async () => {
  const id = $("treinoId").value.trim() || null;
  const pergunta = $("treinoPergunta").value.trim();
  const resposta = $("treinoResposta").value.trim();

  if (!pergunta || !resposta) {
    mostrarToast("Preencha a pergunta do cliente e a resposta ideal.", "erro");
    return;
  }

  const resp = await fetch("/api/triagem/aprendizado", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, pergunta, resposta })
  });
  const dados = await resp.json();
  if (!resp.ok || !dados.ok) {
    mostrarToast(dados.erro || "Erro ao salvar aprendizado.", "erro");
    return;
  }
  mostrarToast("Aprendizado salvo com sucesso! 🧠✅", "ok");
  limparFormularioTreino();
  dadosAprendizado = dados.dados;
  renderizarAprendizado();
});

$("btnCancelarTreino").addEventListener("click", limparFormularioTreino);

$("listaExemplosTreinados").addEventListener("click", async (e) => {
  const idEditar = e.target.dataset.editarTreino;
  if (idEditar) {
    const item = (dadosAprendizado.exemplos || []).find(x => x.id === idEditar);
    if (!item) return;
    $("treinoId").value = item.id;
    $("treinoPergunta").value = item.pergunta;
    $("treinoResposta").value = item.resposta;
    $("btnSalvarTreino").textContent = "💾 Atualizar Aprendizado";
    $("btnCancelarTreino").classList.remove("oculto");
    $("treinoPergunta").focus();
    return;
  }

  const idExcluir = e.target.dataset.excluirTreino;
  if (idExcluir) {
    const resp = await fetch(`/api/triagem/aprendizado/${encodeURIComponent(idExcluir)}`, { method: "DELETE" });
    const dados = await resp.json();
    if (dados.ok) {
      dadosAprendizado = dados.dados;
      renderizarAprendizado();
      mostrarToast("Exemplo removido.", "ok");
    }
  }
});

$("listaInteracoesRecentes").addEventListener("click", (e) => {
  const idx = e.target.dataset.corrigirInteracao;
  if (idx === undefined) return;
  const item = (dadosAprendizado.interacoesRecentes || [])[Number(idx)];
  if (!item) return;
  $("treinoId").value = "";
  $("treinoPergunta").value = item.pergunta;
  $("treinoResposta").value = item.resposta;
  $("btnSalvarTreino").textContent = "🧠 Salvar Resposta Adequada";
  $("btnCancelarTreino").classList.remove("oculto");
  $("treinoResposta").focus();
  $("treinoResposta").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("btnAtualizarAprendizado").addEventListener("click", carregarAprendizado);

$("btnLimparInteracoes").addEventListener("click", async () => {
  const resp = await fetch("/api/triagem/aprendizado/limpar-interacoes", { method: "POST" });
  const dados = await resp.json();
  if (dados.ok) {
    dadosAprendizado = dados.dados;
    renderizarAprendizado();
    mostrarToast("Histórico recente limpo.", "ok");
  }
});

// ---------------- PAUSAS ATENDIMENTO HUMANO ----------------

async function carregarPausasHumano() {
  try {
    const lista = await fetch("/api/triagem/pausas").then(r => r.json());
    const container = $("listaPausasHumano");
    if (!Array.isArray(lista) || lista.length === 0) {
      container.innerHTML = `<p class="texto-ajuda" style="margin:6px 0;">Nenhum cliente pausado no momento. Todos estão sendo atendidos pelo bot.</p>`;
      return;
    }
    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Cliente</th><th>Motivo</th><th>Última mensagem</th><th>Pausado até</th><th>Ação</th></tr>
        </thead>
        <tbody>
          ${lista.map(item => `
            <tr>
              <td>
                <strong>${escapar(item.nome || item.telefone)}</strong><br>
                <a href="https://wa.me/${escapar(item.telefone)}" target="_blank" style="font-size:0.85em; color:var(--verde-escuro);">wa.me/${escapar(item.telefone)}</a>
              </td>
              <td>${escapar(item.motivo || "-")}</td>
              <td>${escapar(item.ultimaMensagem || "-")}</td>
              <td>${item.expiraEm ? new Date(item.expiraEm).toLocaleString("pt-BR") : "-"}</td>
              <td>
                <button type="button" class="botao-primario" data-reativar-jid="${escapar(item.jid)}">▶️ Reativar Bot</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch {}
}

$("btnAtualizarPausas").addEventListener("click", carregarPausasHumano);

$("btnReativarTodos").addEventListener("click", async () => {
  await fetch("/api/triagem/pausas/reativar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jid: "todos" })
  });
  mostrarToast("Robô reativado para todos os clientes ✅", "ok");
  carregarPausasHumano();
});

$("listaPausasHumano").addEventListener("click", async (e) => {
  const jid = e.target.dataset.reativarJid;
  if (!jid) return;
  await fetch("/api/triagem/pausas/reativar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jid })
  });
  mostrarToast("Robô reativado para este cliente ✅", "ok");
  carregarPausasHumano();
});

$("triagemNovaPergunta").addEventListener("click", () => {
  const node = {
    id: novoId(),
    titulo: `Pergunta ${fluxoTriagem.nodes.length + 1}`,
    texto: "Como podemos ajudar?",
    opcoes: [
      { texto: "Criar Playmat Personalizado", proxima: null, resposta: "Acesse nossa ferramenta interativa: https://www.gaicos-store.com.br/criar-playmat" },
      { texto: "Ver Catálogo de Produtos", proxima: null, resposta: "Confira nosso catálogo completo em: https://www.gaicos-store.com.br/produtos" },
      { texto: "Falar com atendente humano", proxima: null, resposta: "" }
    ]
  };
  fluxoTriagem.nodes.push(node);
  if (!fluxoTriagem.nodeInicial) fluxoTriagem.nodeInicial = node.id;
  atualizarTriagem();
});

$("triagemSalvar").addEventListener("click", async () => {
  atualizarModeloPelaTela();
  const resposta = await fetch("/api/triagem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fluxoTriagem)
  });
  const dados = await resposta.json();
  mostrarToast(dados.ok ? "Configuração de Triagem & IA salva com sucesso ✅" : (dados.erro || "Não foi possível salvar"), dados.ok ? "ok" : "erro");
  if (dados.ok) carregarTriagem();
});

$("triagemLista").addEventListener("click", (evento) => {
  atualizarModeloPelaTela();
  const remover = evento.target.dataset.remover;
  if (remover) {
    fluxoTriagem.nodes = fluxoTriagem.nodes.filter(n => n.id !== remover);
    fluxoTriagem.nodes.forEach(n => n.opcoes.forEach(o => { if (o.proxima === remover) o.proxima = null; }));
    if (fluxoTriagem.nodeInicial === remover) fluxoTriagem.nodeInicial = null;
    atualizarTriagem();
    return;
  }
  const add = evento.target.dataset.addOpcao;
  const rem = evento.target.dataset.remOpcao;
  if (add) {
    const node = fluxoTriagem.nodes.find(n => n.id === add);
    if (node && node.opcoes.length < 9) node.opcoes.push({ texto: `Opção ${node.opcoes.length + 1}`, proxima: null, resposta: "" });
    atualizarTriagem();
  }
  if (rem) {
    const node = fluxoTriagem.nodes.find(n => n.id === rem);
    if (node && node.opcoes.length > 1) node.opcoes.pop();
    atualizarTriagem();
  }
});

$("triagemInicial").addEventListener("change", evento => {
  fluxoTriagem.nodeInicial = evento.target.value || null;
});

carregarTriagem();
