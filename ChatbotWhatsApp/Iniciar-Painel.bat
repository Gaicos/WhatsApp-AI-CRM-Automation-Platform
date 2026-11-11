@echo off
cd /d "%~dp0"
if not exist "%~dp0GaicosBot.exe" (
  "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"%~dp0GaicosBot.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.dll "%~dp0GaicosBot.cs" >nul 2>&1
)
start "" "%~dp0GaicosBot.exe"
exit
