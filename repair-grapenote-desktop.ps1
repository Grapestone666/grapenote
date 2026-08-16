$ErrorActionPreference = 'Stop'

$runningApp = Get-Process -Name 'GrapeNote' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path } |
    Select-Object -First 1
if (-not $runningApp) {
    throw 'GrapeNote must be running so its installation directory can be located safely.'
}

$appDirectory = Split-Path -Parent $runningApp.Path
$asarPath = Join-Path $appDirectory 'resources\app.asar'
$helperSourcePath = Join-Path $appDirectory 'resources\embed-helper.cs'
$helperExePath = Join-Path $env:APPDATA 'grapenote\embed-helper.exe'
$repairRoot = if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\Users\Grapestone\Documents\Grapenote' }
$fixedHelperPath = Join-Path $repairRoot 'embed-helper-fixed.cs'

function Get-Utf8Length([string]$text) {
    return [Text.Encoding]::UTF8.GetByteCount($text)
}

function Pad-Replacement([string]$oldText, [string]$newText) {
    $difference = (Get-Utf8Length $oldText) - (Get-Utf8Length $newText)
    if ($difference -lt 0) { throw "Replacement is $(-$difference) bytes too long." }
    return $newText + (' ' * $difference)
}

if (-not (Test-Path -LiteralPath $asarPath)) { throw "Package not found: $asarPath" }
if (-not (Test-Path -LiteralPath $fixedHelperPath)) { throw "Fixed helper source not found: $fixedHelperPath" }

$archive = [IO.File]::ReadAllBytes($asarPath)
$headerSize = [BitConverter]::ToUInt32($archive, 4)
$jsonLength = [BitConverter]::ToUInt32($archive, 12)
$headerJson = [Text.Encoding]::UTF8.GetString($archive, 16, $jsonLength)
$header = $headerJson | ConvertFrom-Json
$mainEntry = $header.files.'main.js'
$mainOffset = 8 + $headerSize + [int64]$mainEntry.offset
$mainLength = [int]$mainEntry.size
$mainSource = [Text.Encoding]::UTF8.GetString($archive, [int]$mainOffset, $mainLength)

$oldCompile = '  try { if (fs.existsSync(exe)) fs.unlinkSync(exe); } catch(e) {}'
$newCompile = '  if(fs.existsSync(exe))return exe;'
if ($mainSource.Contains($oldCompile)) {
    $mainSource = $mainSource.Replace($oldCompile, (Pad-Replacement $oldCompile $newCompile))
} elseif (-not $mainSource.Contains($newCompile)) {
    throw 'Could not locate compileEmbedHelper cache logic.'
}

$disabledEmbed = '    const ok = false;                 '
$enabledEmbed = '    const ok = embedWindowInDesktop();'
if ($mainSource.Contains($disabledEmbed)) {
    $mainSource = $mainSource.Replace($disabledEmbed, $enabledEmbed)
} elseif (-not $mainSource.Contains($enabledEmbed)) {
    throw 'Could not locate desktop embedding switch.'
}

$oldMonitor = @"
  setInterval(() => {
    if (!hiddenByUser && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);
"@
$newMonitor = "  setInterval(()=>{if(!hiddenByUser&&mainWindow&&!mainWindow.isDestroyed()){if(!mainWindow.isVisible())mainWindow.show();embedWindowInDesktop()}},3000);"
if ($mainSource.Contains($oldMonitor)) {
    $mainSource = $mainSource.Replace($oldMonitor, (Pad-Replacement $oldMonitor $newMonitor))
} elseif (-not $mainSource.Contains('embedWindowInDesktop()}},3000);')) {
    throw 'Could not locate desktop visibility monitor.'
}

$updatedMain = [Text.Encoding]::UTF8.GetBytes($mainSource)
if ($updatedMain.Length -ne $mainLength) {
    throw "main.js size changed from $mainLength to $($updatedMain.Length)."
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $newHash = ([BitConverter]::ToString($sha256.ComputeHash($updatedMain))).Replace('-', '').ToLowerInvariant()
} finally {
    $sha256.Dispose()
}

$oldHash = [string]$mainEntry.integrity.hash
$updatedHeaderJson = $headerJson.Replace($oldHash, $newHash)
if ((Get-Utf8Length $updatedHeaderJson) -ne $jsonLength) { throw 'ASAR header size changed unexpectedly.' }

$updatedHeader = [Text.Encoding]::UTF8.GetBytes($updatedHeaderJson)
[Array]::Copy($updatedHeader, 0, $archive, 16, $updatedHeader.Length)
[Array]::Copy($updatedMain, 0, $archive, [int]$mainOffset, $updatedMain.Length)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$asarBackup = "$asarPath.bak-desktop-$timestamp"
$helperBackup = "$helperSourcePath.bak-$timestamp"
$temporaryAsar = "$asarPath.repairing"

[IO.File]::Copy($asarPath, $asarBackup, $false)
if (Test-Path -LiteralPath $helperSourcePath) {
    [IO.File]::Copy($helperSourcePath, $helperBackup, $false)
}

try {
    [IO.File]::WriteAllBytes($temporaryAsar, $archive)
    [IO.File]::Copy($temporaryAsar, $asarPath, $true)
    [IO.File]::Copy($fixedHelperPath, $helperSourcePath, $true)
    if (Test-Path -LiteralPath $helperExePath) {
        Remove-Item -LiteralPath $helperExePath -Force
    }
} finally {
    if (Test-Path -LiteralPath $temporaryAsar) {
        Remove-Item -LiteralPath $temporaryAsar -Force
    }
}

Write-Output "Patched: $asarPath"
Write-Output "Patched: $helperSourcePath"
Write-Output "ASAR backup: $asarBackup"
if (Test-Path -LiteralPath $helperBackup) { Write-Output "Helper backup: $helperBackup" }
Write-Output "Updated main.js SHA256: $newHash"
