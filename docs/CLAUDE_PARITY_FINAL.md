# Claude parity final report

Generated: 2026-09-30T22:59:10.414Z

## Result

**Total project parity is not certified PASS.** All existing canonical page structures were ported directly to Vue. Dashboard, Contacts and Campaigns have no page template in the approved HTML. Metrics has unsupported data series; these are not filled with demo values.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Skills used | None available for frontend/Vue/accessibility/visual regression | Provided catalog inspected; unrelated video skills not loaded |
| Functional baseline | PASS | build + 28/28 tests; docs/VISUAL_PARITY_BASELINE.md |
| Claude source inspected | PASS | CAP Inbox.dc.html lines 1–638; SHA-256 f964b65437ebe0e51b029f91011d12d8d9ba152b866012bc9675a8065e9a60fc |
| Production backend frozen | PASS | 0 changed production .ts files compared byte-for-byte with code backup |
| Build | PASS | TypeScript, vue-tsc and Vite build |
| Functional regression | PASS | Same 28/28 test scenarios; integration label updated to source wording and existing capacity contract also checked |
| UI / interaction / overflow regression | PASS | 107/107 existing Playwright checks across 1366,1440,1600,1920,2560, light/dark |
| Live runtime | PASS | npm run check:runtime: 18 JSON endpoints, archive, metrics, authenticated websocket, no page errors |
| Realtime | PASS | Live runtime websocket + real backend/Vue integration |
| WhatsApp | Prior real phone PASS; transport currently PASS | User confirmed actual menu/preset delivery before this visual phase. Current worker, MessageSync, own webhook, tunnel online; AI healthy; 0 failed/pending jobs. No new telephone delivery claim based on visual mocks. |
| New Claude-versus-CAP evidence | 60 pairs | Separate source renderer and running Vue frontend, same size/DPR/zoom/font/time |

## Capture contract

Primary normalized viewport: 1440×900, plus 1366×768 and 1920×1080, DPR1, zoom100%, UTC, fixed test date 2026-09-30T12:00:00Z. The source is fluid (100vh, innerWidth, fallback1440) and contains no fixed exported viewport height; no original height was invented.

Reference: `visual/reference/claude/`, rendered from the downloaded source with measurement attributes + test-only instance exposure, no CAP markup/styles injected. Actual: `visual/actual/cap/`, rendered from CAP Vue, with isolated deterministic API fixtures solely in visual tooling. Production has no imported demo state. Diffs/boxes/styles: `visual/diff/`. Earlier CAP-versus-CAP 0% results are not used.

Measured comparisons: 801; geometry deviations/missing boxes over ±2px: 0. Every JSON contains both bounding boxes and computed font, size, weight, line-height, padding, gap, color, radius, border and scroll styles. Dynamic health/control state colors are evaluated as application state, not forced to source demo state. Raw pixel percentages below include data/labels/control availability and are not similarity scores.

## Screen-by-screen

