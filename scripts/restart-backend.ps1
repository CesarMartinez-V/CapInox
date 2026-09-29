$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $PSScriptRoot '.demo-pids.json'
if (-not (Test-Path -LiteralPath $pidFile)) { throw 'Primero inicia la demo con start-demo.ps1.' }
$record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
$old = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.backend)" -ErrorAction SilentlyContinue
if (-not $old -or $old.CommandLine -notmatch 'app[\\/]backend[\\/]src[\\/]server\.ts') { throw 'El PID del backend no pertenece a CAP Inbox; no se detuvo ningún proceso.' }
Stop-Process -Id $record.backend
try { Wait-Process -Id $record.backend -Timeout 10 -ErrorAction SilentlyContinue } catch { }
$back = Start-Process -FilePath 'node.exe' -ArgumentList @('--import','tsx','app/backend/src/server.ts') -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $project 'backend.log') -RedirectStandardError (Join-Path $project 'backend-error.log')
$record.backend = $back.Id
$record | ConvertTo-Json | Set-Content -LiteralPath $pidFile
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/me' -UseBasicParsing -TimeoutSec 2
    'Backend actualizado. Frontend y túnel permanecen abiertos.'; return
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
      'Backend actualizado. Frontend y túnel permanecen abiertos.'; return
    }
  }
}
throw 'El backend no respondió. Revisa backend-error.log.'
