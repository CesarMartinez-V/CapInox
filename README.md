# CAP / inbox — Centro de atención híbrido

La web es el router principal: **MessageSync → backend → menú, IA o asesor**. Solo los mensajes de texto libre en modo `AI` invocan el workflow de n8n. La conversación humana entra y sale directamente por MessageSync; las respuestas preset tampoco pasan por n8n. Se conserva la Location **Grupo CAP**.

## Arranque

Requiere Node.js 22+. En `C:\Users\PC\Desktop\web demo` conserva `.env` privado. **Desarrollo local (sin ingreso público):**

```powershell
cd "C:\Users\PC\Desktop\web demo"
npm run dev:local
```

Abre `http://127.0.0.1:5174`. Para recibir WhatsApp hace falta un **Named Tunnel real** en Cloudflare Zero Trust: crea un túnel remotamente administrado, configura en Cloudflare un **public hostname propio** cuya aplicación/origen sea `http://127.0.0.1:3100` y guarda en `.env` `PUBLIC_WEBHOOK_URL=https://<hostname-real>` (solo origen HTTPS, sin ruta ni secreto) y `CLOUDFLARE_TUNNEL_TOKEN=<token-privado>`. Alternativamente usa un túnel local ya configurado mediante `CLOUDFLARE_TUNNEL_NAME`; requiere credenciales/config Cloudflare locales. Esta máquina aún no tiene certificado de origen ni hostname verificable. `QUICK_TUNNEL_ALLOWED=false` por defecto; nunca se genera un hostname aleatorio silenciosamente. **Sin esos datos `dev:full` falla expresamente antes de iniciar servicios o modificar MessageSync.**

Con el Named Tunnel listo, ejecuta `npm run dev:full`: supervisa backend, worker, frontend y `cloudflared tunnel run` sin exponer el token en argumentos, verifica `/health/live` en el hostname público y solo entonces sincroniza la suscripción **propia** de CAP mediante los endpoints oficiales. **Ctrl+C** detiene procesos de ese comando. `npm run dev:all` es alias de `dev:local`. `npm run doctor` y `npm run doctor:json` comparan el destino exacto registrado en MessageSync con `PUBLIC_WEBHOOK_URL`; muestran FAIL mientras la instancia esté apagada o sin túnel estable. `npm run dev:backend`, `dev:worker` y `dev:frontend` existen para diagnóstico; no ejecutes dos workers a la vez. No usar `php artisan serve`.

## Modos y atención

- Primer mensaje o conversación cerrada: `MENU`, responde bienvenida sin n8n.
- Opciones `1`, `2`, `3`: preset directo y modo `AI` con intención de productos, cotización o consulta general; el siguiente texto libre llama al AI Engine una vez.
- Opción `4` o petición explícita de asesor: comprueba usuario activo, presencia reciente, conexión y capacidad. Con capacidad, confirma handoff y asigna least-loaded; sin ella, envía el preset «Sin asesores», deja la conversación en `AI` con intención `human_unavailable_fallback` y no crea pendiente humano. Reintentos `asesor` tienen cooldown. Chats ya humanos nunca vuelven solos a IA al desconectarse el agente: se marcan para reasignación tras grace period.
- Tomar conversación: transición atómica a `HUMAN_ACTIVE`; respuesta inicial del asesor y envíos posteriores desde CAP Inbox directamente por MessageSync.
- Devolver al bot: `MENU` y preset directo. Cerrar exige tipificación comercial y entrega del mensaje final antes de `CLOSED`; el siguiente mensaje crea otra sesión y recibe bienvenida.
- `menu`, `menú`, `inicio`, `0` vuelven al menú desde modos automáticos. Si falla n8n se guarda el mensaje, aparece el preset de error y se puede solicitar asesor o reintentar. Imágenes, audio y video no llaman IA; en modo humano se almacenan sin respuesta.

Los mensajes y eventos se persisten en SQLite `data/chat.sqlite`. El `provider_message_id` y `provider_event_id`, cuando existen, son únicos. Cada conversación asigna `sequence` dentro de una transacción y tiene índice `UNIQUE(conversation_id,sequence)`. Los trabajos inbound se registran en la misma transacción y un worker con lease procesa por conversación; `FAILED` queda visible en `/api/jobs/failed` y admite reintento controlado. Socket.IO avisa después del commit; la API permite `?afterSequence=` y `?beforeSequence=` para recuperar mensajes o paginar. La bandeja operativa muestra solo `HUMAN_PENDING` y `HUMAN_ACTIVE`; el filtro Cerrados es archivo histórico. Mensajes de bot/IA se conservan en SQLite y se muestran al asesor tras el handoff. La configuración del menú/cierre está en `config/menu.json`.

