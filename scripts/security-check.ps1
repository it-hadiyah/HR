# Read-only security health check for the Hadiyah platform server (Windows). Changes NOTHING and prints NO secrets.
# Run in an elevated PowerShell:  cd C:\apps\hadiyah-platform ; powershell -ExecutionPolicy Bypass -File scripts\security-check.ps1 | Out-File security-report.txt
# Keep this file ASCII only.
$ErrorActionPreference = 'SilentlyContinue'
$dir = (Resolve-Path "$PSScriptRoot\..").Path
function H($t) { "`n=== $t ===" }

H 'OS / Node / Git'
(Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, LastBootUpTime | Format-List | Out-String).Trim()
"node: $(node --version)   npm: $(npm --version)   git: $(git --version)"
"Last Windows hotfixes:"; Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 HotFixID, InstalledOn | Format-Table | Out-String

H 'Platform service'
Get-Service HadiyahPlatform | Select-Object Name, Status, StartType | Format-Table | Out-String
$svc = Get-CimInstance Win32_Service -Filter "Name='HadiyahPlatform'"; if ($svc) { "Runs as: $($svc.StartName)   Path: $($svc.PathName)" }

H '.env flags (values hidden)'
$envf = "$dir\.env"
if (Test-Path $envf) {
  $kv = @{}; Get-Content $envf | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $kv[$Matches[1]] = $Matches[2].Trim() } }
  foreach ($k in 'PORT','HOST','COOKIE_SECURE','TRUST_PROXY','PORTAL_PUBLIC','AUTO_MIGRATE') { "{0} = {1}" -f $k, $(if ($kv.ContainsKey($k)) { $kv[$k] } else { '(not set)' }) }
  "JWT_SECRET length: $(($kv['JWT_SECRET'] | Measure-Object -Character).Characters)  (should be 32+ random chars)"
  "ADMIN_PASSWORD still present in .env: $($kv.ContainsKey('ADMIN_PASSWORD'))  (remove it after first setup)"
  "PG_ADMIN_URL still present in .env: $($kv.ContainsKey('PG_ADMIN_URL'))  (remove it after setup)"
  "DATABASE_URL user: $((($kv['DATABASE_URL'] -replace '^postgres(ql)?://','') -split ':')[0])"
  "ACL of .env:"; (Get-Acl $envf).Access | Select-Object IdentityReference, FileSystemRights | Format-Table | Out-String
} else { '.env NOT FOUND' }

H 'Listening ports (node / postgres / web)'
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 80,443,3000,3100,5432,8080 } | Select-Object LocalAddress, LocalPort, @{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}} | Sort-Object LocalPort | Format-Table | Out-String

H 'Firewall rules that allow inbound on app/db ports'
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | ForEach-Object { $p = $_ | Get-NetFirewallPortFilter; if ($p.LocalPort -in '3000','3100','5432','80','443') { [pscustomobject]@{ Name=$_.DisplayName; Port=$p.LocalPort; Remote=($_ | Get-NetFirewallAddressFilter).RemoteAddress } } } | Format-Table | Out-String

H 'IIS sites and bindings'
Import-Module WebAdministration
Get-Website | Select-Object Name, State, PhysicalPath, @{n='Bindings';e={($_.bindings.Collection | ForEach-Object { $_.protocol + ' ' + $_.bindingInformation }) -join ' | '}} | Format-List | Out-String
"HTTPS binding exists: $((Get-WebBinding | Where-Object { $_.protocol -eq 'https' } | Measure-Object).Count -gt 0)"
"Site folder contents (must contain only web.config):"; Get-ChildItem C:\inetpub\hadiyah -Force | Select-Object Name | Format-Table | Out-String
"WebDAV module present: $((Get-WebGlobalModule | Where-Object { $_.Name -like '*WebDAV*' } | Measure-Object).Count -gt 0)"

H 'PostgreSQL exposure'
$pgconf = Get-ChildItem 'C:\Program Files\PostgreSQL\*\data\postgresql.conf' | Select-Object -First 1
if ($pgconf) { Select-String -Path $pgconf.FullName -Pattern '^\s*(listen_addresses|port|ssl)\s*=' | ForEach-Object { $_.Line.Trim() }
  $hba = Join-Path $pgconf.DirectoryName 'pg_hba.conf'; "pg_hba.conf active rules:"; Get-Content $hba | Where-Object { $_ -match '^\s*(host|local)' } } else { 'postgresql.conf not found in default path' }

H 'Backups and data folders (ACL; they hold personal data and password hashes)'
foreach ($d in "$dir\backups", "$dir\data", "$dir\logs") { if (Test-Path $d) { "-- $d"; (Get-Acl $d).Access | Select-Object IdentityReference, FileSystemRights | Format-Table | Out-String; "files: $((Get-ChildItem $d -Recurse -File | Measure-Object).Count)   newest: $((Get-ChildItem $d -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime)" } }

H 'npm audit (production deps)'
Push-Location $dir; npm audit --omit=dev 2>&1 | Select-Object -Last 12; Pop-Location

H 'Local Administrators / RDP'
Get-LocalGroupMember Administrators | Select-Object Name, ObjectClass | Format-Table | Out-String
"RDP enabled: $((Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server').fDenyTSConnections -eq 0)"
"RDP NLA required: $((Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp').UserAuthentication -eq 1)"

H 'Platform app: default-credential and weak-state checks (via DB, no secrets printed)'
"Run in psql if you want: SELECT username, active, must_change_password, last_login_at FROM users ORDER BY id;"
"Done. Send security-report.txt (it contains no passwords)."
