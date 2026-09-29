# CAP Inbox — auditoría de paridad UI

Fecha: 29-09-2026. Autoridad: `design-reference/screens/canonical/4k/`, luego PDF, tokens y coverage. La ejecución visual usa datos de **fixtures aislados**, no conversaciones reales ni la instancia pública.

## Alcance y evidencias

- Referencias extraídas en `design-reference/`; solo tres SVG de logo están en `app/frontend/public/brand/`, no el pack 4K.
- Tokens semánticos en `app/frontend/src/styles/{tokens,themes}.css`; app shell, navegación y componentes de Inbox comparten geometría. Tema local persistente; sin inversión CSS.
- Capturas en `tests/visual/screenshots/`. Comando `npm run test:visual`: **96/96 PASS** — 80 combinaciones de ocho vistas × claro/oscuro × 1366×768, 1440×900, 1600×900, 1920×1080 y 2560×1440, más 16 estados de archivo, transferencia, cierre y perfil a 1366/1920. Las pruebas confirman render, tamaños de viewport y ausencia de scroll global; **no certifican igualdad visual**.
- `npm run test:visual:diff` produce heatmaps en `tests/visual/diffs/`. A 1920×1080, referencia canónica reescalada: Inbox claro MAE 6,97 %, píxeles con diferencia >30/255 **10,55 %**; Inbox oscuro MAE 8,16 %, diferencia **13,36 %**. Campañas 8,99 %, métricas 11,48 %, equipo 8,95 %, diagnóstico 8,33 %. Los datos y contenido de fixtures difieren de los mockups; superficies claras compartidas pueden reducir artificialmente estas métricas. **Ninguna comparación numérica es PASS pixel-perfect.** El PNG `04_contacts_crm.png` del ZIP original no puede decodificarse completo por libpng; la captura implementada existe, pero no hay diff canónico fiable. El comando devuelve fallo para que esta comparación incompleta no parezca PASS.
- `npm run build` y `npm test` pasaron (**26/26**, incluida cobertura RBAC del directorio). La instancia pública previa no se reinició: validar aquí NO implica despliegue ni validación con WhatsApp real.

## Matriz de paridad

Leyenda: `R` = render comprobado en fixture; `P` = implementación parcial; `F` = no disponible; `—` = sin prueba visual específica. La columna Visual requiere concordancia real de contenido, geometría y estados; un render correcto no la convierte en PASS.

| Vista | Light | Dark | 1366 | 1920 | Funcional | Visual |
|---|---|---|---|---|---|---|
| Login | R | R | R | R | P | P |
| Dashboard Superadmin | R | R | R* | R* | P | P |
| Inbox humano | R | R | R | R | P | P |
| Inbox vacío / espera | P | P | — | — | P | P |
| Inbox IA | — | — | — | — | F | F |
| Inbox media recibida | P | P | — | — | P | P |
| Archivo y cierre | R | R | R | R | P | P |
| Transferir / cerrar (modal) | R | R | R | R | P | P |
| Nueva conversación / reabrir | F | F | — | — | F | F |
| Directorio contactos | R | R | R | R | P | P |
| Perfil contacto | R | R | R | R | P | P |
| Campañas y detalle | R | R | R | R | F | F |
| Wizard campañas | F | F | — | — | F | F |
| Métricas globales / por agente | R | R | R | R | P | P |
| Equipo / usuario | R | R | R | R | P | P |
| Roles / permisos | P | P | — | — | P | F |
| Ajustes / Bot / WhatsApp / IA | R | R | R | R | P | P |
| Diagnóstico / incidente | R | R | R | R | P | P |
| Llamadas / grabación de voz | F | F | — | — | F | F |
| Notificaciones / Ctrl+K | F | F | — | — | F | F |

`*` Dashboard usa el mismo componente de métricas; no reproduce la pantalla específica de inicio. Las capturas de campañas muestran un estado vacío operativo porque no hay API real; **no** son implementación del mockup de campañas.

## Estado de cada pantalla del PDF (40)

