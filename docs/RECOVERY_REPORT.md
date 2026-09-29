# Recuperación CAP Inbox — 2026-09-29

> Informe histórico de la fase Quick Tunnel. El arranque `dev:full` descrito aquí fue reemplazado por Named Tunnel obligatorio. Consulta [`PHASE_REPORT.md`](PHASE_REPORT.md) y `README.md` para operación actual.

## Causa raíz y restauración

- Stack confirmado: `package.json` único en raíz; Express/TypeScript puerto 3100, Vue 3/Vite puerto 5173, worker SQLite durable, Socket.IO en backend, `cloudflared` Quick Tunnel, MessageSync subscription y n8n AI Engine. No es Laravel.
- El túnel anterior permanecía como proceso pero sus logs muestran fallos de conexión y su HTTPS externo no respondió. MessageSync seguía apuntando a ese hostname. `AUTO_REGISTER_WEBHOOK=false` impedía la rotación automática. Causa reproducida antes de modificar arquitectura.
- Se lanzó túnel HTTP/2 accesible por HTTPS, se consultó MessageSync (una subscription CAP hacia URL antigua), se creó destino nuevo y se borró **solo** la subscription CAP anterior mediante el DELETE que utiliza `n8n-nodes-message-sync-ai@0.1.3`. Confirmado: exactamente una subscription CAP actual, cero otras en la consulta. No se tocó Location, credenciales ni workflows n8n.
- `npm run dev:full` repite esta rotación en futuros arranques; sigue siendo un Quick Tunnel temporal. URL estable real requiere Named Tunnel y dominio configurados por propietario.
- Respaldos previos: SQLite consistente comprobada con `integrity_check=ok` y archivo ZIP de código/configuración **no secreta**, ambos bajo `data/backups/` (fuera de Git). No se copió `.env` al backup público.

## Resultados comprobados

| Área | Resultado | Evidencia/límite |
|---|---|---|
| Arranque | PASS local | `dev:full` levantó 4 procesos supervisados, esperó readiness y rotó el webhook; `doctor` pasó 0 fallos con servicios activos. Frontend CAP usa 5174 para no interferir con otro proyecto que ocupa 5173. `dev:all` es solo local. |
| DB/worker | PASS local | SQLite integrity OK, 0 jobs FAILED/PENDING en doctor, heartbeat real de worker y endpoint readiness. |
| MessageSync API/webhook | PASS configuración y conectividad | API devuelve una subscription propia y el túnel público responde. Inbound WhatsApp real **pendiente**. |
| Outbound MessageSync | PARTIAL | Simulado con mock en tests; ninguna nueva entrega WhatsApp real demostrada. |
| n8n AI Engine | PASS petición directa | POST sintético al Production Webhook respondió HTTP 200, `success=true`, `route=AI`, `reply` no vacío. Integración WhatsApp→backend→n8n→WhatsApp aún pendiente. |
| Seguridad/RBAC | PASS pruebas locales | AGENT Cesar/Daniel no acceden a chats ajenos (403); SUPERADMIN Victor sí (200); transferencia atómica cambia acceso, audit y aviso Socket scoped. Falta ciclo UI real de tres cuentas. |
| Disposition/cierre | PASS tests locales | Resultado obligatorio (400 si falta), cierre entrega despedida antes de archivar y falla sin cerrar; no se ha probado en WhatsApp real. |
| Media | PARTIAL | Download privado, image/audio fixtures y pruebas simuladas; falta reproducción visual de imagen/audio/video/documento reales. |
| Layout | PARTIAL | CSS viewport y scroll por panel implementados; no hay verificación automatizada a 1366/1920/2560 ni móvil real. |
| Tests | PASS local | `npm run build`; `npm test` 14/14; `npm run test:load` 2700 eventos aceptados, cero IA, cero secuencias duplicadas, cero jobs fallidos. |
| Carga | PARTIAL | 64 conexiones HTTP simultáneas como máximo. 100: p50 290/p95 411/p99 411ms, 241 req/s; 500: 1058/1690/1736ms, 288 req/s; 1000: 1667/2974/3079ms, 324 req/s; 100 mismo contacto: 201/323/324ms, 309 req/s; 1000 contactos adicionales: 1739/3112/3226ms, 309 req/s. **No se probó 5000 ni 500 sockets verdaderamente simultáneos**. |

## Alcance pendiente (sin marcar PASS)

- Prueba real de una ronda WhatsApp: bienvenida → opción inválida → handoff → imagen/audio → claim → respuesta humana → transferencia Cesar/Daniel → intervención Victor → cierre tipificado → reapertura. Consultar `TEST_PLAN.md`. No ejecutar campañas todavía.
- Métricas completas por agente, usuarios/roles administrables desde UI, notas, tags, panel e historial de contacto, control de presencia AWAY/BUSY, campaña DRAFT/importación/supresión/ratelimit/pausa/cancelación y métricas globales: **no implementados**. No hay envío masivo real. La bandeja e inbox actuales no son un producto multi-tenant.
- Outbound queue durable con retries 1/5/15/60 y reconciliación de `DELIVERED`/`READ` no implementados; salidas quedan persistidas antes de envío y en `failed` si falla; reintento humano manual para evitar duplicados por timeout ambiguo del provider. Los jobs durables actuales procesan **inbound**. No afirmar garantía de respuesta cuando MessageSync cae.
- Named Tunnel/hostname estable no configurado. `doctor` comprueba host n8n, no garantiza salud del workflow sin petición funcional. PostgreSQL/Redis/Object Storage son adaptadores futuros, no desplegados. No afirmar alta disponibilidad ni capacidad de producción.

## Operación

```powershell
cd "C:\Users\PC\Desktop\web demo"
npm run dev:full
```

Este único comando arranca backend, worker, frontend y túnel con rotación automática de la suscripción propia. `Ctrl+C` detiene su grupo. Para desarrollo sin webhook público: `npm run dev:all`. Ejecutar `npm run doctor` **después** de levantar el servidor; antes muestra FAIL esperado de servicios apagados. `npm run dev:backend`, `npm run dev:frontend` y `npm run dev:worker` existen para diagnósticos; no iniciar worker externo junto a backend embebido. No usar `php artisan serve`.
