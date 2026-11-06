@echo off
rem BridgeToGrowth Learning installer for Windows: double-click this file.
rem Installs Bun and the WebView2 runtime, downloads the source if needed, and builds the app.
rem It runs install.ps1 from this folder, or downloads install.ps1 if this file was downloaded on its own.
setlocal
set "BTG_PS1=%~dp0install.ps1"

if exist "%BTG_PS1%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%BTG_PS1%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm 'https://raw.githubusercontent.com/aaronilyas/BridgeToGrowth-Learning/main/install.ps1' | iex; if ($btgFailed) { exit 1 }"
)
set "BTG_CODE=%errorlevel%"
if not "%BTG_CODE%"=="0" echo Install failed. See the messages above.
pause
exit /b %BTG_CODE%
