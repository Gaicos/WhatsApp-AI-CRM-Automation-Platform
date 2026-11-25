@echo off
title Encerrar Gaicos Bot
cd /d "%~dp0"

echo ======================================================
echo           ENCERRANDO GAICOS BOT
echo ======================================================
echo.
echo Finalizando processos do Bot...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
  taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /FI "WINDOWTITLE eq Gaicos Bot*" >nul 2>&1

echo.
echo [OK] O Gaicos Bot foi encerrado com sucesso!
timeout /t 2 >nul
exit
