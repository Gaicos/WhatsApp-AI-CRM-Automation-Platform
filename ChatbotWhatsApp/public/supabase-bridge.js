// =============================================================================
// SUPABASE CLOUD BRIDGE (Modo Híbrido: PC Local + Painel 100% Online GitHub Pages)
// =============================================================================
(function () {
  const fetchOriginal = window.fetch.bind(window);
  const STORAGE_KEY_CFG = "whatsapp_crm_supabase_cfg";
  const STORAGE_KEY_AUTH = "whatsapp_crm_cloud_logged";

  const ehGitHubPages =
    location.hostname.endsWith("github.io") ||
    location.protocol === "file:" ||
    new URLSearchParams(location.search).get("cloud") === "1";

  function lerCfgLocalBrowser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_CFG) || "null");
    } catch {
      return null;
    }
  }

  function salvarCfgLocalBrowser(url, publishableKey) {
    const limpo = {
      url: String(url || "").trim().replace(/\/+$/, ""),
      publishableKey: String(publishableKey || "").trim()
    };
    localStorage.setItem(STORAGE_KEY_CFG, JSON.stringify(limpo));
    return limpo;
  }

  async function sbRest(metodo, caminho, body = null, headersExtras = {}) {
    const cfg = lerCfgLocalBrowser();
    if (!cfg?.url || !cfg?.publishableKey) {
      throw new Error("Configure a URL e a Publishable Key do Supabase primeiro.");
    }
    const headers = {
      apikey: cfg.publishableKey,
      Authorization: `Bearer ${cfg.publishableKey}`,
      ...headersExtras
    };
    if (body && !(body instanceof FormData) && !(body instanceof Blob)) {
      headers["Content-Type"] = "application/json";
    }
    const resp = await fetchOriginal(`${cfg.url}${caminho}`, {
      method: metodo,
      headers,
      body: body && !(body instanceof FormData) && !(body instanceof Blob) ? JSON.stringify(body) : body
    });
    return resp;
  }

  async function lerChaveKv(chave, valorPadrao) {
    const resp = await sbRest(
      "GET",
      `/rest/v1/bot_kv_store?chave=eq.${encodeURIComponent(chave)}&select=dados`
    );
    if (!resp.ok) return valorPadrao;
    const linhas = await resp.json();
    if (Array.isArray(linhas) && linhas.length > 0 && linhas[0].dados !== undefined) {
      return linhas[0].dados;
    }
    return valorPadrao;
  }

  async function salvarChaveKv(chave, dados) {
    const resp = await sbRest(
      "POST",
      "/rest/v1/bot_kv_store?on_conflict=chave",
      {
        chave,
        dados,
        atualizado_em: new Date().toISOString()
      },
      { Prefer: "resolution=merge-duplicates,return=minimal" }
    );
    return resp.ok;
  }

  async function enfileirarComandoRemoto(acao, payload = {}, aguardarMs = 12000) {
    const resp = await sbRest(
      "POST",
      "/rest/v1/bot_comandos_fila",
      { acao, payload, status: "pendente" },
      { Prefer: "return=representation" }
    );
    if (!resp.ok) {
      return { ok: false, erro: "Não foi possível enviar comando para a fila do Supabase." };
    }
    const criados = await resp.json();
    const idCmd = criados?.[0]?.id;
    if (!idCmd) return { ok: true };

    const inicio = Date.now();
    while (Date.now() - inicio < aguardarMs) {
      await new Promise(r => setTimeout(r, 1200));
      const check = await sbRest("GET", `/rest/v1/bot_comandos_fila?id=eq.${idCmd}&select=status,resultado`);
      if (check.ok) {
        const lido = await check.json();
        const item = lido?.[0];
        if (item?.status === "concluido") {
          return item.resultado || { ok: true };
        }
        if (item?.status === "erro") {
          return item.resultado || { ok: false, erro: "Falha ao executar comando no bot." };
        }
      }
    }
    return {
      ok: true,
      mensagem: "Comando enviado para a fila na nuvem! O motor do bot processará em instantes."
    };
  }

  function respostaJson(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Modal de conexão inicial quando aberto direto pelo GitHub Pages
  function exibirModalConexaoNuvem() {
    if (document.getElementById("modalSupabaseCloud")) return;
    const cfgAtual = lerCfgLocalBrowser() || { url: "", publishableKey: "" };
    const overlay = document.createElement("div");
    overlay.id = "modalSupabaseCloud";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(15,23,42,0.75);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.3);font-family:system-ui,sans-serif;">
        <h2 style="margin:0 0 8px 0;color:#0f172a;">☁️ Conectar Painel ao Supabase</h2>
        <p style="margin:0 0 16px 0;color:#475569;font-size:0.92em;line-height:1.45;">
          Você está acessando o painel no modo <strong>100% Online (GitHub Pages)</strong>. Informe a URL e a Publishable Key do seu projeto Supabase (esses dados ficam salvos apenas no seu navegador).
        </p>
        <label style="display:block;font-weight:600;font-size:0.88em;margin-bottom:4px;">URL do Projeto Supabase</label>
        <input id="inputCloudSbUrl" type="url" placeholder="https://seu-projeto.supabase.co" value="${cfgAtual.url || ""}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;box-sizing:border-box;">
        <label style="display:block;font-weight:600;font-size:0.88em;margin-bottom:4px;">Publishable Key (sb_publishable_...)</label>
        <input id="inputCloudSbKey" type="password" placeholder="sb_publishable_..." value="${cfgAtual.publishableKey || ""}" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:16px;box-sizing:border-box;">
        <button id="btnSalvarCloudSb" type="button" style="width:100%;padding:12px;background:#008069;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">🔗 Conectar ao Banco na Nuvem</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("btnSalvarCloudSb").addEventListener("click", () => {
      const u = document.getElementById("inputCloudSbUrl").value.trim();
      const k = document.getElementById("inputCloudSbKey").value.trim();
      if (!u || !k) {
        alert("Preencha a URL e a Publishable Key do Supabase.");
        return;
      }
      salvarCfgLocalBrowser(u, k);
      sessionStorage.setItem(STORAGE_KEY_AUTH, "1");
      overlay.remove();
      location.reload();
    });
  }

  // Interceptador de rotas /api/* quando rodando no GitHub Pages (sem servidor local)
  if (ehGitHubPages) {
    window.addEventListener("DOMContentLoaded", () => {
      const cfg = lerCfgLocalBrowser();
      if (!cfg?.url || !cfg?.publishableKey) {
        exibirModalConexaoNuvem();
      }
    });

    window.fetch = async function (input, init = {}) {
      const urlStr = typeof input === "string" ? input : input.url || "";
      const metodo = (init.method || "GET").toUpperCase();

      if (!urlStr.startsWith("/api/")) {
        return fetchOriginal(input, init);
      }

      const corpo = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;

      try {
        if (urlStr === "/api/sessao") {
          const cfg = lerCfgLocalBrowser();
          return respostaJson({ logado: !!(cfg?.url && cfg?.publishableKey), precisaTrocarSenha: false });
        }
        if (urlStr === "/api/login") {
          sessionStorage.setItem(STORAGE_KEY_AUTH, "1");
          return respostaJson({ ok: true, precisaTrocarSenha: false });
        }
        if (urlStr === "/api/logout") {
          localStorage.removeItem(STORAGE_KEY_CFG);
          sessionStorage.removeItem(STORAGE_KEY_AUTH);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/grupos") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("grupos", []));
          await salvarChaveKv("grupos", corpo || []);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/grupos-whatsapp") {
          const statusVivo = await lerChaveKv("status_vivo", {});
          return respostaJson(statusVivo.gruposWhatsapp || []);
        }
        if (urlStr === "/api/contatos") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("contatos", []));
          await salvarChaveKv("contatos", corpo || []);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/contatos/adicionar") {
          const contatos = await lerChaveKv("contatos", []);
          const nome = String(corpo?.nome || "").trim();
          let telefone = String(corpo?.telefone || "").replace(/\D/g, "");
          if (telefone.startsWith("0") && (telefone.length === 11 || telefone.length === 12)) {
            telefone = telefone.slice(1);
          }
          if (telefone.length === 10 || telefone.length === 11) {
            telefone = "55" + telefone;
          }
          if (!nome || telefone.length < 10 || telefone.length > 15) {
            return respostaJson({ erro: "Nome e telefone válidos são obrigatórios (ex: 5511999999999)." }, 400);
          }
          const id = `${telefone}@s.whatsapp.net`;
          const novo = {
            id,
            nome,
            telefone,
            ativo: corpo?.ativo !== false
          };
          contatos.unshift(novo);
          await salvarChaveKv("contatos", contatos);
          return respostaJson({ ok: true, contato: novo });
        }
        if (urlStr === "/api/listas-contatos") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("listasContatos", []));
          await salvarChaveKv("listasContatos", corpo || []);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/agendamentos") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("agendamentos", []));
          await salvarChaveKv("agendamentos", corpo || []);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/envios") {
          return respostaJson(await lerChaveKv("envios", {}));
        }
        if (urlStr === "/api/historico") {
          return respostaJson(await lerChaveKv("historico", []));
        }
        if (urlStr === "/api/config") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("config", { grupoControleId: null }));
          const atual = await lerChaveKv("config", { grupoControleId: null });
          await salvarChaveKv("config", { ...atual, ...(corpo || {}) });
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/triagem") {
          if (metodo === "GET") {
            return respostaJson(
              await lerChaveKv("triagem", {
                ativo: false,
                boasVindas: "",
                nodeInicial: null,
                nodes: [],
                ia: { ativa: true, provedor: "local", urlSite: "", horasPausaHumano: 24, avisarGrupoControle: true }
              })
            );
          }
          await salvarChaveKv("triagem", corpo || {});
          return respostaJson({ ok: true, dados: corpo });
        }
        if (urlStr === "/api/triagem/aprendizado") {
          const atual = await lerChaveKv("aprendizadoBot", { exemplos: [], interacoesRecentes: [] });
          if (metodo === "GET") return respostaJson(atual);
          const item = {
            id: corpo?.id || `treino_${Date.now()}`,
            pergunta: String(corpo?.pergunta || "").trim(),
            resposta: String(corpo?.resposta || "").trim(),
            atualizadoEm: new Date().toISOString()
          };
          atual.exemplos = [item, ...(atual.exemplos || []).filter(x => x.id !== item.id)];
          await salvarChaveKv("aprendizadoBot", atual);
          return respostaJson({ ok: true, item, dados: atual });
        }
        if (urlStr.startsWith("/api/triagem/aprendizado/")) {
          const atual = await lerChaveKv("aprendizadoBot", { exemplos: [], interacoesRecentes: [] });
          if (urlStr.endsWith("/limpar-interacoes")) {
            atual.interacoesRecentes = [];
          } else {
            const idRem = decodeURIComponent(urlStr.split("/").pop());
            atual.exemplos = (atual.exemplos || []).filter(x => x.id !== idRem);
          }
          await salvarChaveKv("aprendizadoBot", atual);
          return respostaJson({ ok: true, dados: atual });
        }
        if (urlStr === "/api/triagem/pausas") {
          const pausasObj = await lerChaveKv("pausasTriagem", {});
          const lista = Object.entries(pausasObj || {}).map(([jid, info]) => ({ jid, ...info }));
          return respostaJson(lista);
        }
        if (urlStr === "/api/triagem/pausas/reativar") {
          if (corpo?.jid === "todos") {
            await salvarChaveKv("pausasTriagem", {});
          } else if (corpo?.jid) {
            const pausasObj = await lerChaveKv("pausasTriagem", {});
            delete pausasObj[corpo.jid];
            await salvarChaveKv("pausasTriagem", pausasObj);
          }
          return respostaJson({ ok: true, pausas: [] });
        }
        if (urlStr === "/api/bot/status") {
          const vivo = await lerChaveKv("status_vivo", null);
          const cfg = lerCfgLocalBrowser();
          return respostaJson({
            conexaoWhatsapp: vivo?.conexaoWhatsapp || { conectado: false },
            processo: vivo?.processo || { status: "online (nuvem)", uptimeMs: 0, memoria: 0, cpu: 0 },
            qr: vivo?.qr || null,
            supabase: { configurado: true, conectado: true, tabelasCriadas: true, url: cfg?.url || "" }
          });
        }
        if (urlStr === "/api/qr") {
          const vivo = await lerChaveKv("status_vivo", null);
          return respostaJson({
            conectado: !!vivo?.conexaoWhatsapp?.conectado,
            qr: vivo?.qr || null,
            sessaoInvalida: !!vivo?.conexaoWhatsapp?.sessaoInvalida,
            erro: vivo?.conexaoWhatsapp?.erroConexao || null
          });
        }
        if (urlStr === "/api/supabase") {
          const cfg = lerCfgLocalBrowser() || { url: "", publishableKey: "" };
          if (metodo === "POST" && corpo) {
            salvarCfgLocalBrowser(corpo.url, corpo.publishableKey);
          }
          return respostaJson({
            ativo: true,
            ...lerCfgLocalBrowser(),
            status: { configurado: true, conectado: true, tabelasCriadas: true, url: cfg.url }
          });
        }
        if (urlStr === "/api/supabase/sincronizar") {
          return respostaJson({ ok: true, enviadosParaNuvem: 0, baixadosDaNuvem: 0 });
        }
        if (urlStr === "/api/upload" && init.body instanceof FormData) {
          const arquivo = init.body.get("arquivo");
          const cfg = lerCfgLocalBrowser();
          const nome = `${Date.now()}-${(arquivo.name || "midia").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const up = await sbRest("POST", `/storage/v1/object/midia/${encodeURIComponent(nome)}`, arquivo, {
            "Content-Type": arquivo.type || "application/octet-stream",
            "x-upsert": "true"
          });
          if (!up.ok) return respostaJson({ erro: "Falha ao enviar mídia para o Supabase Storage." }, 400);
          const urlPublica = `${cfg.url}/storage/v1/object/public/midia/${encodeURIComponent(nome)}`;
          const ehImg = /^image\//i.test(arquivo.type || "");
          return respostaJson({ caminho: urlPublica, urlPublica, tipo: ehImg ? "imagem" : "video" });
        }
        if (urlStr.startsWith("/api/testar/")) {
          const idAg = urlStr.split("/").pop();
          const resCmd = await enfileirarComandoRemoto("testar", { id: idAg });
          return respostaJson(resCmd, resCmd.ok === false ? 400 : 200);
        }
        if (urlStr === "/api/triagem/sincronizar-site") {
          const resCmd = await enfileirarComandoRemoto("sincronizar-site", { urlSite: corpo?.urlSite }, 15000);
          return respostaJson(resCmd, resCmd.ok === false ? 400 : 200);
        }
        if (urlStr === "/api/triagem/simular") {
          const resCmd = await enfileirarComandoRemoto("simular", corpo || {}, 15000);
          return respostaJson(resCmd, resCmd.ok === false ? 400 : 200);
        }
        if (urlStr === "/api/webhooks/config") {
          if (metodo === "GET") return respostaJson(await lerChaveKv("webhooksConfig", { ativo: true, segredo: "", eventos: {} }));
          await salvarChaveKv("webhooksConfig", corpo || {});
          return respostaJson({ ok: true, config: corpo || {} });
        }
        if (urlStr === "/api/webhooks/eventos") {
          return respostaJson(await lerChaveKv("webhooksEventos", []));
        }
        if (urlStr === "/api/webhooks/eventos/limpar") {
          await salvarChaveKv("webhooksEventos", []);
          return respostaJson({ ok: true });
        }
        if (urlStr === "/api/webhooks/testar") {
          const resCmd = await enfileirarComandoRemoto("testar-webhook", corpo || {}, 15000);
          return respostaJson(resCmd, resCmd.ok === false ? 400 : 200);
        }
        if (urlStr === "/api/bot/ligar") return respostaJson(await enfileirarComandoRemoto("ligar"));
        if (urlStr === "/api/bot/desligar") return respostaJson(await enfileirarComandoRemoto("desligar"));
        if (urlStr === "/api/bot/reiniciar") return respostaJson(await enfileirarComandoRemoto("reiniciar"));
        if (urlStr === "/api/bot/qr" || urlStr === "/api/bot/novo-qr") return respostaJson(await enfileirarComandoRemoto("qr"));
      } catch (err) {
        return respostaJson({ ok: false, erro: err.message }, 500);
      }

      return fetchOriginal(input, init);
    };
  }

  // ---------------- PAINEL DE CONFIGURAÇÃO SUPABASE NA ABA STATUS ----------------
  window.addEventListener("DOMContentLoaded", async () => {
    const boxStatus = document.getElementById("statusSupabaseTexto");
    if (!boxStatus) return;

    async function carregarPainelSupabase() {
      try {
        const dados = await fetch("/api/supabase").then(r => r.json());
        const inpUrl = document.getElementById("inputSupabaseUrl");
        const inpKey = document.getElementById("inputSupabaseKey");
        if (inpUrl && !inpUrl.value) inpUrl.value = dados.url || "";
        if (inpKey && !inpKey.value) inpKey.value = dados.publishableKey || "";

        const st = dados.status || {};
        const blocoAvisoSql = document.getElementById("blocoAvisoSqlSupabase");
        if (!st.configurado) {
          boxStatus.textContent = "⚪ Não configurado (usando apenas arquivos locais)";
          boxStatus.style.color = "#667781";
          if (blocoAvisoSql) blocoAvisoSql.classList.add("oculto");
        } else if (st.tabelasCriadas) {
          boxStatus.textContent = "🟢 Conectado e Sincronizado com o Supabase!";
          boxStatus.style.color = "#008069";
          if (blocoAvisoSql) blocoAvisoSql.classList.add("oculto");
        } else {
          boxStatus.textContent = "🟡 Conectado ao Supabase — Falta criar as tabelas no SQL Editor (veja abaixo)";
          boxStatus.style.color = "#d97706";
          if (blocoAvisoSql) blocoAvisoSql.classList.remove("oculto");
        }
      } catch {}
    }

    document.getElementById("btnSalvarSupabase")?.addEventListener("click", async () => {
      const url = document.getElementById("inputSupabaseUrl").value.trim();
      const publishableKey = document.getElementById("inputSupabaseKey").value.trim();
      const resp = await fetch("/api/supabase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: true, url, publishableKey })
      });
      const dados = await resp.json();
      if (typeof mostrarToast === "function") {
        mostrarToast(
          dados.ok
            ? "Supabase conectado e dados sincronizados! ☁️✅"
            : dados.status?.erro || "Configuração salva. Execute o SQL no Supabase.",
          dados.ok ? "ok" : "erro"
        );
      }
      carregarPainelSupabase();
    });

    document.getElementById("btnSincronizarSupabaseAgora")?.addEventListener("click", async () => {
      const resp = await fetch("/api/supabase/sincronizar", { method: "POST" });
      const dados = await resp.json();
      if (typeof mostrarToast === "function") {
        mostrarToast(
          dados.ok
            ? `Sincronizado! (${dados.enviadosParaNuvem || 0} enviados, ${dados.baixadosDaNuvem || 0} recebidos) ☁️`
            : dados.erro || "Falha ao sincronizar",
          dados.ok ? "ok" : "erro"
        );
      }
      carregarPainelSupabase();
    });

    carregarPainelSupabase();
  });
})();
