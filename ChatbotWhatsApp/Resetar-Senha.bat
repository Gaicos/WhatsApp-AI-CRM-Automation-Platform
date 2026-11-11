@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   Restaurar usuario e senha do painel
echo ================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar-Primeira-Execucao.ps1" -ResetarSenha
pause
