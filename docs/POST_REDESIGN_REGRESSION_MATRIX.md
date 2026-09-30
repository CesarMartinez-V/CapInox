# Regresiones tras rediseño: evidencia por capa

2026-09-30. «Antes» corresponde al código `50357b4`, no a una afirmación de validación WhatsApp remota. El rediseño conserva fetch same-origin, cookie CAP, Socket.IO y endpoints existentes. No hay servicios mock en el bundle productivo; los fixtures permanecen en tests.

| Feature | Before redesign | After redesign | Backend endpoint | Socket event | UI component | Status | Root cause |
|---|---|---|---|---|---|---|---|
| Login | Real | Real | POST /api/login | — | login-card | PASS local | Cookie autenticada verificada en navegador |
| Session | Real | Real | /api/me | auth handshake | App | PASS local | No pérdida de credentials; servicio detenido originaba fallos |
| Inbox list | Real | Real | /api/conversations | conversation:changed | conversation-list | PASS local | Backend/worker no estaban corriendo al inspeccionar |
| Waiting | Real | Real | filter=pending | conversation:changed | Inbox / claim | PASS pruebas | Scope del servidor preservado; puede haber cero pendientes reales |
| Human active | Real | Real | filter=active | conversation:changed | chat | PASS local | Sin mocks; consulta y realtime autenticados |
| Archive | Real | Real | filter=closed | conversation.closed | Archivo | PASS local | 5 cerradas inicialmente, 6 en última comprobación; DB íntegra |
| Closed conversations | Real | Real | /api/conversations/:id/messages | — | read-only chat | PASS local/pruebas | Filtro CLOSED sí devuelve historial; ausencia de servicio era P0 |
| Conversation history | Real | Real | /api/contacts/:id/history | conversation:changed | history-section | PASS contrato | Datos scopeados, orden causal de mensajes por sequence |
| Send text | Durable 202 | Durable 202 | POST messages | message:created/updated | Composer | PASS integración; remoto pendiente | Un solo registro persistido y burbuja optimista reconciliada |
| Receive text | Durable + relay | Durable + relay | webhook MessageSync | message:created/updated | chat | PASS pruebas locales; FAIL remoto | Suscripción Quick Tunnel con DNS ENOTFOUND |
| Image | Receive/send permitido | Igual | /api/media, POST messages | media:ready | media-image-button | PARTIAL | Inbound en tests; salida real necesita URL pública estable |
| Audio | Receive | Igual | /api/media | media:ready | audio | PARTIAL | API outbound no admite audio desde antes del rediseño |
| Video | Receive renderer | Igual | /api/media | media:ready | video | PARTIAL | Outbound no admitido; no validación remota de reproducción |
| Document | Receive/send permitido | Igual | /api/media, POST messages | media:ready | document link | PARTIAL | Adjuntos salientes requieren origen público estable |
| Notes | Real | Real | GET/POST notes | conversation:changed | note-panel | PASS integración | Se persiste nota con UI real; sin WhatsApp |
| Tags | Real | Real | /api/tags, conversation tags | conversation:changed | chat-tags | PASS tests/contrato | RBAC de modificación preservado |
| Transfer | Real | Real | POST transfer | scoped conversation:changed | transfer modal | PASS integración backend | Reasignación y revocación scopeadas verificadas |
| Claim | Real | Real | POST claim | conversation:changed | chat actions | PASS backend | Saludo externo necesita proveedor; no prueba real |
| Close | Queue + CLOSING | Igual | POST close | conversation.closed | disposition modal | PASS integración | UI real 202; no archivar antes de confirmación |
| Reopen | Sin API manual | Sin API manual | inexistente | — | no acción fake | BLOCKED previo | Nuevo inbound tras CLOSED crea sesión; distinto de botón manual |
| Delete | Sin API | Sin API | inexistente | — | no acción fake | BLOCKED previo | No borrar historial ni ampliar alcance |
| Return bot | Real | Real | POST return-to-bot | conversation:changed | panel-return | PASS tests | Router conservado; transporte externo pendiente |
| New conversation | Sin API | Sin API | inexistente | — | no acción fake | BLOCKED previo | No fue una función perdida al portar Claude |
| Metrics | API real | API real | /api/metrics/dashboard | — | metrics-page | PASS local | Proceso detenido + errores silenciados podían dejar loading infinito; fetch acotado y error final añadidos |
| Users | Real | Real | /api/users | revoked socket on deactivation | team | PASS contrato/tests | Hash nunca expuesto; endpoints autorizados |
| Roles | Fijos en backend | Igual | rolePermissions | handshake/scope | permisos efectivos | PASS RBAC | No security-by-CSS ni rol demo |
| Settings | Menú editable, otros valores lectura | Igual | /api/menu, /api/health | menu:changed | settings | PARTIAL | No endpoint genérico /api/settings; ahora 404 JSON |
| Diagnostics | Real | Real | /api/diagnostics, latency | — | diagnostics | PASS local | /api/incidents no existe; usar contrato actual |
| Campaigns | Sin API | Sin API | inexistente | — | estado explícito | BLOCKED previo | Sin blast ni datos inventados |
| Notifications | Incidentes autorizados | Igual | /api/diagnostics | — | perfil | PARTIAL previo | No feed de notificaciones independiente |
| Theme | Persistencia local | Igual | — | — | Claude tokens | PASS visual | Ningún CSS cambiado durante recuperación |
| Socket | Cookie + same-origin | Igual, conecta antes del health externo | /socket.io | connect/reconnect/message/conversation | inbox-foot | PASS local/pruebas | Ausencia del proceso; boot esperaba todas las llamadas externas antes de conectar |
| Health | Real + checks externos | Igual | /health/live, ready, /api/health | — | health alerts | PASS local; FAIL túnel | Vite no proxyaba /health; ahora JSON; túnel inexistente |

PASS local/contrato no significa PASS WhatsApp remoto. Audio/video saliente, reapertura manual, delete, creación y campañas carecían de API en la versión anterior; no se recrean mediante handlers mock.
