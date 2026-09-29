$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot '.demo-pids.json'
if (-not (Test-Path -LiteralPath $file)) { 'La demo no tiene procesos registrados.'; return }
$record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
foreach ($name in @('backend','frontend','tunnel')) {
  $id = $record.$name
  if ($id) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    $expected = switch ($name) {
      'backend' { 'app/backend/src/server\.ts' }
      'frontend' { 'app/frontend/vite\.config\.ts' }
      'tunnel' { 'tunnel\s+--url\s+http://127\.0\.0\.1:3100' }
    }
    if ($proc -and $proc.CommandLine -match $expected) { Stop-Process -Id $id; "Detenido: $name" }
  }
}
Remove-Item -LiteralPath $file
