$ErrorActionPreference = 'Stop'

$runningApp = Get-Process -Name 'GrapeNote' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path } |
    Select-Object -First 1
if (-not $runningApp) {
    throw 'GrapeNote must be running so its installation directory can be located safely.'
}
$asarPath = Join-Path (Split-Path -Parent $runningApp.Path) 'resources\app.asar'

function Get-Utf8Length([string]$text) {
    return [Text.Encoding]::UTF8.GetByteCount($text)
}

function Pad-Replacement([string]$oldText, [string]$newText) {
    $difference = (Get-Utf8Length $oldText) - (Get-Utf8Length $newText)
    if ($difference -lt 0) {
        throw "Replacement is $(-$difference) bytes too long."
    }
    return $newText + (' ' * $difference)
}

if (-not (Test-Path -LiteralPath $asarPath)) {
    throw "GrapeNote package not found: $asarPath"
}

$archive = [IO.File]::ReadAllBytes($asarPath)
$headerSize = [BitConverter]::ToUInt32($archive, 4)
$jsonLength = [BitConverter]::ToUInt32($archive, 12)
$headerJson = [Text.Encoding]::UTF8.GetString($archive, 16, $jsonLength)
$header = $headerJson | ConvertFrom-Json
$mainEntry = $header.files.'main.js'

if (-not $mainEntry) {
    throw 'main.js is missing from app.asar.'
}

$mainOffset = 8 + $headerSize + [int64]$mainEntry.offset
$mainLength = [int]$mainEntry.size
$mainSource = [Text.Encoding]::UTF8.GetString($archive, [int]$mainOffset, $mainLength)

$replacements = @(
    @(
        "    { label: '显示窗口', click: () => { hiddenByUser = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },",
        "    {label:'显示窗口',click:()=>{hiddenByUser=false;try{mainWindow.show();mainWindow.focus()}catch(e){}}},"
    ),
    @(
        "    { label: '隐藏窗口', click: () => { hiddenByUser = true; if (mainWindow) mainWindow.hide(); } },",
        "    {label:'隐藏窗口',click:()=>{hiddenByUser=true;try{mainWindow.hide()}catch(e){}}},"
    ),
    @(
        "  tray.on('double-click', () => { hiddenByUser = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });",
        "  tray.on('double-click',()=>{hiddenByUser=false;try{mainWindow.show();mainWindow.focus()}catch(e){}});"
    ),
    @(
        "else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }); }",
        "else{app.on('second-instance',()=>{try{if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}catch(e){}});}"
    ),
    @(
        "    const ok = embedWindowInDesktop();",
        "    const ok = false;"
    )
)

$changed = 0
foreach ($pair in $replacements) {
    $oldText = $pair[0]
    $newText = $pair[1]
    $count = ([regex]::Matches($mainSource, [regex]::Escape($oldText))).Count
    if ($count -eq 1) {
        $mainSource = $mainSource.Replace($oldText, (Pad-Replacement $oldText $newText))
        $changed++
    } elseif ($count -gt 1) {
        throw "Expected one match but found $count for: $oldText"
    }
}

if ($changed -eq 0 -and
    $mainSource.Contains("try{mainWindow.show();mainWindow.focus()}catch(e){}") -and
    $mainSource.Contains("const ok = false;")) {
    Write-Output 'GrapeNote is already patched.'
    exit 0
}
if ($changed -ne $replacements.Count) {
    throw "Only $changed of $($replacements.Count) expected locations matched; package was not changed."
}

$updatedMain = [Text.Encoding]::UTF8.GetBytes($mainSource)
if ($updatedMain.Length -ne $mainLength) {
    throw "main.js size changed from $mainLength to $($updatedMain.Length); package was not changed."
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $newHash = ([BitConverter]::ToString($sha256.ComputeHash($updatedMain))).Replace('-', '').ToLowerInvariant()
} finally {
    $sha256.Dispose()
}

$oldHash = [string]$mainEntry.integrity.hash
$hashCount = ([regex]::Matches($headerJson, [regex]::Escape($oldHash))).Count
if ($hashCount -lt 1) {
    throw 'Could not locate the main.js integrity hash in the ASAR header.'
}

$updatedHeaderJson = $headerJson.Replace($oldHash, $newHash)
if ((Get-Utf8Length $updatedHeaderJson) -ne $jsonLength) {
    throw 'ASAR header size changed unexpectedly; package was not changed.'
}

$updatedHeader = [Text.Encoding]::UTF8.GetBytes($updatedHeaderJson)
[Array]::Copy($updatedHeader, 0, $archive, 16, $updatedHeader.Length)
[Array]::Copy($updatedMain, 0, $archive, [int]$mainOffset, $updatedMain.Length)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$asarPath.bak-$timestamp"
$temporaryPath = "$asarPath.repairing"

[IO.File]::Copy($asarPath, $backupPath, $false)
try {
    [IO.File]::WriteAllBytes($temporaryPath, $archive)
    [IO.File]::Copy($temporaryPath, $asarPath, $true)
} finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

Write-Output "Patched: $asarPath"
Write-Output "Backup: $backupPath"
Write-Output "Updated main.js SHA256: $newHash"
