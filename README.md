# 🤖 WhatsApp AI CRM & Automation Platform

Plataforma completa de **Atendimento Inteligente com IA**, **Aprendizado Contínuo (Active Learning)**, **Transbordo para Atendente Humano** e **Automação de Campanhas e Agendamentos no WhatsApp**, controlada 100% por um **Painel Web Moderno** e executada silenciosamente na **Bandeja do Windows (System Tray)** — sem precisar deixar janelas de terminal abertas.

---

## ✨ Visão Geral do Sistema (Para Quem Nunca Usou)

Imagine ter um assistente virtual trabalhando 24 horas por dia no seu WhatsApp que:
1. **Lê o seu site sozinho:** Você digita o endereço do seu site e o bot varre as páginas para aprender seus produtos, serviços, preços e links.
2. **Aprende com você aos poucos (Aprendizado Contínuo):** Se o bot responder algo grande demais ou diferente do seu gosto, você edita a resposta no painel e clica em **"🧠 Ensinar ao Bot"**. Da próxima vez que qualquer cliente fizer uma pergunta parecida, ele responderá exatamente do seu jeito curto e dinâmico!
3. **Sabe segredos e regras internas da sua empresa:** Possui uma área exclusiva para você escrever informações que não estão no site (prazos internos, regras de desconto, detalhes técnicos).
4. **Chama um atendente humano quando necessário:** Se o cliente digitar `atendente` ou pedir ajuda humana, o bot avisa o cliente, **pausa as respostas automáticas para aquele número** (para não atrapalhar sua conversa) e envia um alerta no seu grupo de controle com o link direto para clicar e atender.
5. **Dispara campanhas e agendamentos automáticos:** Envia textos, fotos, vídeos e álbuns para múltiplos grupos, contatos individuais ou listas VIP nos horários programados (todos os dias, dia sim/dia não, ou a cada *N* dias).
6. **Fica escondido perto do relógio do Windows:** Nada de telas pretas de CMD ou PowerShell ocupando sua barra de tarefas. O sistema roda em segundo plano no ícone ao lado do relógio do Windows.

---

## 🖥️ Como Iniciar e Fazer o Primeiro Acesso (Passo a Passo para Leigos)

