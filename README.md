# CAP / inbox — Centro de atención híbrido

La web es el router principal: **MessageSync → backend → menú, IA o asesor**. Solo los mensajes de texto libre en modo `AI` invocan el workflow de n8n. La conversación humana entra y sale directamente por MessageSync; las respuestas preset tampoco pasan por n8n. Se conserva la Location **Grupo CAP**.

## Arranque

Requiere Node.js 22+, PowerShell y `cloudflared` en `PATH` para acceso público. En `Desktop\web demo` configura `.env` a partir de `.env.example` sin incluir secretos en el repositorio. Ejecuta:

```powershell
& "C:\Users\PC\Desktop\web demo\scripts\start-demo.ps1"
```

Abre `http://127.0.0.1:5173`; el túnel HTTPS se muestra en consola y sirve también el frontend compilado. El script instala dependencias si faltan, compila, inicia backend/frontend/túnel, actualiza `PUBLIC_URL` y comprueba el backend. Es idempotente si la demo ya funciona. Para actualizar código usa `-Restart`; para detener, `& "C:\Users\PC\Desktop\web demo\scripts\stop-demo.ps1"`. Los scripts usan PIDs de la demo; la URL de `trycloudflare.com` cambia al reiniciar.

Si solo cambiaste `.env` y quieres conservar **la misma URL del túnel y el frontend abierto**, ejecuta `& "C:\Users\PC\Desktop\web demo\scripts\restart-backend.ps1"` en PowerShell. Recarga únicamente el backend y comprueba que responde.

## Modos y atención

- Primer mensaje o conversación cerrada: `MENU`, responde bienvenida sin n8n.
- Opciones `1`, `2`, `3`: preset directo y modo `AI` con intención de productos, cotización o consulta general; el siguiente texto libre llama al AI Engine una vez.
- Opción `4` o petición explícita de asesor: transferencia preset, evento `handoff_requested`, `HUMAN_PENDING`. Los mensajes posteriores se almacenan y aparecen sin respuesta automática.
- Tomar conversación: transición atómica a `HUMAN_ACTIVE`; respuesta inicial del asesor y envíos posteriores desde CAP Inbox directamente por MessageSync.
- Devolver al bot: `MENU` y preset directo. Cerrar: `CLOSED`; el siguiente mensaje reabre y recibe bienvenida.
- `menu`, `menú`, `inicio`, `0` vuelven al menú desde modos automáticos. Si falla n8n se guarda el mensaje, aparece el preset de error y se puede solicitar asesor o reintentar. Imágenes, audio y video no llaman IA; en modo humano se almacenan sin respuesta.

Los mensajes y eventos se persisten en SQLite `data/chat.sqlite`. El `provider_message_id` y `provider_event_id`, cuando existen, son únicos. Cada conversación asigna `sequence` dentro de una transacción y tiene índice `UNIQUE(conversation_id,sequence)`. Los trabajos inbound se registran en la misma transacción y un worker con lease procesa por conversación; `FAILED` queda visible en `/api/jobs/failed` y admite reintento controlado. Socket.IO avisa después del commit; la API permite `?afterSequence=` y `?beforeSequence=` para recuperar mensajes o paginar. La bandeja operativa muestra solo `HUMAN_PENDING` y `HUMAN_ACTIVE`; el filtro Cerrados es archivo histórico. Mensajes de bot/IA se conservan en SQLite y se muestran al asesor tras el handoff. La configuración del menú/cierre está en `config/menu.json`.

Un cierre humano envía el mensaje final por MessageSync y solo entonces archiva la sesión; si falla, vuelve a `HUMAN_ACTIVE` con burbuja fallida para reintento manual. El siguiente inbound del contacto crea **otra conversación**; la sesión anterior queda íntegra. `clientRequestId` del frontend y `reply_to_message_id` de los bots evitan duplicados por doble pestaña/replay. La detección de mensajes media utiliza el arreglo real `message.media:[{url,type}]` visto en los eventos de CAP. El servidor descarga por streaming solo desde `https://storage.googleapis.com`, valida tamaño, MIME y firma, guarda UUIDs bajo `uploads/media`, y sirve archivos con autenticación desde `/api/media/:id`. Nunca entrega URLs firmadas del proveedor al browser. Ogg/Opus se convierte opcionalmente a MP3 cuando ffmpeg está disponible; si no, el browser ofrece descarga.

