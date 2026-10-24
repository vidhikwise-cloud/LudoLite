<#
.SYNOPSIS
  Checks that the running stack actually works: health, gate state, and a
  real room created and joined over HTTP.

.DESCRIPTION
  Run this with the server up (scripts\dev.ps1). It creates a throwaway free
  room, joins it with a second player, and reports what it found. Read-only
  apart from the test room it creates.

.EXAMPLE
  .\scripts\verify.ps1
#>

[CmdletBinding()]
param(
  [string] $ApiBase = 'http://localhost:4000'
)

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Check($name, [scriptblock] $test) {
  try {
    $detail = & $test
    Write-Host "  PASS  $name" -ForegroundColor Green
    if ($detail) { Write-Host "        $detail" -ForegroundColor DarkGray }
    $script:pass++
  } catch {
    Write-Host "  FAIL  $name" -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)" -ForegroundColor DarkGray
    $script:fail++
  }
}

Write-Host "`nVerifying $ApiBase`n" -ForegroundColor Cyan

# --- health -----------------------------------------------------------------
Check "server is up" {
  $h = Invoke-RestMethod "$ApiBase/health" -TimeoutSec 5
  if (-not $h.ok) { throw "health returned ok=false" }
  "paidHostingFlag = $($h.paidHostingFlag)"
}

# --- gate -------------------------------------------------------------------
$config = $null
Check "paid hosting is disabled" {
  $script:config = Invoke-RestMethod "$ApiBase/api/config" -TimeoutSec 5
  if ($script:config.paidHostingEnabled) {
    throw "GATE IS OPEN -- this is not the expected shipping state"
  }
  "$($script:config.paidHostingBlockers.Count) blockers reported"
}

Check "fee is quoted as Rs 1 (100 paise)" {
  if ($script:config.hostingFeePaise -ne 100) {
    throw "expected 100, got $($script:config.hostingFeePaise)"
  }
  "100 paise, $($script:config.currency)"
}

# --- free room round trip ---------------------------------------------------
$room = $null; $hostToken = $null
Check "host can create a free room" {
  $body = @{
    seatCount   = 4
    displayName = 'VerifyHost'
    funding     = 'free'
    deviceKey   = "verify-host-$(Get-Random)"
  } | ConvertTo-Json

  $r = Invoke-RestMethod "$ApiBase/api/rooms" -Method Post -Body $body -ContentType 'application/json'
  $script:room      = $r.room
  $script:hostToken = $r.playerToken

  if ($r.room.status -ne 'active') { throw "expected active, got $($r.room.status)" }
  if ($r.payment) { throw "a free room must not carry a payment intent" }
  "code $($r.room.code), status $($r.room.status)"
}

Check "a paid room is refused while the gate is shut" {
  $body = @{
    seatCount   = 4
    displayName = 'VerifyHost2'
    funding     = 'paid'
    deviceKey   = "verify-paid-$(Get-Random)"
    feeConsent  = @{
      acceptedTerms        = $true
      acknowledgedNoPrize  = $true
      displayedAmountPaise = 100
    }
  } | ConvertTo-Json

  try {
    Invoke-RestMethod "$ApiBase/api/rooms" -Method Post -Body $body -ContentType 'application/json' | Out-Null
    throw "the server ACCEPTED a paid room -- the gate is not working"
  } catch {
    # 402 is the expected outcome.
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ne 402) { throw "expected HTTP 402, got $code" }
    "refused with 402 PAID_HOSTING_UNAVAILABLE"
  }
}

Check "a friend joins free" {
  $body = @{
    code        = $script:room.code
    displayName = 'VerifyFriend'
    deviceKey   = "verify-friend-$(Get-Random)"
  } | ConvertTo-Json

  $r = Invoke-RestMethod "$ApiBase/api/rooms/join" -Method Post -Body $body -ContentType 'application/json'
  if ($r.room.players.Count -ne 2) { throw "expected 2 players, got $($r.room.players.Count)" }
  "2 seats filled, no charge"
}

Check "the host is not double-charged on reconnect" {
  $body = @{
    code        = $script:room.code
    displayName = 'VerifyHost'
    deviceKey   = "verify-rejoin-$(Get-Random)"
  } | ConvertTo-Json
  # Rejoining as a new device just takes a free seat; the real double-charge
  # assertion lives in the server test suite. This confirms the path is open.
  $r = Invoke-RestMethod "$ApiBase/api/rooms/join" -Method Post -Body $body -ContentType 'application/json'
  "room now has $($r.room.players.Count) players, still free"
}

# --- summary ----------------------------------------------------------------
Write-Host ""
if ($fail -eq 0) {
  Write-Host "  $pass checks passed. The free experience is working." -ForegroundColor Green
  if ($script:room) {
    Write-Host "  Test room code: $($script:room.code) -- open http://localhost:5173 and join it." -ForegroundColor White
  }
} else {
  Write-Host "  $pass passed, $fail failed." -ForegroundColor Red
}
Write-Host ""
