@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "server.py"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\server.ps1"
)
if errorlevel 1 (
  echo.
  echo MorseTalk could not start. Close any other running MorseTalk window.
  echo For setup instructions, open README.md or START-HERE.html.
  pause
)
endlocal
