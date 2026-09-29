param([switch]$NoTunnel,[switch]$Restart)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $PSScriptRoot '.demo-pids.json'
if (Test-Path -LiteralPath $pidFile) {
  $running = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $backend = Get-CimInstance Win32_Process -Filter "ProcessId = $($running.backend)" -ErrorAction SilentlyContinue
  $frontend = Get-CimInstance Win32_Process -Filter "ProcessId = $($running.frontend)" -ErrorAction SilentlyContinue
  if ($backend.CommandLine -match 'app/backend/src/server\.ts' -and $frontend.CommandLine -match 'app/frontend/vite\.config\.ts') {
    if ($Restart) { & (Join-Path $PSScriptRoot 'stop-demo.ps1') }
    else { 'La demo ya está levantada: http://127.0.0.1:5173'; return }
  }
}
$envFile = Join-Path $project '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Falta .env. Copia .env.example a .env y configura el administrador.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instala Node.js 22 o posterior.' }
if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))) { & npm install --no-audit --no-fund --prefix $project; if ($LASTEXITCODE -ne 0) { throw 'npm install falló' } }
& npm run build --prefix $project
if ($LASTEXITCODE -ne 0) { throw 'Build falló' }
$content = [System.IO.File]::ReadAllText($envFile)
if ($content -match '(?m)^WEBHOOK_INGRESS_SECRET=$') {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $content = [regex]::Replace($content, '(?m)^WEBHOOK_INGRESS_SECRET=$', "WEBHOOK_INGRESS_SECRET=$secret")
  [System.IO.File]::WriteAllText($envFile, $content)
  $content = $null
  $secret = $null
}
if ([System.IO.File]::ReadAllText($envFile) -match '(?m)^N8N_INTERNAL_TOKEN=$') {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $data = [System.IO.File]::ReadAllText($envFile)
  $data = [regex]::Replace($data,'(?m)^N8N_INTERNAL_TOKEN=$',"N8N_INTERNAL_TOKEN=$secret")
  [System.IO.File]::WriteAllText($envFile,$data)
  $data = $null
  $secret = $null
}
$pids = @{}
if (-not $NoTunnel -and (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  $log = Join-Path $project 'tunnel.log'
  $tunnel = Start-Process -FilePath 'cloudflared.exe' -ArgumentList @('tunnel','--url','http://127.0.0.1:3100','--no-autoupdate') -PassThru -WindowStyle Hidden -RedirectStandardError $log
  $pids.tunnel = $tunnel.Id
  $url = ''
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $log) {
      try {
        $stream = [System.IO.File]::Open($log,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
        try {
          $reader = [System.IO.StreamReader]::new($stream)
          $text = $reader.ReadToEnd()
          $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
          if ($match.Success) { $url = $match.Value; break }
        } finally { if ($reader) { $reader.Dispose() } else { $stream.Dispose() } }
      } catch [System.IO.IOException] { }
    }
  }
  if ($url) {
    $data = [System.IO.File]::ReadAllText($envFile)
    $data = [regex]::Replace($data, '(?m)^PUBLIC_URL=.*$', "PUBLIC_URL=$url")
    [System.IO.File]::WriteAllText($envFile, $data)
    "Tunnel: $url"
  } else { 'Tunnel no disponible; backend local iniciado sin URL pública.' }
}
$backendLog = Join-Path $project 'backend.log'
$backendErr = Join-Path $project 'backend-error.log'
$frontendLog = Join-Path $project 'frontend.log'
$frontendErr = Join-Path $project 'frontend-error.log'
$back = Start-Process -FilePath 'node.exe' -ArgumentList @('--import','tsx','app/backend/src/server.ts') -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr
$pids.backend = $back.Id
$front = Start-Process -FilePath 'node.exe' -ArgumentList @('node_modules/vite/bin/vite.js','--config','app/frontend/vite.config.ts','--host','127.0.0.1') -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErr
$pids.frontend = $front.Id
$pids | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.demo-pids.json')
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3100/api/me' -UseBasicParsing -TimeoutSec 2; $ready = $true; break } catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $ready = $true; break } }
}
if (-not $ready) { throw 'Backend no responde. Revisa backend-error.log.' }
'Frontend: http://127.0.0.1:5173'
'Backend local: http://127.0.0.1:3100'
'Health requiere iniciar sesión. Para detener: .\scripts\stop-demo.ps1'
