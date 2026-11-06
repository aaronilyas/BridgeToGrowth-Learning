@echo off
rem Builds the BridgeToGrowth Learning desktop app for this Windows computer.
rem Usage: double-click make-app.cmd, or run it from a terminal.  Output: artifacts\
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is required but was not found.
  echo Run install.cmd instead: it installs Bun and the other prerequisites, then builds the app.
  pause
  exit /b 1
)

call bun install --frozen-lockfile || goto :failed
call bun scripts/make-app.ts || goto :failed
pause
exit /b 0

:failed
echo Build failed. See the messages above.
pause
exit /b 1
