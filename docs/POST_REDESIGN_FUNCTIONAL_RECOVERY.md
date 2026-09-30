# Recuperación funcional sin modificar UI Claude

## Diagnóstico confirmado

1. Al iniciar la inspección no había listeners CAP en 3100/5174, backend, worker ni Cloudflare activos. Logs anteriores registraban la salida del frontend y parada del supervisor. No se puede atribuir el apagado específico a CSS ni afirmar una causa de proceso no observada.
2. SQLite `integrity_check=ok`, 113 mensajes al inspeccionar (51 inbound / 62 outbound), 5 CLOSED inicialmente. Último inbound: 2026-09-29 17:50:46 UTC. Colas sin pendientes/fallidos. La última verificación de la aplicación encontró 6 CLOSED.
3. La única suscripción CAP de MessageSync apunta a `https://reasons-items-treasure-handbags.trycloudflare.com`; su `/health/live` falla DNS **ENOTFOUND**. No hay URL pública, nombre ni token de Named Tunnel configurados. El primer punto roto de WhatsApp entrante es el destino del webhook, antes de persistir en CAP. Que GHL reciba el mensaje no prueba entrega a esta suscripción.
4. Con la instancia actual arrancada, login y cookie funcionan, el navegador recibe JSON de APIs productivas, Socket conecta, Archivo devuelve cerradas y Métricas muestra datos reales. No se encontró mockApi/fakeSocket productivo ni sustitución de autenticación por Claude.
5. Se reprodujo HTML en `/api/does-not-exist` (404 HTML de Express, **no** index de Vite) y en `/health/live` vía Vite (200 index SPA porque faltaba proxy). No se reprodujo HTML en endpoints API válidos con servicio activo.
6. El arranque de Socket dependía de `Promise.allSettled` de health/proveedor y otras APIs; cualquier fetch sin límite demoraba el inicio. Métricas tenía error descartado y estado de carga sin salida de error. Esas debilidades también existían antes del rediseño; se corrigieron sin cambiar la identidad visual.

## Cambios realizados

- Vite proxy de `/health` y `/webhooks` al mismo backend, además de `/api` y `/socket.io` con `ws=true`.
- API desconocida devuelve 404 JSON; fallback del frontend construido excluye `/api`, `/webhooks`, `/media`, `/socket.io` y `/health`.
- Fetch autenticado same-origin con timeout 25 s y verificación explícita del content-type. Si hay incumplimiento registra path/status/type sin secretos y muestra error amigable; no convierte HTML en datos fake.
- Socket conecta antes de llamadas auxiliares externas. Boot registra errores en UI en vez de descartarlos.
- Métricas finaliza success/error/loading y permite reintentar un fallo sin animaciones ni nuevos estilos.
- Supervisor registra sus propios PIDs en `data/runtime/cap-processes.json` (ignorado). `stop:local` verifica proyecto, supervisor y parentesco y detiene solo hijos propios. `restart:local` compone stop + arranque.
- Ningún archivo CSS, token, logo ni layout aprobado se modificó durante esta recuperación. No se cambiaron credenciales, Location, n8n, configuración Cloudflare ni la suscripción de MessageSync.

## Pruebas y evidencia

| Check | Resultado |
|---|---|
| `npm run build` | PASS |
| `npm test` | **28/28 PASS** |
| Contrato JSON + eventos/reconexión autenticada Socket | 1/1 PASS, incluido en npm test |
| Vue real + Vite real + Express real en DB aislada | 1/1 PASS, incluido en npm test; sin page.route ni mock API |
| Integración navegador | Login, Socket, Archivo read-only, Métricas, nota persistida, outbound durable único y close 202/CLOSING |
| `npm run check:runtime` | PASS contra DB/aplicación local actual: 18 endpoints 200 JSON; 6 cerradas; websocket conectado; sin pageerrors ni API HTML |
| Visual post-recuperación | 12/12 PASS: Inbox, Archivo, Métricas × 1366/1920 × claro/oscuro |
| Comparación UI aprobada pre/post recuperación | **12/12, 0.000 % píxeles diferentes >25/255** |
| Comprobador realtime separado | Emitió eventos locales 53 ms / worker 200 ms; polling 58/212 ms. **Ejecución incompleta**: cleanup excedió 20 s; no se declara PASS de este comando ni se repite por indicación del usuario |
| MessageSync API | Responde; 1 suscripción CAP, 0 externas al inspeccionar |
| MessageSync inbound remoto | **BLOCKED / FAIL**: hostname de suscripción ya no resuelve |
| MessageSync outbound remoto | NO VALIDADO; adjuntos requieren URL pública estable |
| n8n | Host accesible; no ai_succeeded registrado. Ejecución real NO VALIDADA |

Los tests aislados no sustituyen pruebas WhatsApp. No se enviaron mensajes ni campañas reales. La suite visual completa de 107 había pasado antes de esta recuperación; aquí se reejecutaron solo los 12 escenarios pertinentes, no se reporta una corrida completa nueva.

## Comandos oficiales (PowerShell)

Desde `C:\Users\PC\Desktop\web demo`:

```powershell
npm run dev:local
```

Mantener esa terminal abierta: es un servidor continuo, no un comando que termina. Arranca backend 3100, worker externo y frontend 5174 sobre la misma configuración y SQLite del proyecto.

```powershell
npm run stop:local
npm run restart:local
npm run check:runtime
npm run test:integration
```

No ejecutar dos instancias CAP. La UI local es `http://127.0.0.1:5174`. El supervisor recién arrancado registra PIDs; stop no mata proyectos externos. El script stop/restart fue añadido; la nueva instancia y su registro se verificaron, pero no se repite otro restart como prueba por la indicación de omitir ese proceso.

Para entorno público:

```powershell
npm run dev:full
```

Requiere introducir manualmente en `.env` un `PUBLIC_WEBHOOK_URL` HTTPS estable y `CLOUDFLARE_TUNNEL_TOKEN` o un Named Tunnel autenticado por nombre. No hay esos valores disponibles actualmente. `dev:full` comprueba salud pública antes de sincronizar exclusivamente la suscripción propia CAP. No inicia n8n ni configura Cloudflare desde cero. Nunca publicar token ni secreto del path de webhook.

## Checkpoint remoto

**Aún no listo para prueba WhatsApp.** P0 local está comprobado. P1 remoto requiere hostname/túnel estable operable. No pedir `CAP TEST INBOUND 001` hasta que `/health/live` público responda JSON y se verifique que la única suscripción CAP apunta al destino exacto. Después se realiza una prueba de inbound, outbound, IA y cierre sin blast. Reabrir/delete/nueva conversación/campañas/audio-video salientes no eran APIs disponibles antes del rediseño y permanecen explícitamente BLOCKED; no se declaran restauradas por mocks.

Resultado: **PARTIAL — recuperación local verificada; ruta pública bloqueada por configuración manual ausente.**
