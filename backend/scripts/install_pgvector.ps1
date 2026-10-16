<#
.SYNOPSIS
  Build and install pgvector into the local PostgreSQL (Windows). Run in an ELEVATED PowerShell.

.DESCRIPTION
  Follows pgvector's official Windows instructions (nmake /F Makefile.win) but runs them from
  PowerShell via the Visual Studio developer shell. The PostgreSQL install directory (PGROOT) is
  detected from the running PostgreSQL Windows service unless -PgRoot is given.

  Prerequisites:
    * Visual Studio 2022 Build Tools with the "Desktop development with C++" workload (VCTools).
    * pgvector source checked out at -Source (default: %USERPROFILE%\build\pgvector-0.8.7).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install_pgvector.ps1
#>
[CmdletBinding()]
param(
    [string]$Source = "$env:USERPROFILE\build\pgvector-0.8.7",
    [string]$PgRoot
)
$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- 1. Elevation -----------------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell (right-click PowerShell > Run as administrator)."
}

# --- 2. Locate PostgreSQL ---------------------------------------------------------------------------
Step "Locating PostgreSQL"
if (-not $PgRoot) {
    $svc = Get-CimInstance Win32_Service | Where-Object { $_.Name -like "postgresql*" } | Select-Object -First 1
    if (-not $svc) { throw "No PostgreSQL Windows service found. Pass -PgRoot explicitly." }
    if ($svc.PathName -notmatch '"?(?<exe>[^"]+\\bin\\pg_ctl\.exe)"?') { throw "Cannot parse service path: $($svc.PathName)" }
    $PgRoot = Split-Path (Split-Path $Matches.exe -Parent) -Parent
    Write-Host "Service : $($svc.Name)"
}
$pgConfig = Join-Path $PgRoot "bin\pg_config.exe"
if (-not (Test-Path $pgConfig)) { throw "pg_config.exe not found under $PgRoot" }
if (-not (Test-Path (Join-Path $PgRoot "include\server\postgres.h"))) {
    throw "Server headers missing ($PgRoot\include\server). Re-run the PostgreSQL installer and include 'Command Line Tools'/development headers."
}
Write-Host "PGROOT  : $PgRoot"
Write-Host "Version : $(& $pgConfig --version)"

# --- 3. Locate Visual Studio C++ tools and enter the x64 developer shell ---------------------------
Step "Loading Visual Studio x64 build environment"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "Visual Studio Build Tools not found. Install them first (see README / instructions)." }
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw "Visual Studio found, but the C++ x64 tools (VCTools workload) are not installed." }
$devShell = Join-Path $vsPath "Common7\Tools\Launch-VsDevShell.ps1"
& $devShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
if (-not (Get-Command nmake -ErrorAction SilentlyContinue)) { throw "nmake not available after loading the developer shell." }
Write-Host "Visual Studio: $vsPath"

# --- 4. Build & install ------------------------------------------------------------------------------
Step "Building pgvector from $Source"
if (-not (Test-Path (Join-Path $Source "Makefile.win"))) { throw "pgvector source not found at $Source" }
$env:PGROOT = $PgRoot
Push-Location $Source
try {
    nmake /nologo /F Makefile.win clean | Out-Null
    nmake /nologo /F Makefile.win
    if ($LASTEXITCODE -ne 0) { throw "nmake build failed (exit $LASTEXITCODE)" }
    Step "Installing into $PgRoot"
    nmake /nologo /F Makefile.win install
    if ($LASTEXITCODE -ne 0) { throw "nmake install failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

# --- 5. Verify files ----------------------------------------------------------------------------------
Step "Verifying installed files"
$dll = Join-Path $PgRoot "lib\vector.dll"
$ctl = Join-Path $PgRoot "share\extension\vector.control"
foreach ($f in $dll, $ctl) {
    if (-not (Test-Path $f)) { throw "Expected file missing after install: $f" }
    Write-Host "OK  $f"
}
Write-Host "`npgvector installed. No restart is needed; run 'CREATE EXTENSION vector' in each database (setup_local_db.ps1 does this)." -ForegroundColor Green
