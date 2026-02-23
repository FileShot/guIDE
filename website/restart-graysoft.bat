@echo off
echo =============================================================
echo  Restarting graysoft.dev (graysoft PM2 process)
echo =============================================================
echo.
echo Re-reading .env.local and applying to process...
cd /d "C:\Users\brend\IDE\website"
pm2 restart ecosystem.config.js --update-env
echo.
echo Done. OAuth credentials and all .env.local vars are live.
echo Use THIS script every time — not "pm2 restart graysoft" / "pm2 restart 9"
echo Those commands do NOT re-read .env.local.
