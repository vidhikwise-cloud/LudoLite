<#
.SYNOPSIS
  Builds the Android app.

.DESCRIPTION
  Checks the toolchain, builds the web bundle against your server URL, syncs
  it into the Android project, and produces an installable APK.

  The server URL is required and must be HTTPS: the packaged app has no dev
  proxy, so a relative path or a localhost URL produces an app that silently
  cannot reach the server.

.PARAMETER ApiUrl
  Your deployed server, e.g. https://ludo.onrender.com

.PARAMETER Bundle
  Build an .aab for the Play Store instead of an .apk for sideloading.

.EXAMPLE
  .\scripts\build-app.ps1 -ApiUrl "https://ludo.onrender.com"
  .\scripts\build-app.ps1 -ApiUrl "https://ludo.onrender.com" -Bundle
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $ApiUrl,

  [switch] $Bundle
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$web = Join-Path $repo 'apps\web'
Set-Location $repo

function Step($text) { Write-Host "`n>> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Fail($text) {
  Write-Host "`n   $text`n" -ForegroundColor Red
  exit 1
}

# --- validate the URL -------------------------------------------------------
Step "Checking the server URL"

try {
  $parsed = [uri] $ApiUrl
} catch {
  Fail "Not a valid URL: $ApiUrl"
}

if ($parsed.Scheme -ne 'https') {
  Fail "The URL must be https. Android blocks cleartext traffic in this app."
}
if ($parsed.Host -in @('localhost', '127.0.0.1')) {
  Fail "A phone cannot reach localhost. Deploy first, then use that URL."
}
Ok "App will call $($parsed.Scheme)://$($parsed.Host)"

# Warn if the server is not actually reachable. Not fatal: you may be building
# before the first deploy finishes.
try {
  $probe = Invoke-WebRequest -Uri "$($ApiUrl.TrimEnd('/'))/health" -TimeoutSec 8 -UseBasicParsing
  if ($probe.StatusCode -eq 200) { Ok "Server responded to /health" }
} catch {
  Write-Host "   Could not reach $ApiUrl/health - building anyway" -ForegroundColor Yellow
  Write-Host "   (fine if the deploy is still in progress)" -ForegroundColor DarkGray
}

# --- toolchain --------------------------------------------------------------
Step "Checking the Android toolchain"

$javaOk = $false
try {
  $null = & java -version 2>&1
  if ($LASTEXITCODE -eq 0) { $javaOk = $true }
} catch { }

if (-not $javaOk) {
  Write-Host "   Java was not found." -ForegroundColor Red
  Write-Host ""
  Write-Host "   Install Android Studio - it bundles the JDK and the SDK:" -ForegroundColor Yellow
  Write-Host "     https://developer.android.com/studio" -ForegroundColor White
  Write-Host ""
  Write-Host "   Then open a NEW terminal and run this script again." -ForegroundColor Yellow
  Write-Host "   If Studio is installed but Java is still not found, set:" -ForegroundColor DarkGray
  Write-Host '     $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"' -ForegroundColor DarkGray
  exit 1
}
Ok "Java found"

$sdkDir = $env:ANDROID_HOME
if (-not $sdkDir) { $sdkDir = $env:ANDROID_SDK_ROOT }
if (-not $sdkDir) { $sdkDir = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

if (-not (Test-Path $sdkDir)) {
  Fail "Android SDK not found. Open Android Studio once to install it, then re-run."
}
Ok "SDK at $sdkDir"

$androidDir = Join-Path $web 'android'
if (-not (Test-Path $androidDir)) {
  Fail "android/ is missing. Run: cd apps\web; npx cap add android"
}

# Gradle needs to know where the SDK is.
$localProps = Join-Path $androidDir 'local.properties'
$sdkEscaped = $sdkDir -replace '\\', '\\\\'
"sdk.dir=$sdkEscaped" | Set-Content -Path $localProps -Encoding utf8
Ok "Wrote local.properties"

# --- build the web bundle ---------------------------------------------------
Step "Building the web app"
$env:VITE_API_BASE_URL = $ApiUrl

Push-Location $repo
npx tsc -p packages/engine/tsconfig.json
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "engine build failed" }
npx tsc -p packages/shared/tsconfig.json
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "shared build failed" }
Pop-Location

Push-Location $web
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "web build failed" }

Step "Refreshing icons"
node scripts/android-icons.mjs

Step "Syncing into the Android project"
npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "cap sync failed" }
Pop-Location

# --- gradle -----------------------------------------------------------------
$signed = Test-Path (Join-Path $androidDir 'keystore.properties')
if (-not $signed) {
  Write-Host "`n   No keystore.properties - signing with the debug key." -ForegroundColor Yellow
  Write-Host "   Fine for sideloading; a Play upload needs a real key." -ForegroundColor DarkGray
  Write-Host "   See docs\ANDROID.md." -ForegroundColor DarkGray
}

$task = if ($Bundle) { 'bundleRelease' } else { 'assembleRelease' }
Step "Running gradle $task (first run downloads Gradle, give it a few minutes)"

Push-Location $androidDir
& .\gradlew.bat $task --no-daemon
$gradleExit = $LASTEXITCODE
Pop-Location

if ($gradleExit -ne 0) { Fail "gradle $task failed - see the output above" }

# --- report -----------------------------------------------------------------
$artifact = if ($Bundle) {
  Join-Path $androidDir 'app\build\outputs\bundle\release\app-release.aab'
} else {
  Join-Path $androidDir 'app\build\outputs\apk\release\app-release.apk'
}

Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
if (Test-Path $artifact) {
  $sizeMb = [math]::Round((Get-Item $artifact).Length / 1MB, 1)
  Write-Host " Built: $artifact" -ForegroundColor Green
  Write-Host " Size:  $sizeMb MB"
  Write-Host ""
  if ($Bundle) {
    Write-Host " Upload this .aab in the Play Console."
  } else {
    Write-Host " Copy the .apk to your phone and open it to install."
    Write-Host " You will need to allow installs from unknown sources."
  }
} else {
  Write-Host " Gradle reported success but the artifact is missing." -ForegroundColor Yellow
  Write-Host " Look under $androidDir\app\build\outputs\"
}
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