| Screen | Status | Geometry by viewport | Raw changed pixels | Real remaining difference |
|---|---|---|---|---|
| archive | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.78%<br>1440: 0.64%<br>1920: 0.4% | Closed list, disposition, locked composer, contact pane and history. Reopen dialog is readonly; no reopen request is fabricated. |
| bot | PASS appearance; partial controls | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 1%<br>1440: 0.81%<br>1920: 0.86% | Canonical editor/preview structure. Existing welcome/reply/quick-reply values and PUT /api/menu preserved. Welcome header/footer split only when existing text can be losslessly parsed. Unsupported labels/reordering/keywords/preview-send stay readonly or disabled. |
| close | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.41%<br>1440: 0.35%<br>1920: 0.22% | Canonical result pills, conditional amount/reference/follow-up fields, note, real farewell preview and footer. Existing durable close / audited failure handling preserved. |
| deactivate | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.52%<br>1440: 0.42%<br>1920: 0.27% | Canonical deactivation confirmation, actual active-chat count and destination pills. Existing active=false/deactivateHandling PATCH contract retained; styled confirmation replaces native browser confirm. |
| diagnostics | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 1.55%<br>1440: 1.33%<br>1920: 0.86% | Canonical eight service cards and incident section. Real health/incident data; technical detail retained in secondary popover, latency tools in advanced section. |
| follow-up | PASS layout; partial metadata | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.7%<br>1440: 0.59%<br>1920: 0.37% | Existing closed list filtered by FOLLOW_UP. Follow-up date is stored by CAP but absent from this list/history payload, so no demo reminder date shown. |
| inbox-ai | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.74%<br>1440: 0.6%<br>1920: 0.37% | Source AI/bot view and locked composer. Intervention is represented but disabled: the claim endpoint supports pending human chats, not AI. |
| inbox-human | PASS layout; partial metadata | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.47%<br>1440: 0.42%<br>1920: 0.26% | API does not return per-message human author, preview sender prefix or per-chat handoff age. Shows truthful generic Asesor / waiting status. No demo identity or SLA value substituted. |
| inbox-mine | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.09%<br>1440: 0.07%<br>1920: 0.05% | Authorized active list mapped to current username; source empty state reproduced. Pagination and additional CAP filters are in the caption dropdown. |
| inbox-waiting | PASS layout; partial metadata | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.48%<br>1440: 0.39%<br>1920: 0.24% | Per-chat wait duration / SLA alarm require handoff timestamp absent from the list response. Manual assignment remains disabled because the existing transfer endpoint requires HUMAN_ACTIVE. |
| metrics | FAIL full parity; PASS layout | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 7.95%<br>1440: 7.21%<br>1920: 6.74% | Source five KPIs, hourly/daily chart frame, resolution frame, closure results, timings and live-team grid ported. Current dashboard API has no temporal series, resolution percentage, sales revenue or full disposition breakdown. Empty/unmeasured fields remain —, never synthetic bars/percentages. |
| new-user | Partial parity | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.49%<br>1440: 0.41%<br>1920: 0.29% | Canonical new-user dialog and existing create contract. Password is a secondary required field because CAP does not provide source demo temporary-password generation. This real credential requirement differs from source hint. |
| profile | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.69%<br>1440: 0.61%<br>1920: 0.38% | Source popover geometry. Production role is fixed by the server; role-demo switching is disabled. Current-role button opens CAP-only secondary actions. |
| reopen | PASS appearance if measured; operation unavailable | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 1.12%<br>1440: 0.92%<br>1920: 0.58% | Canonical readonly dialog with explicit unavailable state. Reabrir y enviar is disabled. No reopen API added, no state mutation or outbound message simulated. |
| settings-ai | PASS appearance; readonly server settings | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.4%<br>1440: 0.32%<br>1920: 0.2% | Source structure and labels; missing configuration API is not represented as a working toggle. |
| settings-dispositions | PASS appearance; readonly server settings | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 1.61%<br>1440: 1.54%<br>1920: 1.11% | Canonical rows. Existing dispositions preserved, server-owned modifications disabled. |
| settings-routing | PASS appearance; readonly server settings | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.28%<br>1440: 0.23%<br>1920: 0.14% | Source tab layout / controls. Only actual observed SLA displayed; unpublished server configuration stays unmeasured and disabled. |
| settings-whatsapp | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.35%<br>1440: 0.29%<br>1920: 0.18% | Canonical cards and controls; real health mapped to source labels. No named-tunnel assertion, credential exposure or subscription mutation. |
| team | PASS | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.55%<br>1440: 0.45%<br>1920: 0.28% | Literal table, roles summary and permission grid. Capacity +/- wired to existing PATCH /api/users/:id, tested against isolated real backend. Existing user search/detail/deactivation preserved in secondary controls. Role matrix is readonly because no roles mutation API exists. |
| transfer | PASS appearance; existing routes functional | 1366×768: PASS<br>1440×900: PASS<br>1920×1080: PASS | 1366: 0.75%<br>1440: 0.6%<br>1920: 0.37% | Canonical destination cards, agent rows, reason, information and footer. Existing agent/queue transfer and return-to-bot used. AI transfer disabled: endpoint absent. |

## Screens without a canonical template

