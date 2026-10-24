<#
.SYNOPSIS
  Starts the API server and the web client together.

.DESCRIPTION
  Opens each in its own window so you can read the logs separately and stop
  either one independently. Run scripts\setup.ps1 first.

.EXAMPLE
  .\scripts\dev.ps1
  .\scripts\dev.ps1 -SameWindow     # both in this terminal as background jobs
#>

[CmdletBinding()]
param(
  [switch] $SameWindow
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (-not (Test-Path (Join-Path $repo 'apps\server\.env'))) {
  Write-Host "apps\server\.env is missing. Run .\scripts\setup.ps1 first." -ForegroundColor Red
  exit 1
}

# A stale process on either port is the most common reason "nothing happens".
foreach ($port in @(4000, 5173)) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    Write-Host "Port $port is already in use (PID $($busy[0].OwningProcess))." -ForegroundColor Yellow
    Write-Host "Stop it first:  Stop-Process -Id $($busy[0].OwningProcess)" -ForegroundColor Yellow
    exit 1
  }
}

if ($SameWindow) {
  Write-Host "Starting both as background jobs..." -ForegroundColor Cyan
  $server = Start-Job -Name 'ludo-server' -ScriptBlock {
    Set-Location $using:repo; npm run dev:server
  }
  $web = Start-Job -Name 'ludo-web' -ScriptBlock {
    Set-Location $using:repo; npm run dev:web
  }
  Write-Host ""
  Write-Host "  Server job: $($server.Id)    Web job: $($web.Id)"
  Write-Host "  Logs:  Receive-Job -Id $($server.Id) -Keep"
  Write-Host "  Stop:  Stop-Job ludo-server,ludo-web; Remove-Job ludo-server,ludo-web"
} else {
  Write-Host "Opening two windows..." -ForegroundColor Cyan
  Start-Process powershell -ArgumentList @(
    '-NoExit','-Command', "Set-Location '$repo'; Write-Host 'API SERVER' -ForegroundColor Cyan; npm run dev:server"
  )
  Start-Sleep -Seconds 2
  Start-Process powershell -ArgumentList @(
    '-NoExit','-Command', "Set-Location '$repo'; Write-Host 'WEB CLIENT' -ForegroundColor Cyan; npm run dev:web"
  )
}

Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Web    http://localhost:5173" -ForegroundColor White
Write-Host "  API    http://localhost:4000/health"
Write-Host ""
Write-Host "  To play with friends on your LAN, run:"
Write-Host "    .\scripts\share.ps1"
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
