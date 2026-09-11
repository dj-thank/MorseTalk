@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ and Android Studio with SDK 35 are required. See docs/BUILD-ANDROID.md.
  pause
  exit /b 1
)
py -3 tools\build_android.py
pause
