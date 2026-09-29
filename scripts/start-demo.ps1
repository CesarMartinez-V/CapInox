param([switch]$NoTunnel,[switch]$Restart)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if ($Restart) { throw 'Detén solo la terminal CAP anterior con Ctrl+C y vuelve a ejecutar el comando; no se detienen otros proyectos automáticamente.' }
if ($NoTunnel) { & npm run dev:local --prefix $project }
else { & npm run dev:full --prefix $project }
if ($LASTEXITCODE -ne 0) { throw 'El inicio de CAP Inbox falló. Ejecuta npm run doctor para obtener detalles.' }
