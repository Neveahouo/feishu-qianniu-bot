@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   Purchase Limit Bot
echo ========================================
echo.
node index.js
pause