| Screen | Status | Why |
|---|---|---|
| Dashboard | FAIL / blocked source | No isDashboard/page template or dashboard navigation in canonical HTML. Existing real CAP dashboard preserved, accessible from profile secondary menu. |
| Contacts | FAIL / blocked source | Source contains contact info pane, not a contacts directory page. Existing real directory/history preserved. |
| Campaigns | FAIL / blocked source | Only permission names occur in source, no campaign page. Existing unavailable state preserved; no invented campaign UI or API. |
| Delete / new conversation modals | Not represented | Neither source modal nor functional API exists. No fabricated action. |
| Dark mode canonical parity | Not applicable | Source has only light composition. Existing derived dark preference retained and tested. |
| Audio/video/document-specific source controls | Not represented | Source generic media frame preserved; real CAP playback/download controls remain. No fake media service. |

## Snapshot pairs

### archive

- 1366×768: [Claude](../visual/reference/claude/archive-1366x768.png) · [CAP](../visual/actual/cap/archive-1366x768.png) · [pixel diff](../visual/diff/archive-1366x768.png) · [boxes/styles](../visual/diff/archive-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/archive-1440x900.png) · [CAP](../visual/actual/cap/archive-1440x900.png) · [pixel diff](../visual/diff/archive-1440x900.png) · [boxes/styles](../visual/diff/archive-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/archive-1920x1080.png) · [CAP](../visual/actual/cap/archive-1920x1080.png) · [pixel diff](../visual/diff/archive-1920x1080.png) · [boxes/styles](../visual/diff/archive-1920x1080.json)

### bot

- 1366×768: [Claude](../visual/reference/claude/bot-1366x768.png) · [CAP](../visual/actual/cap/bot-1366x768.png) · [pixel diff](../visual/diff/bot-1366x768.png) · [boxes/styles](../visual/diff/bot-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/bot-1440x900.png) · [CAP](../visual/actual/cap/bot-1440x900.png) · [pixel diff](../visual/diff/bot-1440x900.png) · [boxes/styles](../visual/diff/bot-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/bot-1920x1080.png) · [CAP](../visual/actual/cap/bot-1920x1080.png) · [pixel diff](../visual/diff/bot-1920x1080.png) · [boxes/styles](../visual/diff/bot-1920x1080.json)

### close

- 1366×768: [Claude](../visual/reference/claude/close-1366x768.png) · [CAP](../visual/actual/cap/close-1366x768.png) · [pixel diff](../visual/diff/close-1366x768.png) · [boxes/styles](../visual/diff/close-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/close-1440x900.png) · [CAP](../visual/actual/cap/close-1440x900.png) · [pixel diff](../visual/diff/close-1440x900.png) · [boxes/styles](../visual/diff/close-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/close-1920x1080.png) · [CAP](../visual/actual/cap/close-1920x1080.png) · [pixel diff](../visual/diff/close-1920x1080.png) · [boxes/styles](../visual/diff/close-1920x1080.json)

### deactivate

- 1366×768: [Claude](../visual/reference/claude/deactivate-1366x768.png) · [CAP](../visual/actual/cap/deactivate-1366x768.png) · [pixel diff](../visual/diff/deactivate-1366x768.png) · [boxes/styles](../visual/diff/deactivate-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/deactivate-1440x900.png) · [CAP](../visual/actual/cap/deactivate-1440x900.png) · [pixel diff](../visual/diff/deactivate-1440x900.png) · [boxes/styles](../visual/diff/deactivate-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/deactivate-1920x1080.png) · [CAP](../visual/actual/cap/deactivate-1920x1080.png) · [pixel diff](../visual/diff/deactivate-1920x1080.png) · [boxes/styles](../visual/diff/deactivate-1920x1080.json)

### diagnostics

- 1366×768: [Claude](../visual/reference/claude/diagnostics-1366x768.png) · [CAP](../visual/actual/cap/diagnostics-1366x768.png) · [pixel diff](../visual/diff/diagnostics-1366x768.png) · [boxes/styles](../visual/diff/diagnostics-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/diagnostics-1440x900.png) · [CAP](../visual/actual/cap/diagnostics-1440x900.png) · [pixel diff](../visual/diff/diagnostics-1440x900.png) · [boxes/styles](../visual/diff/diagnostics-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/diagnostics-1920x1080.png) · [CAP](../visual/actual/cap/diagnostics-1920x1080.png) · [pixel diff](../visual/diff/diagnostics-1920x1080.png) · [boxes/styles](../visual/diff/diagnostics-1920x1080.json)

