@echo off
cd /d "%~dp0"
set UV_THREADPOOL_SIZE=32
start "" /b node server.js
timeout /t 1 >nul
start "" msedge --app=http://127.0.0.1:5731 --window-size=1280,820