| Nº | Pantalla / referencia | Implementado / viewport | Estado visual y diferencias |
|---:|---|---|---|
| 01 | Login claro, coverage `login_light.png` | `login-light-{1366,1920}.png` | P: split y escala próximos; logo aprobado difiere del boceto del PDF; sin recuperación de contraseña. |
| 02 | Login oscuro, coverage `login_dark.png` | `login-dark-{1366,1920}.png` | P: tema explícito; no hay recuperación funcional. |
| 03 | Dashboard Superadmin claro, coverage `dashboard_light.png` | `metrics-light-{1366,1920}.png` | P: KPI reales; no serie diaria histórica en API. |
| 04 | Dashboard oscuro, coverage `dashboard_dark.png` | `metrics-dark-{1366,1920}.png` | P: misma limitación. |
| 05 | Inbox vacío, coverage `inbox_empty.png` | no captura específica | P: empty state existe; CTA nueva conversación deshabilitado por falta de API. |
| 06 | Inbox esperando, coverage `inbox_waiting.png` | no captura específica | P: badge y botón claim reales; falta reproducción comparativa del estado. |
| 07 | Inbox humano, canonical `01_inbox_light.png` | `inbox-light-{1366,1920}.png` | P: estructura, scrolls, composer, lista y acciones; faltan cards/rich media/atributos del mockup. |
| 08 | Inbox IA, coverage `inbox_ai.png` | no captura | F: la lista de Inbox del backend es solo humana; no abrir ruta IA inventada. |
| 09 | Inbox media, canonical `03_inbox_media.png` | no captura específica | P: renderer real de imagen/audio/video/documento y carga; todavía no igualado al canónico. |
| 10 | Voz, coverage `voice_record.png` | no captura | F: backend outbound rechaza audio, no se expone una grabación que no podría enviarse. |
| 11 | Envío media, coverage `media_send.png` | Inbox composer | P: imagen/documento aceptado y adjunto visible; sin selector/preview modal. |
| 12 | Llamadas, coverage `call_view.png` | no captura | F: canal/proveedor no tiene integración de llamadas confirmada. |
| 13 | Transferencia, coverage `transfer.png` | `transfer-{light,dark}-{1366,1920}.png` | P: modal conectado a API; detalle de carga del destinatario incompleto. |
| 14 | Cierre, coverage `close.png` | `close-{light,dark}-{1366,1920}.png` | P: tipificación y opciones reales; espaciamiento/textos del mockup aún difieren. |
| 15 | Archivo, coverage `archive.png` | `archive-{light,dark}-{1366,1920}.png` | P: consultas reales y banner; fecha exacta de cierre no se pinta con dato inventado. |
| 16 | Reabrir/eliminar, coverage `reopen.png` | no captura | F: backend no ofrece acciones de reabrir/eliminar. |
| 17 | Directorio, canonical `04_contacts_crm.png` | `contacts-{light,dark}-{1366,1920}.png` | P: endpoint nuevo read-only con RBAC, búsqueda y paginación; canonical PNG fuente falla decodificación. |
| 18 | Perfil, coverage `contact_profile.png` | `profile-{light,dark}-{1366,1920}.png` | P: datos e historial reales, sin editor de perfil/contacto. |
| 19 | Nueva conversación, coverage `new_conversation.png` | no captura | F: no hay API de creación manual; CTA deshabilitado. |
| 20 | Campañas, canonical `05_campaigns_dashboard.png` | `campaigns-{light,dark}-{1366,1920}.png` | F: estado vacío explícito, no listado/KPI falso. |
| 21–24 | Wizard, coverage `campaign_{recipients,message,review,ready}.png` | no captura | F: no existe modelo/API de campañas. |
| 25 | Detalle campaña, coverage `campaign_detail.png` | no captura | F: mismo bloqueo. |
| 26 | Métricas globales, canonical `07_metrics_performance.png` | `metrics-{light,dark}-{1366,1920}.png` | P: KPI y tiempos reales; gráfico reemplazado por barras de resultados reales, sin serie diaria. |
| 27 | Métricas agente, coverage `metrics_agent.png` | filtro agente en Métricas | P: filtra API; sin ruta/detalle exclusivo. |
| 28 | Equipo, canonical `08_team_roles.png` | `team-{light,dark}-{1366,1920}.png` | P: usuarios reales, capacidad y estado; detalle/matriz no idénticos. |
| 29 | Detalle usuario, coverage `user_detail.png` | modal de Equipo | P: lectura y desactivación disponibles; sin edición/reset seguro. |
| 30 | Roles, coverage `roles.png` | resumen en Equipo | F visual: no hay matriz completa de permisos efectiva por rol. |
| 31 | Ajustes general, coverage `settings_general.png` | `settings-*` usa Bot como fixture | P: tema persistente y lectura; empresa/idioma no editables sin API. |
| 32 | WhatsApp, coverage `settings_whatsapp.png` | sección `/settings/whatsapp` | P: health real; sin credenciales ni número hardcodeado. |
| 33 | Bot, coverage `settings_bot.png` | `settings-{light,dark}-{1366,1920}.png` | P: edición/guardar menú real, editor todavía más denso que mockup. |
| 34 | IA, coverage `settings_ai.png` | sección `/settings/ai` | P: health/P95 real, sin formulario de valores que el backend no guarda. |
| 35 | Routing/SLA, coverage `settings_routing.png` | sección `/settings/routing` | P: capacidad observada; sin configuración persistible. |
| 36 | Diagnóstico, canonical `09_system_diagnostics.png` | `diagnostics-{light,dark}-{1366,1920}.png` | P: cards y latencia real; información varía de fixture. |
| 37 | Incidente, coverage `incident_detail.png` | detalle expandible en Diagnóstico | P: explicación humana y detalle técnico autorizados; sin modal canónico. |
| 38 | Notificaciones, coverage `notifications.png` | badge enlaza diagnóstico | F: no hay feed de notificaciones ni búsqueda global. |
| 39 | Inbox oscuro, canonical `02_inbox_dark.png` | `inbox-dark-{1366,1920}.png` | P: superficies oscuras reales, diferencias de densidad/contenido. |
| 40 | Ajustes oscuro, coverage `settings_dark.png` | `settings-dark-{1366,1920}.png` | P: paridad de tema, distinta composición. |

## Bloqueos funcionales y siguientes pasos

1. La presente fase no creó campañas ni mensajería masiva; requiere diseño de backend, autorización, deduplicación y colas propias antes de habilitar botones. No se inventaron entregas `DELIVERED/READ`.
2. Una API de contactos **GET** fue indispensable para un directorio real. Comprueba acceso por agente antes y después de transferencia. No altera MessageSync, WhatsApp, routing, jobs ni DB schema.
3. Nueva conversación, reopen/delete, voice outbound, calls, notificaciones y edición de ajustes de empresa requieren endpoints y semántica real; permanecen visibles como ausencia documentada, no como falsos PASS.
4. Para PASS visual faltan capturas con dataset equivalente a cada referencia, controles/estados exactos, revisión accesible con teclado/foco, iteraciones de corrección por las 40 vistas y comparación de los mockups canónicos reparados. La suite actual usa interception de APIs y no ejercita entrega real ni todos los modales.
