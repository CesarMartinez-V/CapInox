# Única ronda final de QA manual — pendiente

**Precondición (pendiente):** el propietario configura Named Tunnel y hostname real en Cloudflare Zero Trust; `PUBLIC_WEBHOOK_URL` y `CLOUDFLARE_TUNNEL_TOKEN` se guardan solo en `.env`. Arranca desde `C:\Users\PC\Desktop\web demo` con `npm run dev:full` en **una** terminal y la mantiene abierta. `npm run doctor` debe confirmar URL pública estable y coincidencia EXACTA con la única suscripción CAP. Sin Named Tunnel no hacer esta ronda. No activar trigger antiguo de n8n: provocaría doble respuesta. Cesar y Daniel deben crearse desde Usuarios (passwords privados) y abrir su sesión antes de probar transferencias.

Usa **un número controlado sin sesión humana activa** y mantén al menos César o Daniel ONLINE con capacidad para la primera mitad. Verifica teléfono y bandeja después de cada paso; la comprobación de caída n8n es con mock local aislado, no interrumpas el workflow publicado.

1. `Hola` → menú recibido; **no** aparece en CAP Inbox.
2. `9` → opciones inválidas; **no** aparece en CAP Inbox, **0** n8n.
3. `1` → preset de producto, todavía **no** aparece en CAP Inbox.
4. `Bujías` (o `Bujías`, `para Hilux`, `2019` rápidamente) → respuesta IA; no prometer transferencia ya realizada.
5. `asesor` con agente ONLINE y capacidad → handoff, autoasignación, saludo humano; **0 IA adicional**.
6. El agente responde desde CAP Inbox → recepción por WhatsApp, audit y outbound `SENT`.
7. Envía imagen → miniatura/lightbox privado; agente ajeno recibe 403.
8. Envía audio → play/seek/velocidad o descarga compatible; sin IA.
9. César transfiere a Daniel ONLINE → César pierde acceso; Daniel ve historial. Si la asignación inicial fue a Daniel, reasigna a César primero desde Superadmin.
10. Victor SUPERADMIN observa e interviene sin cambiar propiedad del chat.
11. Cerrar con tipificación `Venta completada`, monto/referencia opcionales → despedida antes de archivar.
12. Cliente escribe otra vez → nueva sesión MENU, histórico separado.
13. Poner TODOS los agentes OFFLINE/AWAY o sin capacidad.
14. Otro número controlado envía `Hola`, luego `4` → preset sin agentes, `AI` con intención fallback, no HUMAN_PENDING; próximo texto libre invoca CAP IA.
15. Probar n8n indisponible **solo con mock aislado local** (`npm test` caso AI failure) → preset determinístico e incidente, sin desconectar n8n real.

Anota recepción exacta de menú, preset, IA, handoff, saludo, mensaje humano y despedida. F5/desconexión de Socket.IO deben reconstruir historial por secuencia. Contrastar después `/api/metrics/dashboard`, `/api/diagnostics`, jobs/outbound y ejecuciones reales de n8n. **Campaña de 2–3 números** solo tras declarar PASS de core; sin blast.
