#requires -Version 5.1
<#
.SYNOPSIS
  Restores this repository's Pi configuration on Windows.
.DESCRIPTION
  Backs up every replaced file, expands __PI_HOME__ to the destination home,
  installs pinned dependencies, and reapplies the local ghost-text patch.
  Run with -SkipPackages -SkipPiInstall for a files-only restore or a test.
#>
[CmdletBinding()]
param(
    [string]$DestinationHome = $HOME,
    [string]$MachineDrive = "C:",
    [switch]$SkipPackages,
    [switch]$SkipPiInstall,
    [switch]$InstallAllGlobalPackages,
    [switch]$IncludeMachineIntegrations,
    [switch]$InstallBashAliases
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Config = Join-Path $Repo "config"
$DestinationHome = [System.IO.Path]::GetFullPath($DestinationHome).TrimEnd('\')
$HomeForward = $DestinationHome.Replace('\', '/')
$BackupRoot = Join-Path $DestinationHome (".pi-config-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:BackupCount = 0
$script:BackupRecords = @()

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found on PATH: $Name"
    }
}

function Backup-File([string]$Target) {
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { return }
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $safeName = $Target -replace ':', '' -replace '[\\/]', '_'
    $backup = Join-Path $BackupRoot $safeName
    Copy-Item -LiteralPath $Target -Destination $backup -Force
    $script:BackupCount++
    $script:BackupRecords += [pscustomobject]@{ original = $Target; backup = $backup }
    $recordsJson = ConvertTo-Json -InputObject @($script:BackupRecords) -Depth 3
    [System.IO.File]::WriteAllText((Join-Path $BackupRoot "backup-manifest.json"), $recordsJson, $Utf8NoBom)
}

function Write-PortableText([string]$Source, [string]$Target) {
    $extension = [System.IO.Path]::GetExtension($Target).ToLowerInvariant()
    $replacement = $HomeForward
    if ($extension -in ".cmd", ".bat", ".ps1", ".vbs") { $replacement = $DestinationHome }
    $text = [System.IO.File]::ReadAllText($Source)
    $text = $text.Replace("__PI_HOME__", $replacement)
    $directory = Split-Path -Parent $Target
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Backup-File $Target
    [System.IO.File]::WriteAllText($Target, $text, $Utf8NoBom)
}

function Copy-PortableTree([string]$Source, [string]$Target) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
    $textExtensions = ".bat", ".cmd", ".css", ".env", ".gitignore", ".glsl", ".html", ".js", ".json", ".lua", ".md", ".mjs", ".patch", ".ps1", ".py", ".sh", ".ts", ".txt", ".vbs", ".xml", ".yaml", ".yml", ""
    foreach ($file in Get-ChildItem -LiteralPath $Source -Recurse -File) {
        $relative = $file.FullName.Substring($Source.Length).TrimStart('\')
        $destination = Join-Path $Target $relative
        if ($textExtensions -contains $file.Extension.ToLowerInvariant()) {
            Write-PortableText $file.FullName $destination
        } else {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Backup-File $destination
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $Config "agent\settings.json"))) {
    throw "Snapshot not found at $Config. Run this script from the cloned repository."
}
New-Item -ItemType Directory -Force -Path $DestinationHome | Out-Null

Write-Host "[1/5] Restoring Pi agent configuration and ~/.pi launchers..."
Copy-PortableTree (Join-Path $Config "agent") (Join-Path $DestinationHome ".pi\agent")
Copy-PortableTree (Join-Path $Config "pi") (Join-Path $DestinationHome ".pi")
Copy-PortableTree (Join-Path $Config "shell") (Join-Path $DestinationHome ".pi")

if ($IncludeMachineIntegrations) {
    Write-Host "[2/5] Restoring optional llama-swap, Strata, and pi-loop configuration..."
    Copy-PortableTree (Join-Path $Config "machine\llama-swap") "$MachineDrive\llama-swap"
    Copy-PortableTree (Join-Path $Config "machine\Strata") "$MachineDrive\Strata"
    Copy-PortableTree (Join-Path $Config "machine\llama") (Join-Path $DestinationHome "llama")
    Copy-PortableTree (Join-Path $Config "machine\hipfire-test") (Join-Path $DestinationHome "hipfire-test")
    Copy-PortableTree (Join-Path $Config "machine\pi-local") (Join-Path $DestinationHome ".config\pi-local")
} else {
    Write-Host "[2/5] Skipping machine integrations (use -IncludeMachineIntegrations to include them)."
}

if (-not $SkipPiInstall) {
    Write-Host "[3/5] Installing the captured Pi CLI..."
    Assert-Command "node"
    Assert-Command "npm"
    $nodeVersion = [version]((node --version).TrimStart('v'))
    if ($nodeVersion -lt [version]"22.19.0") { throw "Node.js 22.19 or newer is required; found $nodeVersion" }
    $manifest = Get-Content -LiteralPath (Join-Path $Repo "manifest.json") -Raw | ConvertFrom-Json
    $piVersion = $manifest.versions.pi
    if (-not $piVersion) { throw "Pi version is missing from manifest.json" }
    & npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@$piVersion"
    if ($LASTEXITCODE) { throw "Pi CLI installation failed" }

    $globalPackages = Get-Content -LiteralPath (Join-Path $Config "global-npm-packages.json") -Raw | ConvertFrom-Json
    $coreTools = if ($InstallAllGlobalPackages) {
        $globalPackages.PSObject.Properties.Name | Where-Object { $_ -notin "npm", "@earendil-works/pi-coding-agent" }
    } else {
        @("agent-desktop", "playwright")
    }
    foreach ($name in $coreTools) {
        $version = $globalPackages.$name
        if ($version) {
            & npm install -g --ignore-scripts "$name@$version"
            if ($LASTEXITCODE) { throw "Global tool installation failed: $name@$version" }
        }
    }
} else {
    Write-Host "[3/5] Skipping Pi CLI and global tools."
}

if (-not $SkipPackages) {
    Write-Host "[4/5] Installing locked Pi packages and local extension dependencies..."
    Assert-Command "npm"
    $packageRoots = @((Join-Path $DestinationHome ".pi\agent\npm"))
    $packageRoots += Get-ChildItem -LiteralPath (Join-Path $DestinationHome ".pi\agent\extensions") -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "package-lock.json") } |
        ForEach-Object { $_.FullName }
    foreach ($root in $packageRoots) {
        Push-Location $root
        try {
            # Pi supplies host peer packages at runtime; do not let npm auto-install conflicting hosts.
            & npm ci --ignore-scripts --legacy-peer-deps
            if ($LASTEXITCODE) { throw "npm ci failed in $root" }
        } finally { Pop-Location }
    }

    $patchedRender = Join-Path $DestinationHome ".pi\agent\patches\render.patched.ts"
    $installedRender = Join-Path $DestinationHome ".pi\agent\npm\node_modules\pi-ghost-text\src\render.ts"
    if ((Test-Path -LiteralPath $patchedRender) -and (Test-Path -LiteralPath $installedRender)) {
        Backup-File $installedRender
        Copy-Item -LiteralPath $patchedRender -Destination $installedRender -Force
        Write-Host "      Reapplied pi-ghost-text fake-cursor patch."
    }
} else {
    Write-Host "[4/5] Skipping package installation and the ghost-text patch."
}

if ($InstallBashAliases) {
    $bashrc = Join-Path $DestinationHome ".bashrc"
    $sourceLine = 'source "$HOME/.pi/pi-aliases.sh"'
    $existing = if (Test-Path -LiteralPath $bashrc) { [System.IO.File]::ReadAllText($bashrc) } else { "" }
    if ($existing -notmatch [regex]::Escape($sourceLine)) {
        Backup-File $bashrc
        [System.IO.File]::AppendAllText($bashrc, "`r`n# Pi launchers restored from pi-config`r`n$sourceLine`r`n", $Utf8NoBom)
    }
}

Write-Host "[5/5] Restore complete."
Write-Host "      Files backed up: $script:BackupCount"
if ($script:BackupCount) { Write-Host "      Backup directory: $BackupRoot" }
Write-Host "      Next: configure credentials (docs/SECRETS.md), restart the terminal, and run: pi --version; pi list"
Write-Host "      OpenRouter: start Pi and run /login. Local models and other services: docs/EXTERNAL-SERVICES.md"
