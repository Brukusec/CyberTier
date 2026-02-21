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
    $locksPath = Join-Path $dir 'locks.json'

    if (-not (Test-Path $assetsPath)) { '[]' | Set-Content -Path $assetsPath -Encoding UTF8 }
    if (-not (Test-Path $buPath)) { '[]' | Set-Content -Path $buPath -Encoding UTF8 }
    if (-not (Test-Path $pentestsPath)) { '[]' | Set-Content -Path $pentestsPath -Encoding UTF8 }
    if (-not (Test-Path $locksPath)) { '[]' | Set-Content -Path $locksPath -Encoding UTF8 }

    return @{ dataDir = $dir; assetsFile = $assetsPath; buFile = $buPath; pentestsFile = $pentestsPath; locksFile = $locksPath }
}

function Get-ActiveLocks([string]$locksFile) {
    $allLocks = @(Read-JsonFile $locksFile)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    return @($allLocks | Where-Object { $_.expiresAt -gt $now })
}

function Save-Locks([string]$locksFile, $locks) {
    Set-Content -Path $locksFile -Value ($locks | ConvertTo-Json -Depth 8) -Encoding UTF8
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


function Set-SecurityHeaders($response) {
    $response.Headers['X-Content-Type-Options'] = 'nosniff'
    $response.Headers['X-Frame-Options'] = 'DENY'
    $response.Headers['Referrer-Policy'] = 'no-referrer'
    $response.Headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

function Send-Json($context, $statusCode, $obj) {
    $context.Response.StatusCode = $statusCode
    Set-SecurityHeaders $context.Response
    $context.Response.ContentType = 'application/json; charset=utf-8'
    $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 12))
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.OutputStream.Close()
}


function Get-SafeName([string]$value, [string]$fallback = 'item') {
    $name = if ([string]::IsNullOrWhiteSpace($value)) { $fallback } else { $value }
    $invalid = [IO.Path]::GetInvalidFileNameChars() + [char]':'
    foreach ($ch in $invalid) { $name = $name.Replace($ch, '-') }
    $name = $name.Trim()
    if ([string]::IsNullOrWhiteSpace($name)) { return $fallback }
    return $name
}

function Write-Md([string]$path, [string]$content) {
    Set-Content -Path $path -Value $content -Encoding UTF8
}

