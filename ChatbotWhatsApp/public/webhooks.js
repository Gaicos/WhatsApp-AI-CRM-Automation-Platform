(function () {
  let configWebhookAtual = null;

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function urlEndpointSite() {
    const tid = window.SESSAO_ATUAL?.tenant?.id;
    const sufixo = tid && tid !== "admin" ? `/${encodeURIComponent(tid)}` : "";
    if (location.hostname.endsWith("github.io") || location.protocol === "file:") {
      return `https://whatsapp-ai-crm-worker.onrender.com/api/webhook/site${sufixo}`;
    }
    return `${window.location.origin}/api/webhook/site${sufixo}`;
  }

  async function copiarTexto(texto, msgSucesso = "Copiado! 📋") {
    try {
      await navigator.clipboard.writeText(texto);
      if (typeof mostrarToast === "function") mostrarToast(msgSucesso);
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = texto;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
      if (typeof mostrarToast === "function") mostrarToast(msgSucesso);
    }
  }

  function montarTextoGuia(tokenParaExibir) {
    const endpoint = urlEndpointSite();
    const pingUrl = endpoint.replace(/\/site$/, "/ping");
    return [
      `Endpoint (POST): ${endpoint}`,
      `Teste de saúde (GET): ${pingUrl}`,
      `Header obrigatório: X-Webhook-Secret: ${tokenParaExibir}`,
      `Content-Type: application/json`,
      ``,
      `Exemplo de chamada cURL:`,
      `curl -X POST "${endpoint}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Webhook-Secret: ${tokenParaExibir}" \\`,
      `  -d '{`,
      `    "evento": "pedido_pago",`,
      `    "telefone": "5511999999999",`,
      `    "nome": "João Silva",`,
      `    "pedido": "1042",`,
      `    "valor": 149.90,`,
      `    "rastreio": "",`,
      `    "link": "https://www.gaicos-store.com.br/pedido/1042",`,
      `    "produtos": ["Playmat Personalizado 60x35"]`,
      `  }'`,
      ``,
      `Eventos suportados: pedido_criado, pedido_pago, pedido_producao, pedido_enviado, pedido_entregue, pedido_cancelado, carrinho_abandonado, novo_contato, mensagem`
    ].join("\n");
  }

  function renderizarGuiaProgramador() {
    const pre = document.getElementById("preGuiaProgramador");
    const segredoInput = document.getElementById("webhookSegredo");
    if (!pre || !configWebhookAtual) return;
    const visivel = segredoInput && segredoInput.type === "text";
    const tokenExibicao = visivel ? (configWebhookAtual.segredo || "") : "SEU_TOKEN_SECRETO_AQUI";
    pre.textContent = montarTextoGuia(tokenExibicao);
  }

  function renderizarEventosConfig(eventos = {}) {
    const cont = document.getElementById("listaEventosWebhook");
    const selectTeste = document.getElementById("testeWebhookEvento");
    if (!cont) return;

    const entradas = Object.entries(eventos || {});
    cont.innerHTML = entradas
      .map(([chave, cfg]) => {
        const rotulo = escapeHtml(cfg.rotulo || chave);
        const chaveSafe = escapeHtml(chave);
        const tplSafe = escapeHtml(cfg.template || "");
        return `
          <div style="border:1px solid var(--borda); border-radius:10px; padding:12px; margin-bottom:10px; background:#f8fafc;">
            <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
              <div>
                <strong>${rotulo}</strong>
                <code style="margin-left:6px; background:#e2e8f0; padding:2px 6px; border-radius:4px; font-size:0.85em;">${chaveSafe}</code>
              </div>
              <div style="display:flex; gap:14px; flex-wrap:wrap;">
                <label class="check-ativo" style="margin:0;">
                  <input type="checkbox" data-evento-ativo="${chaveSafe}" ${cfg.ativo !== false ? "checked" : ""}> Ativo
                </label>
                <label class="check-ativo" style="margin:0;">
                  <input type="checkbox" data-evento-grupo="${chaveSafe}" ${cfg.avisarGrupo ? "checked" : ""}> Avisar Grupo de Controle
                </label>
              </div>
            </div>
            <textarea rows="3" maxlength="4000" data-evento-template="${chaveSafe}" style="margin:0;">${tplSafe}</textarea>
          </div>
        `;
      })
      .join("");

    if (selectTeste) {
      const atual = selectTeste.value;
      selectTeste.innerHTML = entradas
        .map(([chave, cfg]) => `<option value="${escapeHtml(chave)}">${escapeHtml(cfg.rotulo || chave)} (${escapeHtml(chave)})</option>`)
        .join("");
      if (atual && eventos[atual]) selectTeste.value = atual;
    }
  }

  async function carregarEventosRecebidos() {
    const corpo = document.getElementById("corpoEventosWebhook");
    if (!corpo) return;
    try {
      const lista = await fetch("/api/webhooks/eventos").then(r => r.json());
      if (!Array.isArray(lista) || lista.length === 0) {
        corpo.innerHTML = `<tr><td colspan="6">Nenhum webhook recebido ainda.</td></tr>`;
        return;
      }
      corpo.innerHTML = lista
        .map(item => {
          const quando = item.recebidoEm ? new Date(item.recebidoEm).toLocaleString("pt-BR") : "-";
          const cliente = [item.nome, item.telefone].filter(Boolean).join(" / ") || "-";
          const corStatus =
            item.status === "enviado" ? "#16a34a" : item.status === "erro" ? "#dc2626" : "#d97706";
          return `
            <tr>
              <td>${escapeHtml(quando)}</td>
              <td><code>${escapeHtml(item.evento || "-")}</code></td>
              <td>${escapeHtml(cliente)}</td>
              <td>${escapeHtml(item.pedido ? "#" + item.pedido : "-")}</td>
              <td style="font-weight:700; color:${corStatus};">${escapeHtml(item.status || "-")}</td>
              <td>${escapeHtml(item.detalhe || "-")}</td>
            </tr>
          `;
        })
        .join("");
    } catch {
      corpo.innerHTML = `<tr><td colspan="6">Não foi possível carregar o histórico de webhooks.</td></tr>`;
    }
  }

  async function carregarPainelWebhooks() {
    try {
      const cfg = await fetch("/api/webhooks/config").then(r => r.json());
      configWebhookAtual = cfg;
      const chkAtivo = document.getElementById("webhookAtivo");
      const inpUrl = document.getElementById("webhookUrlEndpoint");
      const inpSegredo = document.getElementById("webhookSegredo");

      if (chkAtivo) chkAtivo.checked = cfg.ativo !== false;
      if (inpUrl) inpUrl.value = urlEndpointSite();
      if (inpSegredo) inpSegredo.value = cfg.segredo || "";

      const avisoPlano = document.getElementById("avisoWebhookPlanoPro");
      const bloqueado = cfg.permitidoNoPlano === false;
      if (avisoPlano) avisoPlano.classList.toggle("oculto", !bloqueado);
      ["btnSalvarWebhook", "btnRegenerarWebhookSegredo", "btnTestarWebhook"].forEach((idBtn) => {
        const b = document.getElementById(idBtn);
        if (b) b.disabled = bloqueado;
      });

      renderizarEventosConfig(cfg.eventos || {});
      renderizarGuiaProgramador();
      await carregarEventosRecebidos();
    } catch (err) {
      if (typeof mostrarToast === "function") {
        mostrarToast("Erro ao carregar configurações de webhook.", "erro");
      }
    }
  }

  window.carregarPainelWebhooks = carregarPainelWebhooks;

  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btnCopiarWebhookUrl")?.addEventListener("click", () => {
      copiarTexto(urlEndpointSite(), "URL do webhook copiada! 📋");
    });

    document.getElementById("btnMostrarWebhookSegredo")?.addEventListener("click", () => {
      const inp = document.getElementById("webhookSegredo");
      const btn = document.getElementById("btnMostrarWebhookSegredo");
      if (!inp || !btn) return;
      const mostrar = inp.type === "password";
      inp.type = mostrar ? "text" : "password";
      btn.textContent = mostrar ? "🙈 Ocultar" : "👁️ Mostrar";
      renderizarGuiaProgramador();
    });

    document.getElementById("btnCopiarWebhookSegredo")?.addEventListener("click", () => {
      const token = configWebhookAtual?.segredo || document.getElementById("webhookSegredo")?.value || "";
      if (!token) return;
      copiarTexto(token, "Token secreto copiado! 🔑");
    });

    document.getElementById("btnCopiarGuiaProgramador")?.addEventListener("click", () => {
      const token = configWebhookAtual?.segredo || document.getElementById("webhookSegredo")?.value || "SEU_TOKEN";
      copiarTexto(montarTextoGuia(token), "Instruções com URL e Token copiadas! 📋");
    });

    document.getElementById("btnRegenerarWebhookSegredo")?.addEventListener("click", async () => {
      if (!confirm("Gerar um novo token secreto? O token antigo vai parar de funcionar no site até ser atualizado.")) return;
      const resp = await fetch("/api/webhooks/regenerar-segredo", { method: "POST" });
      const dados = await resp.json();
      if (dados.ok && dados.config) {
        configWebhookAtual = dados.config;
        const inpSegredo = document.getElementById("webhookSegredo");
        if (inpSegredo) inpSegredo.value = dados.config.segredo;
        renderizarGuiaProgramador();
        if (typeof mostrarToast === "function") mostrarToast("Novo token gerado com sucesso! 🔄");
      }
    });

    document.getElementById("btnSalvarWebhook")?.addEventListener("click", async () => {
      const ativo = !!document.getElementById("webhookAtivo")?.checked;
      const eventos = {};
      const chaves = Object.keys(configWebhookAtual?.eventos || {});
      for (const chave of chaves) {
        const elAtivo = document.querySelector(`[data-evento-ativo="${chave}"]`);
        const elGrupo = document.querySelector(`[data-evento-grupo="${chave}"]`);
        const elTpl = document.querySelector(`[data-evento-template="${chave}"]`);
        eventos[chave] = {
          ...(configWebhookAtual?.eventos?.[chave] || {}),
          ativo: elAtivo ? elAtivo.checked : true,
          avisarGrupo: elGrupo ? elGrupo.checked : false,
          template: elTpl ? elTpl.value : ""
        };
      }

      const resp = await fetch("/api/webhooks/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo, eventos })
      });
      const dados = await resp.json();
      if (dados.ok) {
        configWebhookAtual = dados.config;
        if (typeof mostrarToast === "function") mostrarToast("Configuração de webhook salva! ✅");
      } else {
        if (typeof mostrarToast === "function") mostrarToast(dados.erro || "Erro ao salvar.", "erro");
      }
    });

    document.getElementById("btnTestarWebhook")?.addEventListener("click", async () => {
      const box = document.getElementById("resultadoTesteWebhook");
      const btn = document.getElementById("btnTestarWebhook");
      const payload = {
        evento: document.getElementById("testeWebhookEvento")?.value || "pedido_pago",
        telefone: document.getElementById("testeWebhookTelefone")?.value.trim() || "",
        nome: document.getElementById("testeWebhookNome")?.value.trim() || "",
        pedido: document.getElementById("testeWebhookPedido")?.value.trim() || "",
        valor: document.getElementById("testeWebhookValor")?.value.trim() || "",
        rastreio: document.getElementById("testeWebhookRastreio")?.value.trim() || "",
        link: document.getElementById("testeWebhookLink")?.value.trim() || "",
        mensagem: document.getElementById("testeWebhookMensagem")?.value.trim() || ""
      };

      if (btn) btn.disabled = true;
      try {
        const resp = await fetch("/api/webhooks/testar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const dados = await resp.json();
        if (box) {
          box.classList.remove("oculto");
          if (resp.ok && dados.ok) {
            box.style.background = dados.ignorado ? "#fef3c7" : "#dcf8c6";
            box.textContent = dados.ignorado
              ? `Ignorado: ${dados.motivo}`
              : `✅ Enviado! (${dados.enviadoCliente ? "Cliente notificado" : ""}${dados.enviadoCliente && dados.avisadoGrupo ? " + " : ""}${dados.avisadoGrupo ? "Grupo alertado" : ""})\n\nTexto:\n${dados.mensagemEnviada || ""}`;
          } else {
            box.style.background = "#fee2e2";
            box.textContent = `❌ Erro: ${dados.erro || "Falha ao testar webhook."}`;
          }
        }
        await carregarEventosRecebidos();
      } catch (err) {
        if (box) {
          box.classList.remove("oculto");
          box.style.background = "#fee2e2";
          box.textContent = `❌ Erro de comunicação: ${err.message}`;
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById("btnAtualizarEventosWebhook")?.addEventListener("click", carregarEventosRecebidos);
    document.getElementById("btnLimparEventosWebhook")?.addEventListener("click", async () => {
      if (!confirm("Limpar o histórico recente de webhooks?")) return;
      await fetch("/api/webhooks/eventos/limpar", { method: "POST" });
      await carregarEventosRecebidos();
      if (typeof mostrarToast === "function") mostrarToast("Histórico limpo!");
    });
  });
})();
