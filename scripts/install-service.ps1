# Installs the platform as an always-on Windows service (NSSM). Run in an elevated PowerShell:
#   cd C:\apps\hadiyah-platform ; powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
# Keep this file ASCII only (Windows PowerShell 5 breaks on other encodings).
param(
  [string]$Name = 'HadiyahPlatform',
  [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
$dir = (Resolve-Path "$PSScriptRoot\..").Path
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path "$dir\.env")) { throw ".env not found in $dir - create it first (copy .env.example)" }
New-Item -ItemType Directory -Force "$dir\logs", "$dir\tools" | Out-Null

# 1) free the port from any manually started copy (npm start)
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# 2) get NSSM
$nssm = "$dir\tools\nssm.exe"
if (-not (Test-Path $nssm)) {
  $zip = "$env:TEMP\nssm.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
  Expand-Archive $zip "$env:TEMP\nssm" -Force
  Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssm
}

# 3) (re)create the service
if (Get-Service $Name -ErrorAction SilentlyContinue) { & $nssm stop $Name | Out-Null; & $nssm remove $Name confirm | Out-Null }
& $nssm install $Name $node 'server\index.js' | Out-Null
& $nssm set $Name AppDirectory $dir | Out-Null
& $nssm set $Name AppEnvironment "PORT=$Port" "NODE_ENV=production" | Out-Null
& $nssm set $Name Start SERVICE_AUTO_START | Out-Null
& $nssm set $Name AppExit Default Restart | Out-Null
& $nssm set $Name AppRestartDelay 5000 | Out-Null
& $nssm set $Name AppStdout "$dir\logs\service.log" | Out-Null
& $nssm set $Name AppStderr "$dir\logs\service.err.log" | Out-Null
& $nssm set $Name AppRotateFiles 1 | Out-Null
& $nssm set $Name AppRotateBytes 10485760 | Out-Null

# 4) firewall (only needed if people reach the port directly; with IIS in front you can remove this rule)
if (-not (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}
& $nssm start $Name
Start-Sleep 5
Get-Service $Name
try { (Invoke-WebRequest "http://localhost:$Port/login/" -UseBasicParsing -TimeoutSec 10).StatusCode | ForEach-Object { "HTTP $_ - OK" } }
catch { "Service started but http://localhost:$Port/login/ did not answer; see $dir\logs\service.err.log" }
