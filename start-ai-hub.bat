@echo off
chcp 65001 >nul
title AI Hub Service Manager
color 0A

echo ========================================
echo      AI Hub Quick Start Script
echo ========================================
echo.
echo  Port Assignment:
echo    - Server (Backend): 3007
echo    - Client (Frontend): 3005
echo.
echo ========================================
echo.

cd /d "%~dp0"

echo [%time%] Starting Backend Service (Port 3007)...
start "AI-Hub Server" cmd /k "cd /d %~dp0server && npm run dev"

echo [%time%] Starting Frontend Service (Port 3005)...
start "AI-Hub Client" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo ========================================
echo  All Services Started!
echo.
echo  Access URLs:
echo    Frontend: http://localhost:3005
echo    Backend:  http://localhost:3007
echo ========================================
echo.
echo  Tip: Close window to stop corresponding service
echo.
pause