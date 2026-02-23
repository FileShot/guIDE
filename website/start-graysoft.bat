@echo off
echo =============================================================
echo  Starting guIDE Website (graysoft.dev) on port 3200
echo =============================================================
echo.

cd /d "C:\Users\brend\IDE\website"

rem Kill any existing process on port 3200 to prevent EADDRINUSE
echo [0/2] Freeing port 3200 if in use...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3200" ^| findstr "LISTEN"') do (
    echo       Killing PID %%p on port 3200...
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 2 /nobreak >nul

rem Start the Next.js standalone server
echo [1/2] Starting Next.js server on port 3200...
set PORT=3200
set HOSTNAME=0.0.0.0
start "guIDE-Website" cmd /k "cd /d C:\Users\brend\IDE\website\.next-ready\standalone && set PORT=3200 && set HOSTNAME=0.0.0.0&& node server.js"

timeout /t 3 /nobreak >nul

rem Start Cloudflare tunnel
echo [2/2] Starting Cloudflare tunnel for graysoft.dev...
start "guIDE-Tunnel" cmd /k "cloudflared tunnel --config C:\Users\brend\.cloudflared\graysoft-config.yml run graysoft"

echo.
echo guIDE website starting at https://graysoft.dev
echo.
