# Claude Design → CAP Inbox

## Fuente visual

`C:\Users\PC\Downloads\WhatsApp chat management system\CAP Inbox.dc.html` es una composición interactiva `x-dc` con estado y datos de demostración en el propio HTML. No es React, Next ni la aplicación Vue de producción. El directorio `app/frontend` de la descarga contiene una copia de la UI anterior (Inter/teal), **no** el diseño nuevo. `_ds/organic-*` es otro kit genérico (Caprasimo/Figtree), no la identidad de esta composición. No se importan sus fixtures ni sus handlers mock.

Identidad real de `CAP Inbox.dc.html`: Poppins, rail carbón `#202022` de 104 px, superficies `#f9fafc`, primario lila `#7678ed`, tinta `#202022`, alerta coral `#ff7a55`, panel histórico `#dedff9`, iconos Lucide, paneles redondeados a 32 px, tarjetas a 24 px, controles de 42–44 px. Tiene solo tema claro; el oscuro se deriva con tokens. El propio documento usa estilos en línea y no tiene router ni endpoints. Las interacciones de perfil, filtros, panel de contacto, modales, métricas, menú, equipo, configuración y diagnóstico están simuladas por su runtime.

## Matriz de integración

| Claude Design | CAP real / fuente | Estado de API |
|---|---|---|
| Rail / perfil / estado | `/api/me`, permisos efectivos, `/api/agents/me/status`, Socket.IO, logout, tema local | Disponible |
| Bandeja, filtros, búsqueda | `/api/conversations` (cursor, scope RBAC, búsquedas por nombre/teléfono/ID), `conversation:changed`; filtro `ai` solo retorna a quienes pueden ver chats globales | Disponible; no refetch por cada mensaje |
| Conversación, burbujas y estados | `/api/conversations/:id/messages` por `sequence`, `message:created/updated`, `media:ready` | Disponible |
| Enviar texto/imagen/documento | `POST /api/conversations/:id/messages` + idempotencia y optimistic UI | Disponible; MIME restringido |
| Reproducción audio/video, imagen, descarga | `/api/media/:id`, thumbnail, playable, lightbox | Disponible para media entrante |
| Grabar/enviar audio y enviar video | `allowedMime` de servidor y proveedor outbound | **BLOCKED**: API outbound no acepta audio/video; no dibujar acción que envíe un formato no admitido |
| Tomar/transferir/devolver/cerrar | claim, transfer, return-to-bot, close con tipificación; agentes reales | Disponible con permisos |
| Reabrir/eliminar/crear conversación | No hay endpoint de reapertura, borrado ni creación manual | **BLOCKED**: no simular ni llamar endpoint inexistente |
| Detalles, notas, tags, historial | notas y tags por conversación, `/api/contacts/:id/history` | Disponible; escribir solo con permiso |
| Contactos | `/api/contacts`, detalle, historia, RBAC en servidor | Disponible |
| Campañas | Solo permisos de rol; sin endpoints ni scheduler de campañas | **BLOCKED**: no enviar blast ni poblar chats ficticios |
| Métricas | `/api/metrics/dashboard` con período y agentes reales | Disponible a roles autorizados |
| Equipo | `/api/users`, `/api/agents`, capacidad y estado | Disponible a `users.manage` |
| Bot, IA, WhatsApp y ajustes | `/api/menu` y `/api/health`; cambios de enrutamiento/IA no expuestos | Lectura real; cambios sin endpoint **BLOCKED** |
| Diagnóstico, salud y latencia | `/api/diagnostics`, `/api/diagnostics/latency`, `/api/health` | Disponible según permisos |
| Notificaciones | Incidentes activos para personal con `diagnostics.view` | Feed de notificaciones de usuario **BLOCKED** |

## Paridad visual / funcional

PASS visual exige medición del mismo viewport de ambas aplicaciones y revisión de componentes, estados e interacciones; compilación y screenshots por sí solos no constituyen PASS.

| Screen | Reference | Implemented | 1366 | 1920 | Light | Dark | Functional | Visual |
|---|---|---|---|---|---|---|---|---|
| Inbox vacío / espera / humano / IA / media | `CAP Inbox.dc.html`, Inbox | `/inbox` | capturado | capturado | capturado | derivado | parcial (outbound audio/video bloqueado) | parcial: composición y paneles, sin igualdad pixel |
| Archivo / cerrada | Inbox (filtros demo) | `/inbox/archive` | capturado | capturado | capturado | derivado | parcial; reapertura sin API | referencia sin estado idéntico |
| Contactos | Sin pantalla dedicada | `/contacts` | capturado | capturado | capturado | derivado | API real | sin referencia directa |
| Campañas | Sin pantalla dedicada | `/campaigns` | capturado | capturado | capturado | derivado | BLOCKED | sin referencia directa |
| Métricas | Metrics | `/metrics` | capturado | capturado | capturado | derivado | API real | parcial: faltan series horarias en API |
| Equipo | Team (sin captura reproducible) | `/team` | capturado | capturado | capturado | derivado | API real | no verificado contra referencia |
| Configuración / menú | Settings / Menu (sin captura reproducible) | `/settings/*` | capturado | capturado | capturado | derivado | parcial | no verificado contra referencia |
| Diagnóstico | Diagnostics (sin captura reproducible) | `/diagnostics` | capturado | capturado | capturado | derivado | API real | no verificado contra referencia |

No se usa la lógica demo (usuarios ficticios, rol simulado, toggles locales o campañas falsas). El backend de CAP conserva el control de autorización.

Capturas: `docs/design-comparison/reference/` (composición Claude: Inbox y Metrics) y `docs/design-comparison/implemented/` (CAP con fixtures aislados para cinco anchos, ambos temas; además Inbox vacío, IA, espera y media a 1366/1920). Los fixtures no se instalan en producción. La composición original contiene otros nombres, conversaciones y mensajes y no ofrece las mismas APIs: una comparación pixel a pixel no sería una medición válida de paridad. El diseño original no define tema oscuro. Diferencias pendientes: rail de navegación y tabs no coinciden uno a uno porque CAP conserva páginas extra; gráfica por hora sin datos del servidor; paneles de equipo, menú y diagnóstico sin referencia reproducible en esta sesión; Composer de audio/video de salida, creación manual, reapertura y campañas no tienen API segura.
