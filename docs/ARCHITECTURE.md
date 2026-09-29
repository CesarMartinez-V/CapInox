# Arquitectura CAP / inbox

```text
WhatsApp → MessageSync → webhook HTTPS backend → SQLite + jobs durables
                                                 ↓
                                         router determinístico
                            ├─ MENU/PRESET → MessageSync
                            ├─ AI → n8n AI Engine → MessageSync
                            └─ HUMAN_PENDING/ACTIVE → CAP Inbox → MessageSync
```

La bandeja operativa muestra exclusivamente conversaciones humanas pendientes/activas. El historial bot/IA se conserva y aparece tras un handoff. Los cierres archivan la sesión y el siguiente inbound crea otra conversación. Cada mensaje recibe `sequence` transaccional único por conversación; la API devuelve historial por secuencia y Socket.IO avisa tras commit. Los eventos inbound se deduplican y se procesan por trabajos persistentes con lease; el worker no retiene el webhook HTTP esperando al proveedor o a la IA.

MessageSync usa las operaciones confirmadas en `n8n-nodes-message-sync-ai@0.1.3`: `GET/POST /v1/webhooks/subscriptions`, `DELETE /v1/webhooks/subscriptions/{id}` y `POST /v1/whatsapp/outbound`. Los únicos eventos suscritos son `whatsapp.inbound` y `whatsapp.outbound`; outbound no vuelve al router. En los eventos reales guardados, la media llega como `payload.message.media: [{url,type}]`. El backend descarga desde `storage.googleapis.com` a almacenamiento local privado y expone `/api/media/:id` autenticado. Los estados `delivered/read` no tienen payload real verificado y no se sintetizan.

La plantilla [`../n8n/CAP_WhatsApp_AI_Engine.json`](../n8n/CAP_WhatsApp_AI_Engine.json) se importa manualmente y no contiene secretos. Recibe exclusivamente solicitudes de IA y devuelve JSON al backend; n8n no envía WhatsApp. La Production Webhook URL reside únicamente en `.env`. El header `X-CAP-Internal-Token` es opcional y requiere configuración de validación manual equivalente en n8n para ser efectivo; no se afirma una protección que no se haya activado.

SQLite WAL y el worker de base de datos son la implementación de la demo. PostgreSQL, Redis/BullMQ y object storage no están instalados ni comprobados. La suscripción antigua de n8n se conserva como backup ignorado por Git y no se modifica desde esta aplicación; nunca registrar un segundo inbound sin comprobar doble respuesta. El túnel temporal cambia de URL si se reinicia; `restart-backend.ps1` conserva túnel y frontend al recargar el backend.
