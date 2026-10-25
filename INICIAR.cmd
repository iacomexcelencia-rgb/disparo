@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Execute npm ci antes de abrir o aplicativo.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 exit /b 1
)
call npm run desktop
