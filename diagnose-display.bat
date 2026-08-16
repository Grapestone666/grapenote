@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   GrapeNote Display Diagnostic
echo ========================================
echo.

echo [1] Current display config:
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Host ('  ' + $_.DeviceName + ': ' + $_.Bounds.Width + 'x' + $_.Bounds.Height + ' at (' + $_.Bounds.X + ',' + $_.Bounds.Y + ')' + $(if($_.Primary){' [PRIMARY]'}else{''})) }"
echo.

echo [2] Expected display key:
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $key = ([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [string]$_.Bounds.Width + 'x' + [string]$_.Bounds.Height } | Sort-Object) -join '+'; Write-Host ('    Key: ' + $key)"
echo.

echo [3] Saved config:
set "CFG=%APPDATA%\grapenote\tasks-data.json"
if not exist "%CFG%" set "CFG=%APPDATA%\GrapeNote\tasks-data.json"
if exist "%CFG%" (
    echo    File: %CFG%
    echo.
    echo    windowBounds:
    powershell -NoProfile -Command "$j = Get-Content '%CFG%' -Raw | ConvertFrom-Json; $b = $j.settings.windowBounds; Write-Host ('    x=' + $b.x + ' y=' + $b.y + ' w=' + $b.width + ' h=' + $b.height)"
    echo.
    echo    displayBounds:
    powershell -NoProfile -Command "$j = Get-Content '%CFG%' -Raw | ConvertFrom-Json; if ($j.settings.displayBounds) { $j.settings.displayBounds.PSObject.Properties | ForEach-Object { $v = $_.Value; Write-Host ('    [' + $_.Name + '] x=' + $v.x + ' y=' + $v.y + ' w=' + $v.width + ' h=' + $v.height) } } else { Write-Host '    (empty)' }"
) else (
    echo    Config NOT FOUND at %CFG%
)
echo.
echo ========================================

echo.
echo Output saved to: %TEMP%\gn-diag-display.txt
> "%TEMP%\gn-diag-display.txt" (
    echo === GrapeNote Display Diagnostic ===
    echo.
    echo Displays:
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Host ($_.DeviceName + ': ' + $_.Bounds.Width + 'x' + $_.Bounds.Height + ' at (' + $_.Bounds.X + ',' + $_.Bounds.Y + ')' + $(if($_.Primary){' [PRIMARY]'}else{''})) }"
    echo.
    echo Key:
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $key = ([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [string]$_.Bounds.Width + 'x' + [string]$_.Bounds.Height } | Sort-Object) -join '+'; Write-Host $key"
    echo.
    echo Config:
    if exist "%CFG%" (
        powershell -NoProfile -Command "Get-Content '%CFG%' -Raw | ConvertFrom-Json | Select-Object -ExpandProperty settings | ConvertTo-Json -Depth 5"
    ) else (
        echo NOT FOUND
    )
)

pause
