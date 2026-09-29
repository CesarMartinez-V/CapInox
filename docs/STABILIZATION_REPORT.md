# Estabilización — estado antes de QA final

Fecha: 2026-09-28. El backend **en ejecución** no incorporará las modificaciones hasta que su propietario ejecute `scripts/restart-backend.ps1`; no confundir las pruebas offline con pruebas reales del nuevo build.

## Diagnóstico reproducido

- Bandeja: la consulta previa devolvía 3 conversaciones aunque 0 eran humanas.
- Orden: `COALESCE(provider_timestamp,created_at)` mezclaba fechas ISO con fechas SQLite. La secuencia se asigna ahora dentro de la transacción y se consulta por `sequence ASC`.
- Media: tres eventos reales guardados traen `message.media` como arreglo de `{url,type}` (imagen, audio, imagen); las tres URLs del proveedor respondieron HTTP 200 desde servidor, con MIME `image/webp`, `audio/mpeg` e `image/jpeg`. El normalizador previo trataba el arreglo como objeto y clasificaba los tres como texto.
- Cierre previo: cambiaba modo inmediatamente y reutilizaba una única conversación por contacto. Ahora envía despedida antes de archivar y crea sesión nueva después del cierre.
- Menú inválido: el router anterior ya evitaba IA en `MENU`; se añadieron regresiones, contador y matching único. No se atribuye a IA un fallo que no se pudo reproducir en ese modo.
- Backup SQLite verificado en `data/backups/`, ignorado por Git. La migración automática crea otro backup consistente antes de modificar el esquema. Ensayo de migración en una copia de la base real: registros preservados, secuencias completas, 3 media identificados, `integrity_check=ok`, 0 errores FK.

## Implementado y verificado localmente

- Bandeja operativa humana y filtro Cerrados como archivo; paginación de conversaciones/mensajes y cursor `afterSequence` para reconexión.
- `UNIQUE(conversation_id,sequence)`, confirmación inbound+job en transacción, salida posterior al inbound y notificación Socket.IO tras persistir. Sesiones históricas independientes.
- Normalización basada en array real, descarga media server-side en streaming desde host GCS permitido, UUID, límite, MIME+firma, endpoint autenticado, audio MP3/Ogg/Opus opcionalmente transcodificado cuando ffmpeg existe, fallback descargable.
- Cierre con envío final configurable, error visible y reintento sin nueva burbuja; transición central para claim, retorno, handoff y cierre. Mensaje humano con clientRequestId.
- Jobs durables con lease, intento limitado y lista de fallidos. Multiagente opcional con presencia, capacidad, menos cargado y FIFO de handoff. Debounce de IA, rate limit por contacto y circuit breaker temporal.
- Build y **13 pruebas** pasaron. Ensayo de carga **sin llamadas externas**: 2700 eventos aceptados, 0 errores con transporte limitado a 64 conexiones, 0 IA, 0 secuencias duplicadas o con huecos, 0 jobs fallidos; pico RSS 325 MB. P95: 100 contactos 515 ms; 500 contactos 1565 ms; 1000 contactos 3086 ms; 100 mensajes del mismo contacto 264 ms; otros 1000 contactos 3083 ms. P99: 515, 1608, 3199, 264, 3192 ms respectivamente. Cifras de una ejecución local, no garantía de producción.

## Fallos y límites no ocultados

- **500 conexiones HTTP realmente simultáneas en Windows: FAIL** en el primer ensayo sin límite (268 `ECONNREFUSED` de 500; otra ejecución 172/500). La carga final coloca hasta 64 conexiones de transporte simultáneas; 500/1000 son solicitudes lógicas encoladas del cliente, no 500/1000 sockets simultáneos. No declarar soporte de miles de conexiones.
- Envíos con timeout del proveedor son de resultado desconocido; el reintento manual puede duplicar si el proveedor aceptó el primer envío. La API inspeccionada no documenta una idempotency key para outbound.
- No se ha capturado un callback real `delivered/read`; los outbound/status no crean nuevas burbujas ni reentran al router, pero la reconciliación de estados de entrega requiere un payload confirmado.
- PostgreSQL, Redis/BullMQ y object storage aún **no están implementados**. La demo ejecuta SQLite/cola DB/local disk y rechaza elegir otros drivers en configuración. El autobalanceo multiinstancia entre servidores no está validado.
- El circuito IA y rate limiting de login son locales al proceso; un despliegue multinodo requiere estado compartido. El test de reconnect cubre API cursor y lógica frontend, no la pérdida real de Wi-Fi en un navegador.
- La imagen y el audio reales todavía deben verificarse **en el nuevo build** desde WhatsApp y CAP Inbox. Ninguna prueba offline sustituye confirmación del teléfono.

## Única ronda manual pendiente

Aplicar backend con `scripts/restart-backend.ps1` (conserva túnel/frontend). Luego seguir `docs/TEST_PLAN.md`. Tras la ronda inspeccionar DB/logs/contadores y registrar PASS/FAIL real por criterio antes de declarar fin.