function Sync-MarkdownSnapshot($files) {
    $assets = @(Read-JsonFile $files.assetsFile)
    $businessUnits = @(Read-JsonFile $files.buFile)
    $pentests = @(Read-JsonFile $files.pentestsFile)

    $mdRoot = Join-Path $files.dataDir 'BU'
    if (Test-Path $mdRoot) { Remove-Item -Path $mdRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $mdRoot | Out-Null

    foreach ($bu in $businessUnits) {
        $buId = [string]($bu.id)
        $buName = Get-SafeName ([string]($bu.name)) "BU-$buId"
        $buFolder = Join-Path $mdRoot $buName
        $assetsFolder = Join-Path $buFolder 'Assets'
        $pentestsFolder = Join-Path $buFolder 'Pentest'

        New-Item -ItemType Directory -Path $assetsFolder -Force | Out-Null
        New-Item -ItemType Directory -Path $pentestsFolder -Force | Out-Null

        $buMd = @(
            "# Business Unit",
            "",
            "- ID: $($bu.id)",
            "- Name: $($bu.name)",
            "- Main Contact: $($bu.mainContact)"
        ) -join "`n"
        Write-Md (Join-Path $buFolder 'BU.md') $buMd

        $buAssets = @($assets | Where-Object { $_.buId -eq $buId })
        foreach ($asset in $buAssets) {
            $assetFile = Join-Path $assetsFolder ((Get-SafeName ([string]($asset.name)) ([string]($asset.id))) + '.md')
            $assetMd = @(
                "# Asset",
                "",
                "- ID: $($asset.id)",
                "- Asset ID: $($asset.assetId)",
                "- Name: $($asset.name)",
                "- Type: $($asset.assetType)",
                "- Risk: $($asset.riskImpactRating)",
                "- Pentest Status: $($asset.pentestStatus)",
                "- Pentest Date: $($asset.pentestDate)",
                "- Business Owner: $($asset.businessOwner)",
                "- Technical Owner: $($asset.techOwner)"
            ) -join "`n"
            Write-Md $assetFile $assetMd
        }

        $buPentests = @($pentests | Where-Object { $_.buId -eq $buId })
        foreach ($project in $buPentests) {
            $projectFolderName = Get-SafeName ("$($project.id)-$($project.name)") ([string]($project.id))
            $projectFolder = Join-Path $pentestsFolder $projectFolderName
            $findingsFolder = Join-Path $projectFolder 'Findings'
            New-Item -ItemType Directory -Path $findingsFolder -Force | Out-Null

            $projectMd = @(
                "# Pentest Project",
                "",
                "- ID: $($project.id)",
                "- Name: $($project.name)",
                "- Client: $($project.clientName)",
                "- Phase: $($project.phase)",
                "- Lead Tester: $($project.testLead)",
                "- Start Date: $($project.startDate)",
                "- End Date: $($project.endDate)",
                "",
                "## Scope",
                "$($project.scope)",
                "",
                "## Executive Summary",
                "$($project.executiveSummary)"
            ) -join "`n"
            Write-Md (Join-Path $projectFolder 'Pentest.md') $projectMd

            foreach ($finding in @($project.findings)) {
                $findingFile = Join-Path $findingsFolder ((Get-SafeName ([string]($finding.title)) ([string]($finding.id))) + '.md')
                $findingMd = @(
                    "# Finding",
                    "",
                    "- ID: $($finding.id)",
                    "- Title: $($finding.title)",
                    "- CVSS: $($finding.cvssScore)",
                    "- Severity: $($finding.severity)",
                    "- CWE: $($finding.cwe)",
                    "- OWASP: $($finding.owasp)",
                    "- TTP/MITRE: $($finding.ttp)",
                    "- Date Found: $($finding.dateFound)",
                    "",
                    "## Description",
                    "$($finding.description)",
                    "",
                    "## Steps to Reproduce",
                    "$($finding.reproSteps)",
                    "",
                    "## Impact",
                    "$($finding.impact)"
                ) -join "`n"
                Write-Md $findingFile $findingMd
            }
        }
    }
}

function Read-JsonFile([string]$filePath) {
    $raw = Get-Content -Path $filePath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return $raw | ConvertFrom-Json
}

$filesInit = Ensure-DataFiles
Sync-MarkdownSnapshot $filesInit

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
            if ($path -eq '/api/locks' -and $method -eq 'GET') { Send-Json $context 200 @(Get-ActiveLocks $files.locksFile); continue }

            if ($path -in @('/api/assets','/api/business-units','/api/pentests') -and $method -eq 'POST') {
                $reader = [IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $incoming = $body | ConvertFrom-Json
                $target = if ($path -eq '/api/assets') { $files.assetsFile } elseif ($path -eq '/api/business-units') { $files.buFile } else { $files.pentestsFile }
                Set-Content -Path $target -Value ($incoming | ConvertTo-Json -Depth 12) -Encoding UTF8
                Sync-MarkdownSnapshot $files
                Send-Json $context 200 @{ ok = $true; count = @($incoming).Count }
                continue
            }

            if ($path -eq '/api/locks/acquire' -and $method -eq 'POST') {
                $reader = [IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $incoming = $body | ConvertFrom-Json

                if (-not $incoming.resourceType -or -not $incoming.resourceId -or -not $incoming.owner) {
                    Send-Json $context 400 @{ ok = $false; error = 'resourceType, resourceId and owner are required' }
                    continue
                }

                $ttlSeconds = if ($incoming.ttlSeconds) { [Math]::Min([Math]::Max([int]$incoming.ttlSeconds, 30), 600) } else { 120 }
                $locks = @(Get-ActiveLocks $files.locksFile)
                $match = $locks | Where-Object { $_.resourceType -eq $incoming.resourceType -and $_.resourceId -eq $incoming.resourceId } | Select-Object -First 1
                $expiresAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $ttlSeconds

                if ($match -and $match.owner -ne $incoming.owner) {
                    Send-Json $context 409 @{ ok = $false; error = 'Locked by another user'; lock = $match }
                    continue
                }

                $locks = @($locks | Where-Object { -not ( $_.resourceType -eq $incoming.resourceType -and $_.resourceId -eq $incoming.resourceId ) })
                $locks += @{ resourceType = $incoming.resourceType; resourceId = $incoming.resourceId; owner = $incoming.owner; acquiredAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); expiresAt = $expiresAt }
                Save-Locks $files.locksFile $locks
                Send-Json $context 200 @{ ok = $true; expiresAt = $expiresAt }
                continue
            }

            if ($path -eq '/api/locks/release' -and $method -eq 'POST') {
                $reader = [IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $incoming = $body | ConvertFrom-Json

                if (-not $incoming.resourceType -or -not $incoming.resourceId -or -not $incoming.owner) {
                    Send-Json $context 400 @{ ok = $false; error = 'resourceType, resourceId and owner are required' }
                    continue
                }

                $locks = @(Get-ActiveLocks $files.locksFile)
                $locks = @($locks | Where-Object { -not ( $_.resourceType -eq $incoming.resourceType -and $_.resourceId -eq $incoming.resourceId -and $_.owner -eq $incoming.owner ) })
                Save-Locks $files.locksFile $locks
                Send-Json $context 200 @{ ok = $true }
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
                Set-SecurityHeaders $context.Response
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
