(function () {
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatarDataBr(iso) {
    if (!iso) return "Ilimitado";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "-";
    return new Date(ms).toLocaleDateString("pt-BR");
  }

  function renderizarResumo(resumo = {}) {
    const el = document.getElementById("resumoAdminSaas");
    if (!el) return;
    el.innerHTML = `
      <div class="info-pm2-item"><strong>${Number(resumo.totalClientes || 0)}</strong><span>Total contas</span></div>
      <div class="info-pm2-item"><strong>${Number(resumo.totalPro || 0)}</strong><span>Plano Pro ativos</span></div>
      <div class="info-pm2-item"><strong>${Number(resumo.totalFree || 0)}</strong><span>Testes grátis ativos</span></div>
      <div class="info-pm2-item"><strong>${Number(resumo.totalConectados || 0)}</strong><span>WhatsApps online</span></div>
      <div class="info-pm2-item"><strong>${Number(resumo.memoriaMb || 0)} MB</strong><span>RAM servidor</span></div>
    `;
  }

  function renderizarTabelaClientes(clientes = []) {
    const corpo = document.getElementById("corpoClientesAdmin");
    if (!corpo) return;

    if (!Array.isArray(clientes) || clientes.length === 0) {
      corpo.innerHTML = `<tr><td colspan="7">Nenhum cliente cadastrado.</td></tr>`;
      return;
    }

    corpo.innerHTML = clientes.map((c) => {
      const ehSuper = c.papel === "superadmin" || c.id === "admin";
      const acesso = c.acesso || {};
      const statusBadge = ehSuper
        ? `<span style="color:#0f766e; font-weight:700;">👑 Admin</span>`
        : acesso.liberado
          ? `<span style="color:#16a34a; font-weight:700;">✅ Ativo (${acesso.diasRestantes ?? "∞"}d)</span>`
          : `<span style="color:#dc2626; font-weight:700;">⛔ ${escapeHtml(acesso.motivo || "Bloqueado")}</span>`;

      const planoLabel = c.plano === "superadmin"
        ? "Admin"
        : c.plano === "pro"
          ? "Pro"
          : "Grátis (7d)";

      const acoes = ehSuper
        ? `<span style="color:#64748b; font-size:0.85em;">Conta principal</span>`
        : `
          <div style="display:flex; flex-wrap:wrap; gap:4px;">
            ${c.emailVerificado === false ? `<button type="button" class="botao-primario" data-adm-acao="verificarEmail" data-id="${escapeHtml(c.id)}">📧 Validar e-mail</button>` : ""}
            <button type="button" class="botao-primario" data-adm-acao="renovar" data-id="${escapeHtml(c.id)}" title="Adicionar +30 dias">+30d</button>
            <button type="button" class="botao-secundario" data-adm-acao="plano" data-id="${escapeHtml(c.id)}" data-plano="${c.plano === "pro" ? "free" : "pro"}">${c.plano === "pro" ? "Mudar p/ Grátis" : "Ativar Pro"}</button>
            <button type="button" class="botao-alerta" data-adm-acao="toggle" data-id="${escapeHtml(c.id)}" data-ativo="${c.ativo === false ? "1" : "0"}">${c.ativo === false ? "Reativar" : "Suspender"}</button>
            <button type="button" class="botao-secundario" data-adm-acao="senha" data-id="${escapeHtml(c.id)}">🔑 Senha</button>
            <button type="button" class="botao-perigo" data-adm-acao="excluir" data-id="${escapeHtml(c.id)}" data-nome="${escapeHtml(c.nome)}">🗑️</button>
          </div>
        `;

      const tagEmailPendente = c.emailVerificado === false
        ? `<br><small style="color:#d97706; font-weight:600;">📧 Aguardando confirmação de e-mail</small>`
        : "";

      return `
        <tr>
          <td>
            <strong>${escapeHtml(c.nome)}</strong> <small style="color:#0f766e;">[${escapeHtml(c.codigoUnico || c.id)}]</small><br>
            <small style="color:#64748b;">@${escapeHtml(c.usuario)}${c.email ? " · " + escapeHtml(c.email) : ""}</small>${tagEmailPendente}
          </td>
          <td>${escapeHtml(planoLabel)}</td>
          <td>${statusBadge}</td>
          <td>${escapeHtml(formatarDataBr(c.expiraEm))}</td>
          <td>${c.whatsappConectado ? "🟢 Online" : "⚪ Offline"}</td>
          <td>${Number(c.qtdAgendamentos || 0)}</td>
          <td>${acoes}</td>
        </tr>
      `;
    }).join("");
  }

  async function carregarPainelAdmin() {
    try {
      const resp = await fetch("/api/admin/clientes");
      if (!resp.ok) return;
      const dados = await resp.json();
      renderizarResumo(dados.resumo);
      renderizarTabelaClientes(dados.clientes);
    } catch {
      if (typeof mostrarToast === "function") mostrarToast("Erro ao carregar painel administrativo.", "erro");
    }
  }

  window.carregarPainelAdmin = carregarPainelAdmin;

  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btnAtualizarClientesAdmin")?.addEventListener("click", carregarPainelAdmin);

    document.getElementById("admPlano")?.addEventListener("change", (e) => {
      const inpDias = document.getElementById("admDias");
      if (inpDias) inpDias.value = e.target.value === "free" ? "7" : "30";
    });

    document.getElementById("formNovoClienteAdmin")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        nome: document.getElementById("admNome")?.value.trim(),
        usuario: document.getElementById("admUsuario")?.value.trim(),
        email: document.getElementById("admEmail")?.value.trim(),
        senha: document.getElementById("admSenha")?.value,
        plano: document.getElementById("admPlano")?.value || "pro",
        diasValidade: Number(document.getElementById("admDias")?.value) || 30,
        precisaTrocarSenha: true
      };

      const resp = await fetch("/api/admin/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados.ok) {
        if (typeof mostrarToast === "function") mostrarToast(dados.erro || "Erro ao cadastrar cliente.", "erro");
        return;
      }

      e.target.reset();
      if (document.getElementById("admDias")) document.getElementById("admDias").value = "30";
      if (typeof mostrarToast === "function") mostrarToast("Cliente cadastrado com sucesso! ✅");
      await carregarPainelAdmin();
    });

    document.getElementById("corpoClientesAdmin")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-adm-acao]");
      if (!btn) return;
      const acao = btn.dataset.admAcao;
      const id = btn.dataset.id;

      if (acao === "verificarEmail") {
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}/verificar-email`, { method: "POST" });
        const dados = await resp.json().catch(() => ({}));
        if (resp.ok && dados.ok) {
          mostrarToast("E-mail do cliente validado manualmente! 📧✅");
          await carregarPainelAdmin();
        } else {
          mostrarToast(dados.erro || "Erro ao validar e-mail.", "erro");
        }
      } else if (acao === "renovar") {
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}/renovar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dias: 30 })
        });
        const dados = await resp.json().catch(() => ({}));
        if (resp.ok && dados.ok) {
          mostrarToast("Mensalidade renovada por +30 dias! ✅");
          await carregarPainelAdmin();
        } else {
          mostrarToast(dados.erro || "Erro ao renovar.", "erro");
        }
      } else if (acao === "plano") {
        const novoPlano = btn.dataset.plano;
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plano: novoPlano })
        });
        if (resp.ok) {
          mostrarToast(`Plano alterado para ${novoPlano.toUpperCase()}!`);
          await carregarPainelAdmin();
        }
      } else if (acao === "toggle") {
        const ativo = btn.dataset.ativo === "1";
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ativo })
        });
        if (resp.ok) {
          mostrarToast(ativo ? "Cliente reativado! ▶️" : "Cliente suspenso e WhatsApp desconectado! ⏸️");
          await carregarPainelAdmin();
        }
      } else if (acao === "senha") {
        const novaSenha = prompt("Digite a nova senha inicial para o cliente (mín. 8 caracteres):");
        if (!novaSenha) return;
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}/resetar-senha`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ novaSenha })
        });
        const dados = await resp.json().catch(() => ({}));
        if (resp.ok && dados.ok) {
          mostrarToast("Senha redefinida! O cliente precisará trocar ao entrar. 🔑");
        } else {
          mostrarToast(dados.erro || "Senha inválida.", "erro");
        }
      } else if (acao === "excluir") {
        const nome = btn.dataset.nome || id;
        if (!confirm(`Excluir permanentemente o cliente "${nome}" e todos os dados/agendamentos dele?`)) return;
        const resp = await fetch(`/api/admin/clientes/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (resp.ok) {
          mostrarToast("Cliente removido!");
          await carregarPainelAdmin();
        }
      }
    });
  });
})();