### follow-up

- 1366×768: [Claude](../visual/reference/claude/follow-up-1366x768.png) · [CAP](../visual/actual/cap/follow-up-1366x768.png) · [pixel diff](../visual/diff/follow-up-1366x768.png) · [boxes/styles](../visual/diff/follow-up-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/follow-up-1440x900.png) · [CAP](../visual/actual/cap/follow-up-1440x900.png) · [pixel diff](../visual/diff/follow-up-1440x900.png) · [boxes/styles](../visual/diff/follow-up-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/follow-up-1920x1080.png) · [CAP](../visual/actual/cap/follow-up-1920x1080.png) · [pixel diff](../visual/diff/follow-up-1920x1080.png) · [boxes/styles](../visual/diff/follow-up-1920x1080.json)

### inbox-ai

- 1366×768: [Claude](../visual/reference/claude/inbox-ai-1366x768.png) · [CAP](../visual/actual/cap/inbox-ai-1366x768.png) · [pixel diff](../visual/diff/inbox-ai-1366x768.png) · [boxes/styles](../visual/diff/inbox-ai-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/inbox-ai-1440x900.png) · [CAP](../visual/actual/cap/inbox-ai-1440x900.png) · [pixel diff](../visual/diff/inbox-ai-1440x900.png) · [boxes/styles](../visual/diff/inbox-ai-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/inbox-ai-1920x1080.png) · [CAP](../visual/actual/cap/inbox-ai-1920x1080.png) · [pixel diff](../visual/diff/inbox-ai-1920x1080.png) · [boxes/styles](../visual/diff/inbox-ai-1920x1080.json)

### inbox-human

- 1366×768: [Claude](../visual/reference/claude/inbox-human-1366x768.png) · [CAP](../visual/actual/cap/inbox-human-1366x768.png) · [pixel diff](../visual/diff/inbox-human-1366x768.png) · [boxes/styles](../visual/diff/inbox-human-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/inbox-human-1440x900.png) · [CAP](../visual/actual/cap/inbox-human-1440x900.png) · [pixel diff](../visual/diff/inbox-human-1440x900.png) · [boxes/styles](../visual/diff/inbox-human-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/inbox-human-1920x1080.png) · [CAP](../visual/actual/cap/inbox-human-1920x1080.png) · [pixel diff](../visual/diff/inbox-human-1920x1080.png) · [boxes/styles](../visual/diff/inbox-human-1920x1080.json)

### inbox-mine

- 1366×768: [Claude](../visual/reference/claude/inbox-mine-1366x768.png) · [CAP](../visual/actual/cap/inbox-mine-1366x768.png) · [pixel diff](../visual/diff/inbox-mine-1366x768.png) · [boxes/styles](../visual/diff/inbox-mine-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/inbox-mine-1440x900.png) · [CAP](../visual/actual/cap/inbox-mine-1440x900.png) · [pixel diff](../visual/diff/inbox-mine-1440x900.png) · [boxes/styles](../visual/diff/inbox-mine-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/inbox-mine-1920x1080.png) · [CAP](../visual/actual/cap/inbox-mine-1920x1080.png) · [pixel diff](../visual/diff/inbox-mine-1920x1080.png) · [boxes/styles](../visual/diff/inbox-mine-1920x1080.json)

### inbox-waiting

- 1366×768: [Claude](../visual/reference/claude/inbox-waiting-1366x768.png) · [CAP](../visual/actual/cap/inbox-waiting-1366x768.png) · [pixel diff](../visual/diff/inbox-waiting-1366x768.png) · [boxes/styles](../visual/diff/inbox-waiting-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/inbox-waiting-1440x900.png) · [CAP](../visual/actual/cap/inbox-waiting-1440x900.png) · [pixel diff](../visual/diff/inbox-waiting-1440x900.png) · [boxes/styles](../visual/diff/inbox-waiting-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/inbox-waiting-1920x1080.png) · [CAP](../visual/actual/cap/inbox-waiting-1920x1080.png) · [pixel diff](../visual/diff/inbox-waiting-1920x1080.png) · [boxes/styles](../visual/diff/inbox-waiting-1920x1080.json)

### metrics

