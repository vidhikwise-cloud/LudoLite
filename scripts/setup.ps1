<#
.SYNOPSIS
  One-time setup for local development: creates the database, writes .env,
  runs migrations, and seeds the compliance rows.

.DESCRIPTION
  Run this once. It is safe to re-run -- it will not overwrite an existing
  .env, and the seed never downgrades an approval.

  Your Postgres password is read interactively and written only to
  apps/server/.env, which is gitignored. It is never printed to the console
  and never leaves this machine.

.EXAMPLE
  .\scripts\setup.ps1
  .\scripts\setup.ps1 -Port 5433 -PgBin "C:\Program Files\PostgreSQL\18\bin"
#>

[CmdletBinding()]
param(
  [string] $PgBin    = "C:\Program Files\PostgreSQL\16\bin",
  [string] $PgHost   = "localhost",
  [int]    $Port     = 5432,
  [string] $User     = "postgres",
  [string] $Database = "ludo"
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Step($text) { Write-Host "`n>> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   $text" -ForegroundColor Yellow }

# --- locate psql ------------------------------------------------------------
$psql      = Join-Path $PgBin 'psql.exe'
$createdb  = Join-Path $PgBin 'createdb.exe'
if (-not (Test-Path $psql)) {
  Write-Host "psql.exe not found at $psql" -ForegroundColor Red
  Write-Host "Pass the right folder, e.g.:" -ForegroundColor Red
  Write-Host '  .\scripts\setup.ps1 -PgBin "C:\Program Files\PostgreSQL\18\bin"'
  exit 1
}
Ok "Using $psql"

# --- password ---------------------------------------------------------------
Step "PostgreSQL password"
Write-Host "   Password for user '$User' on ${PgHost}:$Port (input hidden)"
$secure = Read-Host -AsSecureString "   Password"
$plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

if ([string]::IsNullOrWhiteSpace($plain)) {
  Write-Host "No password entered. Aborting." -ForegroundColor Red
  exit 1
}

# PGPASSWORD scopes to this process only; it is not persisted.
$env:PGPASSWORD = $plain

# --- connectivity check -----------------------------------------------------
Step "Testing connection"
$probe = & $psql -h $PgHost -p $Port -U $User -d postgres -tAc "SELECT 1" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "   Could not connect:" -ForegroundColor Red
  Write-Host "   $probe" -ForegroundColor Red
  $env:PGPASSWORD = $null
  exit 1
}
Ok "Connected"

# --- create database --------------------------------------------------------
Step "Creating database '$Database'"
$exists = & $psql -h $PgHost -p $Port -U $User -d postgres -tAc `
  "SELECT 1 FROM pg_database WHERE datname = '$Database'" 2>&1

if ($exists -match '1') {
  Warn "Already exists -- leaving it alone"
} else {
  & $createdb -h $PgHost -p $Port -U $User $Database
  if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; exit 1 }
  Ok "Created"
}

# --- write apps/server/.env -------------------------------------------------
Step "Writing apps/server/.env"
$envPath = Join-Path $repo 'apps\server\.env'

if (Test-Path $envPath) {
  Warn "Already exists -- not overwriting"
  Warn "Delete it and re-run if you want it regenerated"
} else {
  # URL-encode the password so symbols survive the connection string.
  $encoded = [uri]::EscapeDataString($plain)
  $secret  = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

  @"
NODE_ENV=development
PORT=4000
CORS_ORIGINS=http://localhost:5173,http://localhost:4173

DATABASE_URL=postgresql://${User}:${encoded}@${PgHost}:${Port}/${Database}?schema=public

SESSION_SECRET=$secret

# Paid hosting is disabled and cannot be enabled by this flag alone.
# See docs/COMPLIANCE.md before changing anything below.
PAID_ROOM_HOSTING_ENABLED=false
HOSTING_FEE_PAISE=100
CURRENCY=INR

PAYMENT_PROVIDER=none
PAYMENT_PROVIDER_KEY_ID=
PAYMENT_PROVIDER_KEY_SECRET=
PAYMENT_WEBHOOK_SECRET=

REFUND_WINDOW_MINUTES=60
"@ | Set-Content -Path $envPath -Encoding utf8

  Ok "Written (gitignored, with a freshly generated SESSION_SECRET)"
}

$env:PGPASSWORD = $null
$plain = $null

# --- npm install ------------------------------------------------------------
Step "Installing dependencies"
npm install --silent
if ($LASTEXITCODE -ne 0) { exit 1 }
Ok "Installed"

# --- prisma -----------------------------------------------------------------
Step "Generating Prisma client"
npm run db:generate --workspace apps/server
if ($LASTEXITCODE -ne 0) { exit 1 }

Step "Applying migrations"
npm run db:deploy --workspace apps/server
if ($LASTEXITCODE -ne 0) { exit 1 }
Ok "Schema applied"

Step "Seeding compliance rows"
npm run db:seed --workspace apps/server
if ($LASTEXITCODE -ne 0) { exit 1 }

# --- build workspace packages ----------------------------------------------
Step "Building shared packages"
npx tsc -p packages/engine/tsconfig.json
npx tsc -p packages/shared/tsconfig.json
Ok "Built"

# --- done -------------------------------------------------------------------
Write-Host "`n--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host " Start it with:"
Write-Host "   .\scripts\dev.ps1" -ForegroundColor White
Write-Host ""
Write-Host " Or in two terminals:"
Write-Host "   npm run dev:server"
Write-Host "   npm run dev:web"
Write-Host ""
Write-Host " Then open http://localhost:5173"
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
