@echo off
title guIDE Server
echo Killing anything on port 3200...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3200 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo Starting guIDE server...
cd /d C:\Users\brend\IDE
node server.js
pause