- 1366×768: [Claude](../visual/reference/claude/metrics-1366x768.png) · [CAP](../visual/actual/cap/metrics-1366x768.png) · [pixel diff](../visual/diff/metrics-1366x768.png) · [boxes/styles](../visual/diff/metrics-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/metrics-1440x900.png) · [CAP](../visual/actual/cap/metrics-1440x900.png) · [pixel diff](../visual/diff/metrics-1440x900.png) · [boxes/styles](../visual/diff/metrics-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/metrics-1920x1080.png) · [CAP](../visual/actual/cap/metrics-1920x1080.png) · [pixel diff](../visual/diff/metrics-1920x1080.png) · [boxes/styles](../visual/diff/metrics-1920x1080.json)

### new-user

- 1366×768: [Claude](../visual/reference/claude/new-user-1366x768.png) · [CAP](../visual/actual/cap/new-user-1366x768.png) · [pixel diff](../visual/diff/new-user-1366x768.png) · [boxes/styles](../visual/diff/new-user-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/new-user-1440x900.png) · [CAP](../visual/actual/cap/new-user-1440x900.png) · [pixel diff](../visual/diff/new-user-1440x900.png) · [boxes/styles](../visual/diff/new-user-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/new-user-1920x1080.png) · [CAP](../visual/actual/cap/new-user-1920x1080.png) · [pixel diff](../visual/diff/new-user-1920x1080.png) · [boxes/styles](../visual/diff/new-user-1920x1080.json)

### profile

- 1366×768: [Claude](../visual/reference/claude/profile-1366x768.png) · [CAP](../visual/actual/cap/profile-1366x768.png) · [pixel diff](../visual/diff/profile-1366x768.png) · [boxes/styles](../visual/diff/profile-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/profile-1440x900.png) · [CAP](../visual/actual/cap/profile-1440x900.png) · [pixel diff](../visual/diff/profile-1440x900.png) · [boxes/styles](../visual/diff/profile-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/profile-1920x1080.png) · [CAP](../visual/actual/cap/profile-1920x1080.png) · [pixel diff](../visual/diff/profile-1920x1080.png) · [boxes/styles](../visual/diff/profile-1920x1080.json)

### reopen

- 1366×768: [Claude](../visual/reference/claude/reopen-1366x768.png) · [CAP](../visual/actual/cap/reopen-1366x768.png) · [pixel diff](../visual/diff/reopen-1366x768.png) · [boxes/styles](../visual/diff/reopen-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/reopen-1440x900.png) · [CAP](../visual/actual/cap/reopen-1440x900.png) · [pixel diff](../visual/diff/reopen-1440x900.png) · [boxes/styles](../visual/diff/reopen-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/reopen-1920x1080.png) · [CAP](../visual/actual/cap/reopen-1920x1080.png) · [pixel diff](../visual/diff/reopen-1920x1080.png) · [boxes/styles](../visual/diff/reopen-1920x1080.json)

### settings-ai

- 1366×768: [Claude](../visual/reference/claude/settings-ai-1366x768.png) · [CAP](../visual/actual/cap/settings-ai-1366x768.png) · [pixel diff](../visual/diff/settings-ai-1366x768.png) · [boxes/styles](../visual/diff/settings-ai-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/settings-ai-1440x900.png) · [CAP](../visual/actual/cap/settings-ai-1440x900.png) · [pixel diff](../visual/diff/settings-ai-1440x900.png) · [boxes/styles](../visual/diff/settings-ai-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/settings-ai-1920x1080.png) · [CAP](../visual/actual/cap/settings-ai-1920x1080.png) · [pixel diff](../visual/diff/settings-ai-1920x1080.png) · [boxes/styles](../visual/diff/settings-ai-1920x1080.json)

### settings-dispositions

- 1366×768: [Claude](../visual/reference/claude/settings-dispositions-1366x768.png) · [CAP](../visual/actual/cap/settings-dispositions-1366x768.png) · [pixel diff](../visual/diff/settings-dispositions-1366x768.png) · [boxes/styles](../visual/diff/settings-dispositions-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/settings-dispositions-1440x900.png) · [CAP](../visual/actual/cap/settings-dispositions-1440x900.png) · [pixel diff](../visual/diff/settings-dispositions-1440x900.png) · [boxes/styles](../visual/diff/settings-dispositions-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/settings-dispositions-1920x1080.png) · [CAP](../visual/actual/cap/settings-dispositions-1920x1080.png) · [pixel diff](../visual/diff/settings-dispositions-1920x1080.png) · [boxes/styles](../visual/diff/settings-dispositions-1920x1080.json)

