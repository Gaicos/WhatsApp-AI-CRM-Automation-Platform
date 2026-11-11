// Tarefas de instalação feitas pelo próprio painel (sem terminal).
import fs from "fs";
import os from "os";
import path from "path";

const RAIZ = process.cwd();
const EH_WINDOWS = process.platform === "win32";
const NOME_BAT = "Iniciar Painel.bat";
const NOME_ATALHO = "Painel do Bot.url";
const NOME_INICIO = "Painel do Bot - inicio automatico.vbs";

function pastaInicializacao() {
    return path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function pastaAreaDeTrabalho() {
    const candidatos = [
        path.join(os.homedir(), "Desktop"),
        path.join(os.homedir(), "OneDrive", "Desktop"),
        path.join(os.homedir(), "Área de Trabalho"),
    ];
    return candidatos.find(p => fs.existsSync(p)) || candidatos[0];
}

function caminhoInicio() { return path.join(pastaInicializacao(), NOME_INICIO); }
function caminhoAtalho() { return path.join(pastaAreaDeTrabalho(), NOME_ATALHO); }

function versaoBiblioteca() {
    try {
        const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, "node_modules", "@itsliaaa", "baileys", "package.json"), "utf-8"));
        return pacote.version;
    } catch {
        return "desconhecida";
    }
}

export function statusInstalacao() {
    return {
        windows: EH_WINDOWS,
        inicioAutomatico: EH_WINDOWS && fs.existsSync(caminhoInicio()),
        atalhoAreaDeTrabalho: fs.existsSync(caminhoAtalho()),
        versaoBiblioteca: versaoBiblioteca(),
    };
}

function exigirWindows() {
    if (!EH_WINDOWS) throw new Error("Esta opção está disponível só no Windows.");
}

export function ativarInicioAutomatico() {
    exigirWindows();
    const bat = path.join(RAIZ, NOME_BAT);
    // Abre o Iniciar Painel.bat escondido (argumento "silencioso"), sem abrir o navegador.
    const conteudo = [
        'Set sh = CreateObject("WScript.Shell")',
        `sh.CurrentDirectory = "${RAIZ}"`,
        `sh.Run """${bat}"" silencioso", 0, False`,
        "",
    ].join("\r\n");
    fs.mkdirSync(pastaInicializacao(), { recursive: true });
    fs.writeFileSync(caminhoInicio(), conteudo);
}

export function desativarInicioAutomatico() {
    fs.rmSync(caminhoInicio(), { force: true });
}

export function criarAtalhoAreaDeTrabalho() {
    fs.mkdirSync(pastaAreaDeTrabalho(), { recursive: true });
    fs.writeFileSync(caminhoAtalho(), "[InternetShortcut]\r\nURL=http://localhost:3000\r\n");
}

export function removerAtalhoAreaDeTrabalho() {
    fs.rmSync(caminhoAtalho(), { force: true });
}

// Apaga conexão do WhatsApp, login, agendamentos, contatos, histórico e fotos.
export function apagarTodosOsDados() {
    fs.rmSync(path.join(RAIZ, "auth_info"), { recursive: true, force: true });

    const midia = path.join(RAIZ, "midia");
    if (fs.existsSync(midia)) {
        for (const arquivo of fs.readdirSync(midia)) {
            if (arquivo !== ".gitkeep") fs.rmSync(path.join(midia, arquivo), { recursive: true, force: true });
        }
    }

    const dados = path.join(RAIZ, "data");
    if (fs.existsSync(dados)) {
        for (const arquivo of fs.readdirSync(dados)) {
            fs.rmSync(path.join(dados, arquivo), { recursive: true, force: true });
        }
    }
}
