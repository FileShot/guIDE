@echo off
title guIDE Model Benchmark Runner
echo ============================================
echo   guIDE Model Benchmark Runner
echo ============================================
echo.
echo This will benchmark ALL models in D:\models
echo Results will auto-export to the website.
echo.
echo Press any key to start or Ctrl+C to cancel...
pause >nul

cd /d "%~dp0"
echo.
echo Starting benchmarks...
echo Output will be saved to: output\benchmark-results.json
echo Website data will be updated at: website\src\data\benchmarks.ts
echo.

call npx electron scripts/benchmark-all-models.js

echo.
echo ============================================
if %ERRORLEVEL% EQU 0 (
    echo Benchmarks completed successfully!
    echo Results exported to website.
) else (
    echo Benchmarks finished with errors. Check output above.
)
echo ============================================
echo.
pause