### settings-routing

- 1366×768: [Claude](../visual/reference/claude/settings-routing-1366x768.png) · [CAP](../visual/actual/cap/settings-routing-1366x768.png) · [pixel diff](../visual/diff/settings-routing-1366x768.png) · [boxes/styles](../visual/diff/settings-routing-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/settings-routing-1440x900.png) · [CAP](../visual/actual/cap/settings-routing-1440x900.png) · [pixel diff](../visual/diff/settings-routing-1440x900.png) · [boxes/styles](../visual/diff/settings-routing-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/settings-routing-1920x1080.png) · [CAP](../visual/actual/cap/settings-routing-1920x1080.png) · [pixel diff](../visual/diff/settings-routing-1920x1080.png) · [boxes/styles](../visual/diff/settings-routing-1920x1080.json)

### settings-whatsapp

- 1366×768: [Claude](../visual/reference/claude/settings-whatsapp-1366x768.png) · [CAP](../visual/actual/cap/settings-whatsapp-1366x768.png) · [pixel diff](../visual/diff/settings-whatsapp-1366x768.png) · [boxes/styles](../visual/diff/settings-whatsapp-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/settings-whatsapp-1440x900.png) · [CAP](../visual/actual/cap/settings-whatsapp-1440x900.png) · [pixel diff](../visual/diff/settings-whatsapp-1440x900.png) · [boxes/styles](../visual/diff/settings-whatsapp-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/settings-whatsapp-1920x1080.png) · [CAP](../visual/actual/cap/settings-whatsapp-1920x1080.png) · [pixel diff](../visual/diff/settings-whatsapp-1920x1080.png) · [boxes/styles](../visual/diff/settings-whatsapp-1920x1080.json)

### team

- 1366×768: [Claude](../visual/reference/claude/team-1366x768.png) · [CAP](../visual/actual/cap/team-1366x768.png) · [pixel diff](../visual/diff/team-1366x768.png) · [boxes/styles](../visual/diff/team-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/team-1440x900.png) · [CAP](../visual/actual/cap/team-1440x900.png) · [pixel diff](../visual/diff/team-1440x900.png) · [boxes/styles](../visual/diff/team-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/team-1920x1080.png) · [CAP](../visual/actual/cap/team-1920x1080.png) · [pixel diff](../visual/diff/team-1920x1080.png) · [boxes/styles](../visual/diff/team-1920x1080.json)

### transfer

- 1366×768: [Claude](../visual/reference/claude/transfer-1366x768.png) · [CAP](../visual/actual/cap/transfer-1366x768.png) · [pixel diff](../visual/diff/transfer-1366x768.png) · [boxes/styles](../visual/diff/transfer-1366x768.json)
- 1440×900: [Claude](../visual/reference/claude/transfer-1440x900.png) · [CAP](../visual/actual/cap/transfer-1440x900.png) · [pixel diff](../visual/diff/transfer-1440x900.png) · [boxes/styles](../visual/diff/transfer-1440x900.json)
- 1920×1080: [Claude](../visual/reference/claude/transfer-1920x1080.png) · [CAP](../visual/actual/cap/transfer-1920x1080.png) · [pixel diff](../visual/diff/transfer-1920x1080.png) · [boxes/styles](../visual/diff/transfer-1920x1080.json)

## Remaining geometry deviations

None in the captured key elements.

## Functional boundaries

Backend production source, schema, credentials, tunnel/supervisor, subscriptions, routing, worker, durable jobs and Socket protocol remain unchanged in this phase. The backend integration test file was adapted only for source-approved label wording and verification of the already-existing users-capacity endpoint. CSS/DOM/controller presentation is the changed product surface.

Transfer/close/send/notes/tags/read/media use the existing request functions and permission checks; no fake successful operations or new backend APIs. Extra CAP functions are in source-shaped dropdowns/details/modals.
