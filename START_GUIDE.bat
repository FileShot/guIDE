@echo off
title guIDE - AI-Powered Offline IDE
echo.
echo   ============================================
echo      guIDE - AI-Powered Offline IDE
echo   ============================================
echo      Local LLM . RAG . MCP Tools . Browser
echo      Your code, your models, your machine.
echo   ============================================
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    echo         After installing, restart your computer and try again.
    pause
    exit /b 1
)

:: Show Node.js version
for /f "tokens=*" %%v in ('node --version') do echo [INFO] Node.js %%v detected

:: Kill zombie Vite/Electron processes from previous runs on port 5174
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":5174" ^| findstr "LISTEN"') do (
    echo [INFO] Killing zombie process on port 5174 (PID %%p)...
    taskkill /F /PID %%p >nul 2>&1
)

:: Check dependencies
if not exist "node_modules" (
    echo.
    echo [1/3] Installing dependencies (first run — this takes 2-5 minutes)...
    call npm.cmd install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Failed to install dependencies.
        echo         Make sure Visual C++ Build Tools are installed:
        echo         https://visualstudio.microsoft.com/visual-cpp-build-tools/
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies already installed.
)

:: Check for GGUF model
set "MODEL_FOUND=0"
for %%f in (*.gguf) do set "MODEL_FOUND=1"
if exist "models" (
    for %%f in (models\*.gguf) do set "MODEL_FOUND=1"
)
if "%MODEL_FOUND%"=="0" (
    echo.
    echo [WARNING] No .gguf model found!
    echo Place a .gguf model file in the project root or models/ directory.
    echo Recommended: Qwen 2.5 Coder 7B Q4_K_M
    echo.
)

echo.
echo [2/3] Starting guIDE...
echo.

:: Use the robust launcher script
node scripts/launch.js
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] guIDE failed to start.
    echo Check the error messages above for details.
    echo.
    pause
    exit /b 1
)

echo.
echo [3/3] guIDE is running!
echo.
pause