### Pré-requisito
- Ter o **[Node.js](https://nodejs.org/) (versão 20 ou superior)** instalado no seu computador com Windows.

### Passo 1: Instalar na primeira vez
1. Entre na pasta `ChatbotWhatsApp`.
2. Na primeira vez que baixar o projeto, abra o terminal na pasta `ChatbotWhatsApp` e instale as dependências:
   ```bash
   npm install
   ```
   *(Ou execute o instalador `Instalar-Primeira-Execucao.ps1`).*

### Passo 2: Ligar o Bot
1. Dê **dois cliques** no arquivo **`Iniciar-Painel.bat`** (ou diretamente em **`GaicosBot.exe`**).
2. O programa iniciará silenciosamente e criará um **ícone verde na Bandeja do Windows** (na setinha `^` perto do relógio, no canto inferior direito da tela).
3. O painel abrirá no seu navegador no endereço:
   👉 **`http://localhost:3000`**

### Passo 3: Fazer Login no Painel
No seu primeiro acesso, o sistema cria automaticamente um usuário padrão:
- **Usuário:** `ADMIN`
- **Senha inicial:** `123`

> 🔒 **Segurança:** Assim que você entrar com a senha `123`, o sistema pedirá para você escolher uma **nova senha pessoal forte** (mínimo de 8 caracteres). Sua senha nunca é salva em texto puro — ela é criptografada com `scrypt` e `salt` aleatório.

### Passo 4: Conectar seu WhatsApp (QR Code)
1. Após fazer login, se o seu WhatsApp ainda não estiver conectado, a tela exibirá um **QR Code**.
2. Abra o WhatsApp no seu celular ➡️ **Aparelhos conectados** ➡️ **Conectar um aparelho** e aponte a câmera para o QR Code da tela.
3. Pronto! O painel abrirá automaticamente assim que a conexão for confirmada.

---

## 🧭 Guia Detalhado de Cada Funcionalidade (Como Usar e Como Funciona)

### 1. 🖱️ Ícone na Bandeja do Windows (System Tray)
**Para que serve:** Evitar que janelas de comando fiquem abertas na sua tela ou sejam fechadas por acidente.
- **Clique Esquerdo no ícone (perto do relógio):** Mostra ou esconde a janela do console do bot (útil se você quiser ver os registros técnicos em tempo real).
- **Clique Direito no ícone:** Abre um menu rápido com 4 opções:
  - 🌐 **Abrir Painel no Navegador:** Abre `http://localhost:3000` imediatamente.
  - 🖥️ **Mostrar / Ocultar Terminal:** Exibe ou recolhe a janela de logs.
  - 🔄 **Reiniciar Bot:** Reinicia o servidor Node.js automaticamente.
  - 🛑 **Encerrar Bot:** Desliga completamente o robô e fecha o ícone.
- **Como funciona por trás:** O executável nativo `GaicosBot.exe` (compilado em C# `.NET` como aplicação `winexe` sem janela de console) gerencia o processo `node.exe server.js` de forma invisível, libera automaticamente a porta `3000` caso haja algum processo antigo travado e redireciona os logs para uma interface escura própria.

---

### 2. 📅 Aba "Agendamentos" (Disparos Automáticos para Grupos e Contatos)
**Para que serve:** Programar postagens automáticas (promoções, avisos, bom dia, conteúdos) para grupos e clientes sem precisar enviar manualmente.

#### Como usar:
1. **Gerenciar Grupos:** Clique na barra **"👥 Gerenciar grupos"** ➡️ clique em **"🔄 Buscar grupos do WhatsApp"**. Todos os grupos da sua conta aparecerão na tela. Adicione os grupos desejados e marque como **Ativo**.
2. **Gerenciar Contatos e Listas:** Em **"📱 Gerenciar contatos"**, cadastre números individuais (com DDI + DDD, ex: `5511999999999`). Em **"📋 Listas de contatos"**, você pode agrupar contatos (ex: *Clientes VIP*, *Fornecedores*) para selecioná-los de uma só vez.
3. **Criar um Agendamento:**
   - Clique em **"+ Novo agendamento"**.
   - Escolha o **Horário** (ex: `09:00`).
   - Escolha a **Repetição**:
     - *Todo dia* (a cada 1 dia)
     - *Dia sim, dia não* (a cada 2 dias)
     - *A cada N dias...* (personalizado, de 2 a 365 dias)
   - Escolha a data **"Começa em"** (permite agendar campanhas que só começam na semana que vem, por exemplo).
   - Digite o **Texto** da mensagem e anexe **Fotos ou Vídeos** (se anexar várias fotos/vídeos, o bot envia como álbum do WhatsApp).
   - Marque quais **Grupos**, **Contatos** ou **Listas** receberão a mensagem e clique em **Salvar**.
4. **Visualizar e Testar:** Clicando em qualquer cartão de agendamento, você vê uma **prévia idêntica à bolha do WhatsApp** e pode clicar em **"🚀 Testar agora"** para disparar imediatamente.

#### Como funciona por trás:
- O agendador (`scheduler/scheduler.js`) verifica a fila a cada 20 segundos.
- O módulo `recorrenciaService.js` calcula a diferença exata de dias no fuso horário local entre a data de início e a data atual, garantindo que agendamentos "dia sim, dia não" ou "a cada N dias" nunca disparem duplicados no mesmo dia.
- Entre o envio de um grupo/contato e outro, o bot aguarda um **intervalo aleatório de 8 a 20 segundos** (`delayAleatorio`) para simular o comportamento humano e proteger seu número contra bloqueios do WhatsApp.

---

### 3. 🧭 Aba "Triagem & IA do Site" (Atendimento Automático Inteligente)
**Para que serve:** Atender automaticamente clientes que mandam mensagem no privado do seu WhatsApp (tanto contas normais quanto WhatsApp Business), respondendo dúvidas com textos curtos, dinâmicos e naturais.

#### A) 🧪 Simulador & Treinamento Rápido
- Antes mesmo de ligar o atendimento no WhatsApp, você pode digitar qualquer pergunta no **Simulador** (ex: *"Oi, quais são as formas de pagamento?"*) e clicar em **"🚀 Testar Resposta"**.
- Se você achar que a resposta pode ficar ainda melhor ou mais curta, basta editar o texto na caixa que aparece logo abaixo e clicar em **"🧠 Ensinar ao Bot"**.

#### B) 🧠 Aprendizado Contínuo do Bot (Machine Learning / Active Learning)
- **Ensinar novas respostas:** Você pode cadastrar perguntas/situações (separando variações com `|`, ex: `tem desconto no pix | faz mais barato | tem cupom`) e definir a resposta curta exata que o bot deve dar.
- **Adequar conversas reais:** Na seção **"💬 Últimas Perguntas dos Clientes"**, o painel mostra o que seus clientes reais perguntaram no WhatsApp e o que o bot respondeu. Clicando no botão **"🎯 Adequar"**, você corrige a resposta e o bot nunca mais esquece!
- **Como funciona por trás:** Quando um cliente manda mensagem, o motor `iaAtendimentoService.js` primeiro normaliza o texto (remove acentos, pontuação e *stop words*) e calcula um **índice de similaridade por tokens e substrings** contra a sua base de aprendizado (`aprendizadoBot.json`). Se encontrar uma situação que você já ensinou, responde instantaneamente do seu jeito; além disso, envia seus exemplos treinados como *Few-Shot Learning* para a IA seguir exatamente o seu estilo curto de escrita.

#### C) 🌐 Leitura Automática do Site + Motores de IA
- **URL do seu site:** Digite o endereço do seu site e clique em **"🔄 Ler / Atualizar Site Agora"**. O módulo `siteKnowledgeService.js` acessa a página inicial e as principais subpáginas internas do seu domínio, extrai títulos, descrições, preços e links, e monta a base de conhecimento automaticamente.
- **Motores disponíveis:**
  - ⚡ **Modo Inteligente Local (Gratuito / Sem Chave):** Funciona imediatamente sem precisar de conta em nenhuma IA externa, cruzando as palavras da pergunta do cliente com os dados do seu site, suas informações exclusivas e seu aprendizado.
  - ✨ **Google Gemini (`gemini-2.5-flash`):** Basta colar sua chave gratuita do Google AI Studio.
  - 🚀 **Groq (`llama-3.3-70b-versatile`):** Respostas ultra-rápidas usando chave gratuita da Groq.
  - 🤖 **OpenAI (`gpt-4o-mini`):** Integração oficial com a API do ChatGPT.
- **🔑 Informações Exclusivas que Só Você Sabe:** Um campo dedicado para regras internas que não estão escritas no site (ex: prazo de produção, regras de troca, horário de expediente). Essas informações têm prioridade máxima na resposta e **nunca são apagadas** quando você clica em atualizar o site.

#### D) 👤 Opção de Falar com Atendente Humano (Transbordo Inteligente)
- **Como o cliente chama um humano:** Basta o cliente digitar `atendente`, `humano`, `0` ou frases como *"quero falar com um atendente"* / *"falar com uma pessoa"*.
- **O que acontece automaticamente:**
  1. O bot envia sua mensagem personalizada de transferência (ex: *"Já chamei um atendente humano para falar com você! Aguarde só um instante."*).
  2. O bot **pausa o atendimento automático para aquele cliente** pelo tempo configurado (ex: 24 horas), permitindo que você converse livremente com o cliente sem o robô interromper.
  3. O bot envia um **alerta no seu Grupo de Controle** com o nome do cliente, a última mensagem dele e o link `https://wa.me/...` para você abrir a conversa com 1 clique.
- **Comandos rápidos direto pelo celular:**
  - Se você estiver conversando com um cliente pelo celular e quiser pausar o robô naquela conversa, envie `#pausar` ou marque a opção *"Pausar o robô automaticamente se eu responder o cliente pelo celular"*.
  - Para devolver o cliente para o robô a qualquer momento, clique em **"▶️ Reativar Bot"** no painel ou envie `#bot` no chat.

#### E) 🧭 Menu Numerado Opcional (1, 2, 3...)
- Se além da conversa livre com IA você quiser exibir um menu clássico numerado (`1. Ver Produtos`, `2. Prazos e Entrega`, `3. Falar com Atendente`), basta criar as perguntas na seção **"Menu de opções numeradas"** ao final da aba Triagem. Ele funciona em conjunto com a IA!

---

### 4. ⚙️ Aba "Status do Sistema" e Controle Remoto pelo WhatsApp
**Para que serve:** Acompanhar a saúde do bot, ver o histórico completo de disparos e controlar o robô pelo próprio celular.
- **Controles de Conexão:** Botões para Ligar, Desligar, Reiniciar o programa, Encerrar ou Desconectar o aparelho atual para ler outro QR Code.
- **🎛️ Grupo de Controle Remoto:** Você pode escolher um grupo seu no WhatsApp (ex: um grupo só com você e sua equipe) para controlar o bot à distância enviando comandos:
  - `!status` — Mostra se o WhatsApp está conectado, tempo no ar (uptime) e uso de memória.
  - `!historico` — Lista os últimos 10 envios realizados (com data, destino e se deu certo ou falhou).
  - `!agendamentos` — Lista todos os agendamentos cadastrados e ativos.
  - `!restart` — Reinicia o bot remotamente pelo celular.
  - `!ajuda` — Mostra a lista de comandos disponíveis.

---

## 🗂️ Arquitetura do Projeto

```text
ChatbotWhatsApp/
├── GaicosBot.cs / GaicosBot.exe   # Host nativo Windows (C# WinForms System Tray + Console oculto)
├── Iniciar-Painel.bat             # Atalho de inicialização rápida sem janelas de comando
├── server.js                      # Servidor HTTP Express + Rotas REST + Autenticação
├── resetar-senha.js               # Utilitário para restaurar login padrão (ADMIN / 123)
├── public/                        # Interface Web (SPA em HTML5, CSS3 e JavaScript puro)
│   ├── index.html                 # Painel principal (Agendamentos, Triagem & IA, Status)
│   ├── app.js                     # Lógica de agendamentos, grupos, contatos e status
│   ├── triagem.js                 # Lógica de IA, simulador, aprendizado contínuo e pausas
│   ├── login.html                 # Tela de login com proteção contra força bruta
│   ├── trocar-senha.html          # Troca obrigatória de senha no primeiro acesso
│   └── conectar.html              # Leitura de QR Code em tempo real
├── services/                      # Camada de Regras de Negócio e Persistência Atômica
│   ├── authService.js             # Hash scrypt, sessões por cookie HttpOnly e rate-limiting
│   ├── configService.js           # Leitura/escrita de grupos, contatos, listas e histórico
│   ├── destinosService.js         # Resolução e desduplicação de destinatários de campanhas
│   ├── iaAtendimentoService.js    # Motor Multi-LLM (Gemini/Groq/OpenAI) + Similaridade Local
│   ├── siteKnowledgeService.js    # Web Crawler automático para leitura de sites
│   ├── triagemService.js          # Orquestrador de atendimento privado (@s.whatsapp.net e @lid)
│   └── recorrenciaService.js      # Cálculo matemático de ciclos de repetição de envios
├── scheduler/
│   └── scheduler.js               # Motor de verificação e disparo de agendamentos
├── whatsapp/
│   └── whatsappService.js         # Integração WhatsApp Multi-Device (@itsliaaa/baileys)
└── tests/                         # Testes automatizados nativos (Autenticação, Recorrência, Triagem)
```

---

## 🔒 Privacidade e Segurança de Dados
Este repositório está configurado com `.gitignore` estrito para garantir que **nenhum dado sensível ou pessoal** seja compartilhado:
- As pastas `auth_info/` (chaves de sessão do WhatsApp), `data/*` (senhas, agendamentos, contatos, grupos e treinamentos locais) e `midia/*` (arquivos de imagem/vídeo) são ignoradas pelo Git.
- Ao clonar o projeto em uma nova máquina, o sistema cria automaticamente a estrutura limpa na pasta `data/` com o usuário inicial `ADMIN` e senha `123`.

### 🔑 Esqueci minha senha do painel, como recuperar?
Caso você esqueça a senha que cadastrou no painel, basta dar dois cliques no arquivo **`Resetar-Senha.bat`** (ou rodar `node resetar-senha.js` na pasta `ChatbotWhatsApp`). O acesso voltará imediatamente para o usuário `ADMIN` e senha `123`.

---

## 🧪 Executando os Testes Automatizados

Para rodar a suíte de testes unitários (autenticação, cálculo de recorrência e validação de fluxos de triagem):

```bash
cd ChatbotWhatsApp
node tests/auth.test.mjs
node tests/recorrencia.test.mjs
node tests/triagem.test.mjs
```
