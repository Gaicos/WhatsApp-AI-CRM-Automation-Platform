# 🔗 Documentação do Webhook de Integração com o Site

Este documento explica como o backend/site da loja deve enviar notificações em tempo real para o **WhatsApp AI CRM & Automation Platform** rodando 24h na nuvem.

---

## 1. Endpoints Disponíveis

Substitua `SUA_URL_DO_SERVIDOR` pela URL publicada do serviço no Render (ex.: `https://whatsapp-ai-crm-worker.onrender.com`):

- **Teste de Conexão (Ping):** `GET https://SUA_URL_DO_SERVIDOR/api/webhook/ping`
- **Receber Eventos do Site:** `POST https://SUA_URL_DO_SERVIDOR/api/webhook/site`

---

## 2. Autenticação

Toda chamada precisa enviar o **Token Secreto** gerado na aba **🔗 Integração Site** do painel administrativo (ou definido na variável de ambiente `WEBHOOK_SECRET`).

Formas aceitas (recomendado o header `X-Webhook-Secret`):
- Header `X-Webhook-Secret: <SEU_TOKEN>` *(recomendado)*
- Header `Authorization: Bearer <SEU_TOKEN>`
- Query string `?secret=<SEU_TOKEN>`

Se o token estiver ausente ou inválido, a API responde `401 Unauthorized`.

---

## 3. Eventos Suportados e Aliases

Os templates de cada evento podem ser editados livremente no painel na aba **🔗 Integração Site**.

| Evento Padrão | Aliases Aceitos (Inglês/PT) | Quando Usar |
| :--- | :--- | :--- |
| `pedido_criado` | `order_created`, `order_pending`, `pedido_pendente`, `novo_pedido` | Pedido recém-criado / aguardando pagamento |
| `pedido_pago` | `order_paid`, `payment_approved`, `pagamento_aprovado`, `pago` | Pagamento aprovado / confirmado |
| `pedido_producao` | `order_in_production`, `em_producao`, `producao` | Pedido entrou em produção / separação |
| `pedido_enviado` | `order_shipped`, `shipping_updated`, `enviado`, `rastreio` | Pedido despachado com código de rastreio |
| `pedido_entregue` | `order_delivered`, `entregue` | Pedido entregue ao cliente |
| `pedido_cancelado` | `order_canceled`, `order_cancelled`, `cancelado` | Pedido cancelado |
| `carrinho_abandonado` | `cart_abandoned`, `abandoned_cart` | Carrinho abandonado no checkout |
| `novo_contato` | `contact`, `lead`, `quote`, `orcamento`, `formulario` | Formulário de contato ou orçamento no site |
| `mensagem` | `message`, `custom`, `mensagem_livre` | Envio de texto livre (+ mídia opcional) definido pelo site |

> **Dica:** Eventos desconhecidos que tragam o campo `mensagem` são automaticamente processados usando o modelo `mensagem`.

---

## 4. Campos do JSON (`POST /api/webhook/site`)

Todos os campos abaixo são opcionais individualmente (exceto `telefone`, que é obrigatório sempre que você quiser notificar o cliente no WhatsApp; para alertas internos apenas no Grupo de Controle, `telefone` pode ser omitido). Formatos aninhados (`cliente: { nome, telefone }`, `order: { id, total }`) e nomes em inglês também são aceitos automaticamente.

| Campo | Alias Aceitos | Exemplo | Observações |
| :--- | :--- | :--- | :--- |
| `evento` | `event`, `tipo`, `type` | `"pedido_pago"` | Padrão: `"mensagem"` |
| `telefone` | `phone`, `whatsapp`, `celular` | `"5511999999999"` | Aceita com/sem `+`, máscara ou `55` na frente (números BR 10–11 dígitos recebem `55` automático) |
| `nome` | `name` | `"João Silva"` | Nome do cliente (preenche `{{nome}}`) |
| `pedido` | `orderId`, `order_id`, `numeroPedido` | `"1042"` | Código/número do pedido (`{{pedido}}`) |
| `valor` | `total`, `amount` | `149.90` ou `"149,90"` | Formatado automaticamente em `R$` (`{{valor}}`) |
| `status` | — | `"pago"` | Texto de status (`{{status}}`) |
| `rastreio` | `tracking`, `trackingCode`, `codigoRastreio` | `"BR123456789BR"` | Código de rastreio (`{{rastreio}}`) |
| `link` | `url`, `checkoutUrl` | `"https://..."` | URL do pedido ou carrinho (`{{link}}`) |
| `produtos` | `itens`, `items` | `["Playmat", {"nome": "Deck Box", "quantidade": 2}]` | Array ou string (`{{produtos}}`) |
| `mensagem` | `message`, `texto`, `text` | `"Seu pedido está pronto!"` | Texto livre (`{{mensagem}}`) |
| `midiaUrl` | `mediaUrl`, `imagemUrl`, `imageUrl` | `"https://.../foto.jpg"` | URL pública opcional de imagem ou vídeo |
| `tipoMidia` | `mediaType` | `"imagem"` ou `"video"` | Padrão: `"imagem"` |
| `avisarGrupo` | — | `true` / `false` | Opcional: sobrescreve a regra do painel para avisar o Grupo de Controle |

---

## 5. Exemplos de Implementação

### cURL (Terminal / Teste)

```bash
curl -X POST "https://SUA_URL_DO_SERVIDOR/api/webhook/site" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: SEU_TOKEN_DO_PAINEL" \
  -d '{
    "evento": "pedido_pago",
    "telefone": "5511999999999",
    "nome": "João Silva",
    "pedido": "1042",
    "valor": 149.90,
    "link": "https://www.gaicos-store.com.br/pedido/1042",
    "produtos": [
      { "nome": "Playmat Personalizado", "quantidade": 1 }
    ]
  }'
```

### Node.js (`fetch` nativo)

```javascript
async function notificarWhatsappBot(payload) {
  const resp = await fetch("https://SUA_URL_DO_SERVIDOR/api/webhook/site", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": process.env.BOT_WEBHOOK_SECRET
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.erro || `HTTP ${resp.status}`);
  }

  return resp.json();
}
```

### PHP (`cURL`)

```php
<?php
function notificarWhatsappBot(array $payload, string $token): array {
    $ch = curl_init("https://SUA_URL_DO_SERVIDOR/api/webhook/site");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "X-Webhook-Secret: " . $token
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE)
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [
        "status" => $httpCode,
        "body" => json_decode($response ?: "{}", true)
    ];
}
```

---

## 6. Códigos de Resposta HTTP

- **`200 OK`**: Evento processado com sucesso (`ok: true`), ou ignorado intencionalmente quando desativado no painel (`ok: true, ignorado: true`).
- **`400 Bad Request`**: Faltou telefone válido e não há Grupo de Controle configurado.
- **`401 Unauthorized`**: Token `X-Webhook-Secret` ausente ou inválido.
- **`503 Service Unavailable`**: O bot está temporariamente desconectado do WhatsApp (reconectar no painel).
