function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function provedorEmailConfigurado() {
  if ((process.env.BREVO_API_KEY || "").trim()) return "brevo";
  if ((process.env.RESEND_API_KEY || "").trim()) return "resend";
  return null;
}

function montarConteudoEmail({ nome, codigo, linkVerificacao, codigoUnico }) {
  const nomeSafe = escapeHtml(nome || "cliente");
  const codigoSafe = escapeHtml(codigo);
  const linkSafe = escapeHtml(linkVerificacao);
  const codigoUnicoSafe = escapeHtml(codigoUnico);

  const assunto = `Confirme seu e-mail (${codigo}) — Conta DEMO WhatsApp Automation`;

  const texto = [
    `Olá, ${nome || "cliente"}!`,
    ``,
    `Seu cadastro na conta DEMO (Teste Gratuito por 7 dias) foi criado com sucesso.`,
    `Seu código único de usuário é: ${codigoUnico}`,
    ``,
    `Para validar seu e-mail e fazer o primeiro login, escolha uma das opções abaixo:`,
    `1) Digite este código na tela de confirmação: ${codigo}`,
    `2) Ou clique diretamente neste link: ${linkVerificacao}`,
    ``,
    `Este código expira em 30 minutos.`
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;color:#0f172a;">
      <h2 style="margin-top:0;color:#075E54;">Confirme seu e-mail</h2>
      <p>Olá, <strong>${nomeSafe}</strong>!</p>
      <p>Sua conta <strong>DEMO (Teste Gratuito de 7 dias)</strong> foi criada. Seu código único de identificação é <strong>${codigoUnicoSafe}</strong>.</p>
      <div style="background:#f8fafc;border:1px dashed #94a3b8;border-radius:10px;padding:16px;text-align:center;margin:18px 0;">
        <div style="font-size:12px;color:#475569;margin-bottom:6px;">Código de validação do primeiro login</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#075E54;">${codigoSafe}</div>
      </div>
      <p style="text-align:center;margin:20px 0;">
        <a href="${linkSafe}" style="display:inline-block;background:#075E54;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Validar e Entrar Agora</a>
      </p>
      <p style="font-size:12px;color:#64748b;">Aviso: Esta é uma conta DEMO limitada para testes. O código expira em 30 minutos.</p>
    </div>
  `;

  return { assunto, texto, html };
}

export async function enviarEmailVerificacao({ para, nome, codigo, linkVerificacao, codigoUnico }) {
  const provedor = provedorEmailConfigurado();
  if (!provedor) {
    return {
      enviado: false,
      motivo: "Provedor de e-mail não configurado no servidor (BREVO_API_KEY ou RESEND_API_KEY)."
    };
  }

  const remetenteEmail = (process.env.EMAIL_FROM || "").trim() || "noreply@gaicos-bot.local";
  const remetenteNome = (process.env.EMAIL_FROM_NAME || "WhatsApp Automation").trim();
  const { assunto, texto, html } = montarConteudoEmail({ nome, codigo, linkVerificacao, codigoUnico });

  if (provedor === "brevo") {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY.trim()
      },
      body: JSON.stringify({
        sender: { name: remetenteNome, email: remetenteEmail },
        to: [{ email: para, name: nome || para }],
        subject: assunto,
        htmlContent: html,
        textContent: texto
      })
    });
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      throw new Error(`Falha ao enviar e-mail via Brevo (${resp.status}): ${errTxt.slice(0, 150)}`);
    }
    return { enviado: true, provedor: "brevo" };
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`
    },
    body: JSON.stringify({
      from: `${remetenteNome} <${remetenteEmail}>`,
      to: [para],
      subject: assunto,
      html,
      text: texto
    })
  });

  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => "");
    throw new Error(`Falha ao enviar e-mail via Resend (${resp.status}): ${errTxt.slice(0, 150)}`);
  }
  return { enviado: true, provedor: "resend" };
}