`AUTO_ASSIGN_HUMAN=false` por defecto conserva el claim manual. En modo true, solo agentes ONLINE con heartbeat reciente y capacidad disponible reciben los pendientes FIFO mediante least-loaded y desempate por `last_assigned_at`; perder el socket no quita chats activos. La carga se calcula desde conversaciones en DB; el contador del agente es derivado. La IA agrupa texto libre sucesivo con `AI_MESSAGE_DEBOUNCE_MS=1200`, limita llamadas por contacto y abre circuit breaker temporal tras cinco fallos; los mensajes HUMAN/MENU/media no consumen IA. `DATABASE_DRIVER=sqlite` y `QUEUE_DRIVER=database` son los drivers implementados; otros valores dan error explícito. PostgreSQL/Redis quedan como integración futura, no como capacidad soportada actualmente.

## n8n y MessageSync

Importa **manualmente** `n8n/CAP_WhatsApp_AI_Engine.json`. Selecciona en el nodo OpenAI Chat Model la credencial OpenAI existente, comprueba `gpt-5-mini`, activa el workflow y obtén la **Production Webhook URL**. Colócala solo en backend `.env` como `N8N_AI_WEBHOOK_URL`, después reinicia con `-Restart`. El workflow recibe `mode: AI`, `sessionId` e historial limitado; responde `{ "success": true, "route": "AI", "reply": "..." }`. No contiene nodos de MessageSync ni credenciales. El header opcional `X-CAP-Internal-Token` se envía si existe `N8N_INTERNAL_TOKEN`; para exigirlo en n8n configura autenticación allí manualmente, sin agregar el secreto al JSON. La importación y cualquier modificación de n8n son tarea del propietario.

MessageSync usa la API `/v1/whatsapp/outbound` y `/v1/webhooks/subscriptions` tal como el community node `n8n-nodes-message-sync-ai@0.1.3`. El webhook público es `/webhooks/messagesync/<WEBHOOK_INGRESS_SECRET>` (secreto privado, nunca compartir en documentación). `AUTO_REGISTER_WEBHOOK=false` impide registros involuntarios: tras confirmar que no habrá doble respuesta, un administrador autenticado puede usar `POST /api/subscription/register`. `GET /api/subscription/status` consulta suscripciones existentes. El paquete solo documenta crear y borrar suscripciones, no actualizarlas; tras cambiar el túnel se debe revisar y sustituir **únicamente la suscripción propia**. Nunca borrar la suscripción del flujo n8n antiguo sin confirmar su desactivación manual. El backup del workflow antiguo está en `n8n/backups/` (ignorado por Git).

## Pruebas y diagnósticos

`npm run build` y `npm test` verifican compilación, normalización, opciones, deduplicación, cierre/reapertura, estados humanos, medios y fallback con servicios externos simulados. `npm run test:load` ejecuta carga completamente aislada en SQLite en memoria y **no contacta** MessageSync/n8n/WhatsApp. El cliente limita el transporte a 64 conexiones; por tanto 1000 solicitudes lógicas no equivalen a 1000 sockets simultáneos. `node scripts/check-migration.mjs` prueba la migración en una copia de la SQLite real sin modificar la base viva. Antes de una migración de esquema se crea además un backup consistente en `data/backups/`; no borrar estos archivos de auditoría. Con sesión activa se dispone de `/api/health`, `/api/metrics`, `/api/jobs/failed` y `POST /api/jobs/:id/retry`. `configured` en health solo indica presencia de configuración. La prueba de WhatsApp real posterior a la estabilización sigue pendiente; ver `docs/TEST_PLAN.md`.

Si la web recibe mensajes y el workflow viejo sigue respondiendo, hay **riesgo de doble respuesta**: desactívalo manualmente en n8n antes de la prueba final; no lo borres. Si falla un envío humano, queda visible como `failed` y se permite reintento manual después de comprobar que no haya llegado al cliente. Los callbacks outbound no reentran al router; estados de entrega solo se actualizarán cuando se verifique el payload real del proveedor.