Todo outbound se guarda con su job SQLite antes del intento. HTTP 429/5xx confirmados admiten reintentos 1/5/15/60 segundos con límite; 4xx quedan FAILED. Timeout o proceso caído durante SENDING pasan a `UNKNOWN` sin retransmisión automática, ya que MessageSync no documenta idempotencia de envío; un Superadmin debe reconciliarlos. El cierre devuelve `202` al guardar la despedida y permanece `CLOSING` visible: **sólo se archiva después** de la confirmación del proveedor. Si el estado queda UNKNOWN vuelve a humano; un Superadmin puede forzar cierre auditado sin repetir envío. El siguiente inbound crea **otra conversación**. `clientRequestId` y `reply_to_message_id` previenen duplicados por replay. Media privada se descarga desde URLs de proveedor confiables, valida tamaño, MIME y firma, guarda bajo `uploads/media`, sirve thumbnail cuando ffmpeg puede producirlo y protege `/api/media/:id` por permiso de conversación. Audio Ogg/Opus se convierte opcionalmente a MP3; si no, permite descarga.

La opción 4 fuerza la asignación si existe agente disponible, aunque `AUTO_ASSIGN_HUMAN=false` preserve el modo manual para otros pendientes. Heartbeat, `connection_count`, estado manual y capacidad deciden disponibilidad; multi-pestaña cuenta como un solo agente. La IA agrupa texto con `AI_MESSAGE_DEBOUNCE_MS`, limita llamadas por contacto y usa circuit breaker. Los mensajes HUMAN/MENU/media no consumen IA. `DATABASE_DRIVER=sqlite` y `QUEUE_DRIVER=database` son los únicos drivers implementados; PostgreSQL/Redis siguen pendientes.

## n8n y MessageSync

La integración actual de n8n no se cambió. Si el propietario decide actualizar el prompt para que la IA nunca prometa un handoff no confirmado, existe `n8n/CAP_WhatsApp_AI_Engine_v2.json` **sin importar ni activar**; contiene ruta de webhook diferente y necesitará su propia Production URL en `N8N_AI_WEBHOOK_URL`. Mientras tanto el backend intercepta frases comunes de falsa transferencia antes de enviarlas. El workflow recibe solo `mode: AI`, responde `{ "success": true, "route": "AI", "reply": "..." }`, y no envía mensajes por MessageSync.

MessageSync usa la API `/v1/whatsapp/outbound` y `/v1/webhooks/subscriptions` tal como el community node `n8n-nodes-message-sync-ai@0.1.3`. El webhook público es `/webhooks/messagesync/<WEBHOOK_INGRESS_SECRET>` (secreto privado, nunca compartir en documentación). `AUTO_REGISTER_WEBHOOK=false` evita registros fuera de `dev:full` o de una operación administrativa; el arranque full y `POST /api/subscription/register` sincronizan y retiran suscripciones propias antiguas. Nunca borran triggers externos de n8n. El backup del workflow antiguo está en `n8n/backups/` (ignorado por Git).

## Pruebas y diagnósticos

`npm run build`, `npm test` y `node scripts/check-migration.mjs` comprueban compilación, RBAC, fallback, cola, incidencias, migración y medios. `npm run test:load:600` (mixto) y `npm run test:load:600:human` (600 chats humanos activos) usan SQLite en memoria, proveedor/n8n simulados y hasta 64 conexiones HTTP; no demuestran rendimiento con 600 sockets reales ni con WhatsApp externo. `npm run doctor:json` no imprime credenciales. `/health/live` prueba proceso; `/health/ready` exige DB, worker y config; `/api/health` distingue transporte n8n de última ejecución IA exitosa. Reporte actualizado en `docs/PHASE_REPORT.md`.

Para auditar los **20–30 s** observados desde el túnel, consulta [`docs/LATENCY_AUDIT.md`](docs/LATENCY_AUDIT.md). `node scripts/latency-baseline.mjs` examina sólo agregados de la DB viva; `node scripts/probe-latency.mjs` sondea salud y handshake WebSocket local/público sin mensajes; `npm run test:realtime` verifica el relay entre procesos con DB aislada. El nuevo `/api/diagnostics/latency` y «Ver trazabilidad» requieren SUPERADMIN. El envío humano devuelve `202` tras persistir y encolar; el browser muestra una burbuja optimista y reconcilia por UUID. Los resultados del antiguo proceso público no se atribuyen automáticamente al build nuevo ni al servidor futuro.

Si el trigger antiguo de n8n sigue activo existe riesgo de doble respuesta: su desactivación es manual, sin borrar el backup. Los 4xx confirmados quedan `failed`; un timeout ambiguo queda `unknown` sin reintento ciego. Los callbacks de entrega `DELIVERED`/`READ` aún requieren validación del payload real de MessageSync y no se anuncian como implementados.
