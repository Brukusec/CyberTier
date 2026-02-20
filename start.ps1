param(
    [string]$DataDir = "$PSScriptRoot\data",
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'

$configDir = Join-Path $PSScriptRoot 'config'
if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir | Out-Null }

$settingsFile = Join-Path $configDir 'settings.json'
if (-not (Test-Path $settingsFile)) {
    (@{ dataDir = $DataDir } | ConvertTo-Json) | Set-Content -Path $settingsFile -Encoding UTF8
}

$publicDir = Join-Path $PSScriptRoot 'public'
if (-not (Test-Path $publicDir)) { throw "Folder 'public' not found in $PSScriptRoot" }

function Get-Settings {
    $raw = Get-Content -Path $settingsFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{ dataDir = $DataDir } }
    $obj = $raw | ConvertFrom-Json
    if (-not $obj.dataDir) { $obj | Add-Member -NotePropertyName dataDir -NotePropertyValue $DataDir }
    return $obj
}

function Save-Settings($settingsObj) {
    Set-Content -Path $settingsFile -Value ($settingsObj | ConvertTo-Json -Depth 8) -Encoding UTF8
}

function Ensure-DataFiles {
    $settings = Get-Settings
    $dir = $settings.dataDir
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

    $assetsPath = Join-Path $dir 'assets.json'
    $buPath = Join-Path $dir 'business-units.json'
    $pentestsPath = Join-Path $dir 'pentests.json'

    if (-not (Test-Path $assetsPath)) { '[]' | Set-Content -Path $assetsPath -Encoding UTF8 }
    if (-not (Test-Path $buPath)) { '[]' | Set-Content -Path $buPath -Encoding UTF8 }
    if (-not (Test-Path $pentestsPath)) { '[]' | Set-Content -Path $pentestsPath -Encoding UTF8 }

    return @{ dataDir = $dir; assetsFile = $assetsPath; buFile = $buPath; pentestsFile = $pentestsPath }
}

function Get-ContentType([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.svg'  { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
}

function Send-Json($context, $statusCode, $obj) {
    $context.Response.StatusCode = $statusCode
    $context.Response.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 12))
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
}

function Read-JsonFile([string]$filePath) {
    $raw = Get-Content -Path $filePath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return $raw | ConvertFrom-Json
}

Ensure-DataFiles | Out-Null

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "CyberDel running at http://localhost:$Port"
Write-Host "Press Ctrl+C to stop"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request

        try {
            $path = $req.Url.AbsolutePath
            $method = $req.HttpMethod
            $files = Ensure-DataFiles

            if ($path -eq '/api/bootstrap' -and $method -eq 'GET') {
                Send-Json $context 200 @{
                    settings = @{ dataDir = $files.dataDir }
                    assets = @(Read-JsonFile $files.assetsFile)
                    businessUnits = @(Read-JsonFile $files.buFile)
                    pentestProjects = @(Read-JsonFile $files.pentestsFile)
                }
                continue
            }

            if ($path -eq '/api/assets' -and $method -eq 'GET') { Send-Json $context 200 @(Read-JsonFile $files.assetsFile); continue }
            if ($path -eq '/api/business-units' -and $method -eq 'GET') { Send-Json $context 200 @(Read-JsonFile $files.buFile); continue }
            if ($path -eq '/api/pentests' -and $method -eq 'GET') { Send-Json $context 200 @(Read-JsonFile $files.pentestsFile); continue }

            if ($path -in @('/api/assets','/api/business-units','/api/pentests') -and $method -eq 'POST') {
                $reader = [IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $incoming = $body | ConvertFrom-Json
                $target = if ($path -eq '/api/assets') { $files.assetsFile } elseif ($path -eq '/api/business-units') { $files.buFile } else { $files.pentestsFile }
                Set-Content -Path $target -Value ($incoming | ConvertTo-Json -Depth 12) -Encoding UTF8
                Send-Json $context 200 @{ ok = $true; count = @($incoming).Count }
                continue
            }

            if ($path -eq '/api/settings' -and $method -eq 'GET') { Send-Json $context 200 (Get-Settings); continue }
            if ($path -eq '/api/settings' -and $method -eq 'POST') {
                $reader = [IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()

                $incoming = $body | ConvertFrom-Json
                if (-not $incoming.dataDir -or [string]::IsNullOrWhiteSpace($incoming.dataDir)) {
                    Send-Json $context 400 @{ error = 'dataDir is required' }
                    continue
                }

                Save-Settings @{ dataDir = $incoming.dataDir }
                $files = Ensure-DataFiles
                Send-Json $context 200 @{ ok = $true; dataDir = $files.dataDir }
                continue
            }

            if ($path -eq '/api/health') { Send-Json $context 200 @{ ok = $true; dataDir = (Ensure-DataFiles).dataDir }; continue }

            $relative = if ($path -eq '/') { '/index.html' } else { $path }
            $filePath = Join-Path $publicDir $relative.TrimStart('/')
            if (Test-Path $filePath -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($filePath)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = Get-ContentType $filePath
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
            } else {
                Send-Json $context 404 @{ error = 'Not found' }
            }
        }
        catch {
            Send-Json $context 500 @{ error = $_.Exception.Message }
        }
    }
}
finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
}
