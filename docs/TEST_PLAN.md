# Única ronda final de QA manual — pendiente

**Precondición:** propietario reinicia solo backend con `& "C:\Users\PC\Desktop\web demo\scripts\restart-backend.ps1"`, manteniendo frontend y Cloudflare Tunnel. Antes de enviar WhatsApp, validar login, `GET /api/health`, suscripción HTTPS de CAP Inbox y migración `integrity_check=ok`. No activar el workflow antiguo: una doble suscripción provocaría doble respuesta.

Usa **un número de prueba que NO tenga sesión humana activa**. Si ya tiene sesión, ciérrala desde CAP Inbox antes de empezar. Envía estos mensajes en este orden y compara el teléfono con la bandeja; al final comunica el resultado de toda la secuencia de una sola vez:

1. `Hola` → menú recibido; **no** aparece en CAP Inbox.
2. `9` → opciones inválidas; **no** aparece en CAP Inbox, **0** n8n.
3. `1` → preset de producto, todavía **no** aparece en CAP Inbox.
4. Envía rápidamente `Necesito`, `amortiguadores`, `para Hilux 2018` → una respuesta IA (objetivo: una ejecución n8n gracias al debounce).
5. `menu` → menú directo, sin ejecución adicional n8n.
6. `4`, seguido inmediatamente por `Hola asesor` y `Necesito ayuda` → una sola transferencia; ahora **sí** aparece en Esperando asesor y muestra TODO el historial en orden. Los dos mensajes posteriores no reciben bot ni invocan n8n.
7. Envía **una imagen** y **un audio** → verificar imagen clicable y audio reproducible/descargable en CAP Inbox; no IA.
8. En CAP Inbox pulsa **Tomar conversación** → saludo humano; responde desde web `Claro, ¿qué piezas necesitas?`; confirmar recepción por WhatsApp.
9. Pulsa **Cerrar conversación** → despedida en WhatsApp y desaparición inmediata de la bandeja; sigue disponible en Cerrados.
10. Escribe `Hola de nuevo` desde el mismo WhatsApp → menú; sesión nueva en DB; la anterior sigue archivada y sin mezclarse.

Anota si llegaron al teléfono menú, preset, IA, transferencia, saludo, mensaje humano y despedida. El agente puede recargar F5/desconectar Socket.IO entre pasos 7 y 8: el historial debe reconstruirse sin cambios de orden. Tras la ronda comparar `GET /api/metrics`, filas/sequence/jobs en SQLite y ejecuciones reales de n8n. No declarar PASS de WhatsApp, reproducción real ni eficiencia sin esa comprobación.
