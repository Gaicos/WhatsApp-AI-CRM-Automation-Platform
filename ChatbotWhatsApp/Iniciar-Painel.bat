@echo off
title Gaicos Bot - Inicializador
cd /d "%~dp0"

echo ======================================================
echo           GAICOS BOT - INICIANDO SISTEMA
echo ======================================================
echo.

:: 1. Verifica se o Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao foi encontrado no seu computador!
    echo Por favor, instale o Node.js em: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Verifica se a porta 3000 ja esta ativa
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [INFO] O Gaicos Bot ja esta em execucao!
    echo Abrindo o painel no navegador...
    start http://localhost:3000
    timeout /t 2 >nul
    exit
)

echo [1/3] Iniciando servidor do WhatsApp Bot...
start /min "Gaicos Bot (Ativo)" cmd /c "node server.js"

echo [2/3] Aguardando o servidor responder...
timeout /t 3 /nobreak >nul

echo [3/3] Abrindo painel de controle no navegador...
start http://localhost:3000

echo.
echo ======================================================
echo  Painel aberto com sucesso em http://localhost:3000 !
echo.
echo  O Bot esta em execucao (minimizado na barra de tarefas).
echo  Para ENCERRAR o Bot quando quiser, basta dar 2 cliques em:
echo  Encerrar-Bot.bat
echo ======================================================
timeout /t 3 >nul
exit
