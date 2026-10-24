<#
.SYNOPSIS
  Serves the app on your local network so friends on the same Wi-Fi can join
  from their phones.

.DESCRIPTION
  Testing Ludo properly needs four people on four devices. This builds the
  web client, points it at your machine's LAN address, and prints the URL to
  share.

  Only reachable on your own network. It does not expose anything to the
  internet.

.EXAMPLE
  .\scripts\share.ps1
#>

[CmdletBinding()]
param(
  [int] $WebPort = 5173,
  [int] $ApiPort = 4000
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

# --- find the LAN address ---------------------------------------------------
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.PrefixOrigin -in @('Dhcp','Manual')
      } |
      Sort-Object -Property SkipAsSource |
      Select-Object -First 1 -ExpandProperty IPAddress

if (-not $ip) {
  Write-Host "Could not find a LAN address. Are you connected to Wi-Fi?" -ForegroundColor Red
  exit 1
}

Write-Host "`nYour machine on this network: $ip" -ForegroundColor Cyan

# --- firewall ---------------------------------------------------------------
# Windows blocks inbound connections to Node by default, which shows up as
# "the page won't load" on the phone.
$rule = Get-NetFirewallRule -DisplayName 'Ludo dev (LAN)' -ErrorAction SilentlyContinue
if (-not $rule) {
  Write-Host "`nA firewall rule is needed for phones to reach this machine." -ForegroundColor Yellow
  Write-Host "Run ONCE in an ADMIN PowerShell:" -ForegroundColor Yellow
  Write-Host ""
  $cmd = "New-NetFirewallRule -DisplayName 'Ludo dev (LAN)' -Direction Inbound " +
         "-Action Allow -Protocol TCP -LocalPort $WebPort,$ApiPort -Profile Private"
  Write-Host "  $cmd" -ForegroundColor White
  Write-Host ""
  Write-Host "Continuing anyway -- it may already be allowed." -ForegroundColor DarkGray
} else {
  Write-Host "Firewall rule present." -ForegroundColor Green
}

# No CORS change is needed: the browser talks only to the Vite dev server on
# this machine, and Vite proxies /api and /socket.io to the API server from
# the server side. The API never sees a cross-origin browser request.

Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Share this with your friends on the same Wi-Fi:" -ForegroundColor White
Write-Host ""
Write-Host "      http://${ip}:$WebPort" -ForegroundColor Cyan
Write-Host ""
Write-Host "  They can add it to their home screen to install the PWA."
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Starting the web client bound to all interfaces..." -ForegroundColor Cyan
Write-Host "(Make sure the API server is running too: npm run dev:server)"
Write-Host ""

npm run dev:web -- --host 0.0.0.0 --port $WebPort
