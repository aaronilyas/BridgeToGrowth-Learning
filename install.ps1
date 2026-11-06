# BridgeToGrowth Learning installer for Windows.
#
# Installs everything the build needs (Bun, the WebView2 runtime), downloads the source if this
# script is not inside a checkout, and builds the desktop app into artifacts\.
#
#   Easiest:     double-click install.cmd
#   PowerShell:  powershell -ExecutionPolicy Bypass -File install.ps1
#   Standalone:  powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/aaronilyas/BridgeToGrowth-Learning/main/install.ps1 | iex"
#
# Settings (environment variables):
#   BTG_DIR=<path>     where to put the source when downloading it (default: %USERPROFILE%\BridgeToGrowth-Learning)
#   BTG_BRANCH=<name>  branch to download (default: main)
#
# Written for Windows PowerShell 5.1, which every supported Windows ships with.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the 5.1 progress bar makes downloads many times slower
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$BtgRepo = 'aaronilyas/BridgeToGrowth-Learning'
$BtgBunVersion = '1.4.4'   # the version CI builds with; an existing Bun 1.4 or newer is kept
$BtgWebView2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }

function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Test-BunOk {
  if (-not (Test-Command 'bun')) { return $false }
  $parts = ((& bun --version) -split '\.')
  $major = [int]$parts[0]; $minor = [int]$parts[1]
  return ($major -gt 1) -or ($major -eq 1 -and $minor -ge 4)
}

function Install-Bun {
  $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
  if ($env:BUN_INSTALL) { $bunBin = Join-Path $env:BUN_INSTALL 'bin' }
  $env:Path = "$bunBin;$env:Path"
  if (Test-BunOk) { Write-Host "Bun $(& bun --version) is installed."; return }

  if (Test-Command 'bun') {
    Write-Step "Upgrading Bun $(& bun --version) (1.4 or newer is required)"
    & bun upgrade
    if ($LASTEXITCODE -ne 0) { throw 'bun upgrade failed.' }
  } else {
    Write-Step "Installing Bun $BtgBunVersion"
    $installer = Join-Path $env:TEMP 'bun-install.ps1'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bun.sh/install.ps1' -OutFile $installer
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Version $BtgBunVersion
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-BunOk)) { throw 'Bun is still missing or too old. Open a new terminal and run the installer again.' }
}

# The desktop window is Microsoft Edge WebView2. Windows 11 includes it; some Windows 10 machines do not.
function Test-WebView2 {
  $keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$BtgWebView2Guid",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$BtgWebView2Guid",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$BtgWebView2Guid"
  )
  foreach ($key in $keys) {
    $item = Get-ItemProperty -Path $key -Name pv -ErrorAction SilentlyContinue
    if ($item -and $item.pv -and $item.pv -ne '0.0.0.0') { return $true }
  }
  return $false
}

function Install-WebView2 {
  if (Test-WebView2) { Write-Host 'Microsoft Edge WebView2 runtime is installed.'; return }
  Write-Step 'Installing the Microsoft Edge WebView2 runtime'
  $bootstrapper = Join-Path $env:TEMP 'MicrosoftEdgeWebview2Setup.exe'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
  $proc = Start-Process -FilePath $bootstrapper -ArgumentList '/silent', '/install' -Wait -PassThru
  Remove-Item $bootstrapper -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0 -and -not (Test-WebView2)) {
    Write-Warning "The WebView2 installer exited with code $($proc.ExitCode). The app window needs it: https://developer.microsoft.com/microsoft-edge/webview2/"
  }
}

function Test-Checkout([string]$Dir) {
  if (-not $Dir) { return $false }
  $pkg = Join-Path $Dir 'package.json'
  return (Test-Path $pkg) -and ((Get-Content $pkg -Raw) -match '"name": "bridgetogrowth-learning"')
}

function Get-Source {
  if (Test-Checkout $PSScriptRoot) { return $PSScriptRoot }
  if (Test-Checkout (Get-Location).Path) { return (Get-Location).Path }

  $branch = 'main'
  if ($env:BTG_BRANCH) { $branch = $env:BTG_BRANCH }
  $dest = Join-Path $env:USERPROFILE 'BridgeToGrowth-Learning'
  if ($env:BTG_DIR) { $dest = $env:BTG_DIR }

  if ((Test-Path (Join-Path $dest '.git')) -and (Test-Command 'git')) {
    Write-Step "Updating the source in $dest"
    & git -C $dest pull --ff-only
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not update $dest; building the copy that is there." }
    return $dest
  }
  if (Test-Checkout $dest) { Write-Step "Using the existing source in $dest"; return $dest }
  if ((Test-Path $dest) -and (Get-ChildItem $dest -Force | Select-Object -First 1)) {
    throw "$dest exists and is not a BridgeToGrowth Learning folder. Set BTG_DIR to another path."
  }

  Write-Step "Downloading the source to $dest"
  if (Test-Command 'git') {
    & git clone --depth 1 --branch $branch "https://github.com/$BtgRepo.git" $dest
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }
    return $dest
  }
  $zip = Join-Path $env:TEMP 'btg-source.zip'
  $unpacked = Join-Path $env:TEMP 'btg-source'
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$BtgRepo/archive/refs/heads/$branch.zip" -OutFile $zip
  if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $unpacked
  $inner = Get-ChildItem $unpacked -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $dest -Recurse -Force
  Remove-Item $zip, $unpacked -Recurse -Force -ErrorAction SilentlyContinue
  return $dest
}

function Invoke-BtgInstall {
  $arch = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').PROCESSOR_ARCHITECTURE
  Write-Host "BridgeToGrowth Learning installer (Windows $arch)"
  if ($arch -ne 'AMD64') { Write-Warning 'The desktop app is built and tested for 64-bit Intel/AMD Windows. Other CPUs may fail to build.' }

  Install-WebView2
  Install-Bun
  $src = Get-Source
  Set-Location $src

  Write-Step 'Installing JavaScript dependencies'
  & bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }

  & bun scripts/make-app.ts
  if ($LASTEXITCODE -ne 0) { throw 'The build failed. See the messages above.' }

  $out = Join-Path $src 'artifacts'
  Write-Host "`nSource folder: $src"
  Write-Host "Your app is in: $out"
  if (Test-Path $out) { Start-Process explorer.exe $out }
}

# Errors end the script with a message instead of a stack trace. `exit` is only used when run as a
# file: under `irm | iex` it would close the user's PowerShell window.
$btgFailed = $false
try {
  Invoke-BtgInstall
} catch {
  Write-Host "`ninstall: $($_.Exception.Message)" -ForegroundColor Red
  $btgFailed = $true
}
if ($PSCommandPath) { if ($btgFailed) { exit 1 } else { exit 0 } }
