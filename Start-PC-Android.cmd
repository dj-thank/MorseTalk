@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ and the Python Launcher are required.
  pause
  exit /b 1
)
py -3 tools\pc_android.py %*
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
