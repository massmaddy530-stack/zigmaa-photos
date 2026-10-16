<#
.SYNOPSIS
  Create the local application role + databases, enable pgvector, and write backend\.env.

.DESCRIPTION
  * Prompts for the PostgreSQL superuser password (not echoed; used only for this process).
  * Creates role 'eventphoto' with a randomly generated password, and databases 'eventphoto'
    and 'eventphoto_test' owned by it (idempotent: existing databases are left untouched).
  * Runs CREATE EXTENSION vector in both databases as superuser (pgvector is not a "trusted" extension).
  * Writes backend\.env from .env.example with the database URLs and freshly generated
    ADMIN_API_KEY / INGEST_API_KEY / SIGNING_SECRET. Secrets are never printed.
  * Refuses to overwrite an existing backend\.env.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup_local_db.ps1
#>
[CmdletBinding()]
param(
    [string]$Superuser = "postgres",
    [string]$DbHost = "localhost",
    [int]$Port = 5432,
    [string]$AppRole = "eventphoto",
    [string]$AppDb = "eventphoto",
    [string]$TestDb = "eventphoto_test",
    # Needed only if the role already exists from an earlier run whose password you no longer have.
    [switch]$ResetAppPassword
)
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $backend ".env"
$example = Join-Path (Split-Path $backend -Parent) ".env.example"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function New-Secret([int]$len = 40) {
    # Alphanumeric only, so values never need URL-encoding inside DATABASE_URL.
    $chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    $bytes = New-Object byte[] $len
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

foreach ($n in $AppRole, $AppDb, $TestDb) {
    if ($n -notmatch '^[a-z_][a-z0-9_]{0,62}$') { throw "Invalid identifier: $n" }
}
if (Test-Path $envFile) {
    throw "backend\.env already exists - not overwriting it. Move it aside first if you want a fresh one."
}
if (-not (Test-Path $example)) { throw ".env.example not found at $example" }

# --- psql ---------------------------------------------------------------------------------------
$svc = Get-CimInstance Win32_Service | Where-Object { $_.Name -like "postgresql*" } | Select-Object -First 1
if (-not $svc -or $svc.PathName -notmatch '"?(?<exe>[^"]+\\bin\\pg_ctl\.exe)"?') { throw "PostgreSQL service not found." }
$psql = Join-Path (Split-Path $Matches.exe -Parent) "psql.exe"
if ($svc.State -ne "Running") { throw "Service $($svc.Name) is not running." }

$secure = Read-Host "Password for PostgreSQL superuser '$Superuser'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

function Invoke-Psql([string]$db, [string]$sql, [switch]$Sensitive) {
    # SQL goes through stdin so nothing sensitive appears in the process command line.
    $out = $sql | & $psql -h $DbHost -p $Port -U $Superuser -d $db -X -q -t -A -v ON_ERROR_STOP=1 -f - 2>&1
    if ($LASTEXITCODE -ne 0) {
        # psql echoes the failing statement; never surface it when it contains a password.
        if ($Sensitive) { throw "psql failed on database '$db' (details hidden because the statement contains a password)." }
        throw "psql failed on database '$db': $($out -join ' ')"
    }
    return ($out -join "`n").Trim()
}

try {
    Step "Checking connection and pgvector availability"
    Write-Host (Invoke-Psql "postgres" "SELECT version();")
    $avail = Invoke-Psql "postgres" "SELECT default_version FROM pg_available_extensions WHERE name = 'vector';"
    if (-not $avail) { throw "pgvector is not installed on this server. Run scripts\install_pgvector.ps1 (as administrator) first." }
    Write-Host "pgvector available: $avail"

    Step "Creating role '$AppRole'"
    $exists = Invoke-Psql "postgres" "SELECT 1 FROM pg_roles WHERE rolname = '$AppRole';"
    $appPassword = New-Secret 32
    if ($exists -eq "1") {
        if (-not $ResetAppPassword) {
            throw "Role '$AppRole' already exists. Re-run with -ResetAppPassword to set a new password and write a matching .env."
        }
        Invoke-Psql "postgres" "ALTER ROLE $AppRole WITH LOGIN PASSWORD '$appPassword';" -Sensitive | Out-Null
        Write-Host "Existing role password reset."
    } else {
        # Least privilege: no superuser / createdb / createrole.
        Invoke-Psql "postgres" "CREATE ROLE $AppRole WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$appPassword';" -Sensitive | Out-Null
        Write-Host "Role created."
    }

    foreach ($db in $AppDb, $TestDb) {
        Step "Database '$db'"
        $dbExists = Invoke-Psql "postgres" "SELECT 1 FROM pg_database WHERE datname = '$db';"
        if ($dbExists -eq "1") {
            Write-Host "Already exists (left as is)."
        } else {
            Invoke-Psql "postgres" "CREATE DATABASE $db OWNER $AppRole ENCODING 'UTF8' TEMPLATE template0;" | Out-Null
            Write-Host "Created (owner $AppRole)."
        }
        Invoke-Psql $db "CREATE EXTENSION IF NOT EXISTS vector;" | Out-Null
        Write-Host "vector extension: $(Invoke-Psql $db "SELECT extversion FROM pg_extension WHERE extname = 'vector';")"
    }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Step "Writing backend\.env"
$values = @{
    "DATABASE_URL"      = "postgresql+asyncpg://${AppRole}:${appPassword}@${DbHost}:${Port}/${AppDb}"
    "TEST_DATABASE_URL" = "postgresql+asyncpg://${AppRole}:${appPassword}@${DbHost}:${Port}/${TestDb}"
    "ADMIN_API_KEY"     = New-Secret 40
    "INGEST_API_KEY"    = New-Secret 40
    "SIGNING_SECRET"    = New-Secret 48
}
$lines = foreach ($line in Get-Content $example) {
    $m = [regex]::Match($line, '^\s*#?\s*([A-Z_]+)=')
    if ($m.Success -and $values.ContainsKey($m.Groups[1].Value)) {
        $key = $m.Groups[1].Value
        "$key=$($values[$key])"
        $values.Remove($key)
    } else { $line }
}
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))  # UTF-8 without BOM
# Restrict the file to the current user.
icacls $envFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null

Write-Host "Wrote $envFile (readable only by $env:USERNAME). Secrets were not displayed." -ForegroundColor Green
Write-Host "To see your admin key for the dashboard login, open backend\.env in a text editor (ADMIN_API_KEY)."
