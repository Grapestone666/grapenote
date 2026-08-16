@echo off
echo ========================================
echo   Sticky Tasks - Build to .exe
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Cleaning up...
if exist node_modules rmdir /s /q node_modules
if exist dist rmdir /s /q dist
echo Done.
echo.

echo [2/3] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Please check Node.js is installed.
    pause
    exit /b 1
)
echo Done.
echo.

echo [3/3] Building .exe (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete! .exe is in dist folder
echo ========================================
echo.
pause
