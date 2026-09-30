$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $root 'data\runtime\cap-processes.json'
if (!(Test-Path -LiteralPath $manifest)) { 'CAP: no hay registro de procesos; no se detuvo ningún proceso.'; exit 0 }
$state = [System.IO.File]::ReadAllText($manifest) | ConvertFrom-Json
if ($state.root -ne $root) { throw 'El registro no corresponde a este proyecto.' }
$supervisor = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisor)"
if (!$supervisor) { 'CAP: supervisor ya detenido; no se tocaron procesos ajenos.'; exit 0 }
if ($supervisor.Name -ne 'node.exe' -or $supervisor.CommandLine -notmatch 'scripts[/\\]dev-all\.mjs') { throw 'PID reutilizado o supervisor ajeno: no se detuvo nada.' }
$children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $state.supervisor -and $_.ProcessId -in $state.children -and $_.Name -in @('node.exe','cloudflared.exe') })
Stop-Process -Id $state.supervisor -ErrorAction SilentlyContinue
foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
'CAP: supervisor y procesos propios detenidos.'
