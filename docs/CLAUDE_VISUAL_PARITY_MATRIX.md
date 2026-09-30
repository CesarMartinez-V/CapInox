# Claude visual parity matrix

Authority: `C:/Users/PC/Downloads/WhatsApp chat management system/CAP Inbox.dc.html`, inspected DOM + inline styles + component logic, lines 1–638. The runtime uses React internally, but the authored visual template is HTML/x-dc; port target is Vue. `app/frontend/src` in the download is the older CAP implementation, not a second approved Claude composition.

## Viewport and evidence

No fixed exported viewport metadata is present. The shell uses `height:100vh`, width comes from `window.innerWidth`, and the logic's non-browser width fallback is **1440** (line 394). Primary reproducible comparison: **1440×900, DPR 1, zoom 100%**. Also compare **1366×768** and **1920×1080**. The thumbnail is a scaled preview, not proof of the original viewport height. Contact panel switches from inline to an initially closed fixed drawer at **1320 px** (lines 475–478). There is no compact-rail breakpoint: rail is always **104 px**.

Reference captures must originate from the downloaded source, and actual captures from the running CAP frontend. Reference rendering can freeze time and expose its demo component for deterministic state selection; it cannot inject CAP HTML/CSS into the reference. Production does not receive source demo data.

| Screen/state | Claude route/state | CAP route | Viewports | Status | Large layout | Detail | Functional | Final |
|---|---|---|---|---|---|---|---|---|
| App shell / profile | all / profileOpen | all | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Inbox active | inbox, active | /inbox | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Inbox waiting | inbox, pending | /inbox | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Inbox mine | inbox, mine | /inbox | all three | Pending | Pending | Pending | Frontend mapping of authorized active list | Pending |
| Inbox IA / bot | inbox, bot | /inbox | all three | Pending | Pending | Pending | Existing ai filter | Pending |
| Inbox follow-up | inbox, follow | /inbox/archive | all three | Pending | Pending | Pending | Existing closed list + disposition mapping | Pending |
| Inbox closed / archive | inbox, closed | /inbox/archive | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Chat human / composer | inbox, HUMAN_ACTIVE | /inbox | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Chat waiting / locked | inbox, HUMAN_PENDING | /inbox | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Chat AI / locked | inbox, AI | /inbox | all three | Pending | Pending | Pending | Existing AI view | Pending |
| Image | inbox, media placeholder | /inbox | all three | Pending | Pending | Pending | Preserve authenticated image/lightbox | Pending |
| Audio / video / document | No dedicated source media controls; generic media placeholder | /inbox | all three | Source incomplete | Source wrapper only | Native controls cannot be compared to absent source | Preserve current services | Pending |
| Transfer modal | modal=transfer | /inbox | all three | Pending | Pending | Pending | Existing agent/queue transfer + return-to-bot | Pending |
| Close modal | modal=close | /inbox | all three | Pending | Pending | Pending | Baseline PASS | Pending |
| Reopen modal | modal=reopen | /inbox/archive | all three | Pending | Pending | Pending | API absent; disabled action only | Pending |
| Delete / new conversation | Not present in canonical source | — | — | No reference | N/A | N/A | APIs absent | No fabricated PASS |
| Dashboard | Not present in canonical source | /dashboard | all three | No reference | N/A | N/A | Preserve real metrics | No fabricated PASS |
| Contacts / profile | Not present in canonical source | /contacts | all three | No reference | N/A | N/A | Preserve directory/history | No fabricated PASS |
| Campaigns | Permission names only; no page template | /campaigns | all three | No reference | N/A | N/A | Existing unavailable state | No fabricated PASS |
| Metrics | metrics | /metrics | all three | Pending | Pending | Pending | Dashboard API lacks hourly/daily series and resolution/sales revenue breakdown | Pending |
| Team / permissions | team | /team | all three | Pending | Pending | Pending | Existing users API; no roles mutation | Pending |
| New user / deactivate | newUser / deact | /team, secondary users | all three | Pending | Pending | Pending | Keep existing create/deactivate contracts | Pending |
| Settings routing / AI / dispositions / WA | settings, routing/ai/disp/wa | /settings/* | all three | Pending | Pending | Pending | Server-owned settings absent from API stay disabled/unmeasured | Pending |
| Bot menu | menu | /settings/bot | all three | Pending | Pending | Pending | Preserve existing menu schema; source labels/footer not separate API fields | Pending |
| Diagnostics | diag | /diagnostics | all three | Pending | Pending | Pending | Existing health/incidents/latency | Pending |
| Dark mode | No canonical dark composition | all | 1366 / 1920 | No reference | N/A | Derived existing theme | Preserve preference | No canonical PASS |

PASS requires measured key boxes within ±2 px and matching source typography/colors, plus perceptual review. Missing source screens, unavailable data, extra main-view content, or different column/card structure prevent PASS. Raw pixel difference includes text/state changes and is reported, never treated as structural similarity percentage.

## Final measured results

The planning rows above are superseded by this measured status table. Full notes and linked images: [CLAUDE_PARITY_FINAL.md](CLAUDE_PARITY_FINAL.md).

| Source state / CAP view | Layout | Detail / availability | Functional | Final |
|---|---|---|---|---|
| archive | PASS ±2px | Closed list, disposition, locked composer, contact pane and history. Reopen dialog is readonly; no reopen request is fabricated. | Existing contracts preserved; unsupported mutations disabled | PASS |
| bot | PASS ±2px | Canonical editor/preview structure. Existing welcome/reply/quick-reply values and PUT /api/menu preserved. Welcome header/footer split only when existing text can be losslessly parsed. Unsupported labels/reordering/keywords/preview-send stay readonly or disabled. | Existing contracts preserved; unsupported mutations disabled | PASS appearance; partial controls |
| close | PASS ±2px | Canonical result pills, conditional amount/reference/follow-up fields, note, real farewell preview and footer. Existing durable close / audited failure handling preserved. | Existing contracts preserved; unsupported mutations disabled | PASS |
| deactivate | PASS ±2px | Canonical deactivation confirmation, actual active-chat count and destination pills. Existing active=false/deactivateHandling PATCH contract retained; styled confirmation replaces native browser confirm. | Existing contracts preserved; unsupported mutations disabled | PASS |
| diagnostics | PASS ±2px | Canonical eight service cards and incident section. Real health/incident data; technical detail retained in secondary popover, latency tools in advanced section. | Existing contracts preserved; unsupported mutations disabled | PASS |
| follow-up | PASS ±2px | Existing closed list filtered by FOLLOW_UP. Follow-up date is stored by CAP but absent from this list/history payload, so no demo reminder date shown. | Existing contracts preserved; unsupported mutations disabled | PASS layout; partial metadata |
| inbox-ai | PASS ±2px | Source AI/bot view and locked composer. Intervention is represented but disabled: the claim endpoint supports pending human chats, not AI. | Existing contracts preserved; unsupported mutations disabled | PASS |
| inbox-human | PASS ±2px | API does not return per-message human author, preview sender prefix or per-chat handoff age. Shows truthful generic Asesor / waiting status. No demo identity or SLA value substituted. | Existing contracts preserved; unsupported mutations disabled | PASS layout; partial metadata |
| inbox-mine | PASS ±2px | Authorized active list mapped to current username; source empty state reproduced. Pagination and additional CAP filters are in the caption dropdown. | Existing contracts preserved; unsupported mutations disabled | PASS |
| inbox-waiting | PASS ±2px | Per-chat wait duration / SLA alarm require handoff timestamp absent from the list response. Manual assignment remains disabled because the existing transfer endpoint requires HUMAN_ACTIVE. | Existing contracts preserved; unsupported mutations disabled | PASS layout; partial metadata |
| metrics | PASS ±2px | Source five KPIs, hourly/daily chart frame, resolution frame, closure results, timings and live-team grid ported. Current dashboard API has no temporal series, resolution percentage, sales revenue or full disposition breakdown. Empty/unmeasured fields remain —, never synthetic bars/percentages. | Existing contracts preserved; unsupported mutations disabled | FAIL full parity; PASS layout |
| new-user | PASS ±2px | Canonical new-user dialog and existing create contract. Password is a secondary required field because CAP does not provide source demo temporary-password generation. This real credential requirement differs from source hint. | Existing contracts preserved; unsupported mutations disabled | Partial parity |
| profile | PASS ±2px | Source popover geometry. Production role is fixed by the server; role-demo switching is disabled. Current-role button opens CAP-only secondary actions. | Existing contracts preserved; unsupported mutations disabled | PASS |
| reopen | PASS ±2px | Canonical readonly dialog with explicit unavailable state. Reabrir y enviar is disabled. No reopen API added, no state mutation or outbound message simulated. | Existing contracts preserved; unsupported mutations disabled | PASS appearance if measured; operation unavailable |
| settings-ai | PASS ±2px | Source structure and labels; missing configuration API is not represented as a working toggle. | Existing contracts preserved; unsupported mutations disabled | PASS appearance; readonly server settings |
| settings-dispositions | PASS ±2px | Canonical rows. Existing dispositions preserved, server-owned modifications disabled. | Existing contracts preserved; unsupported mutations disabled | PASS appearance; readonly server settings |
| settings-routing | PASS ±2px | Source tab layout / controls. Only actual observed SLA displayed; unpublished server configuration stays unmeasured and disabled. | Existing contracts preserved; unsupported mutations disabled | PASS appearance; readonly server settings |
| settings-whatsapp | PASS ±2px | Canonical cards and controls; real health mapped to source labels. No named-tunnel assertion, credential exposure or subscription mutation. | Existing contracts preserved; unsupported mutations disabled | PASS |
| team | PASS ±2px | Literal table, roles summary and permission grid. Capacity +/- wired to existing PATCH /api/users/:id, tested against isolated real backend. Existing user search/detail/deactivation preserved in secondary controls. Role matrix is readonly because no roles mutation API exists. | Existing contracts preserved; unsupported mutations disabled | PASS |
| transfer | PASS ±2px | Canonical destination cards, agent rows, reason, information and footer. Existing agent/queue transfer and return-to-bot used. AI transfer disabled: endpoint absent. | Existing contracts preserved; unsupported mutations disabled | PASS appearance; existing routes functional |

Dashboard / Contacts / Campaigns: blocked by absent source templates. Dark: no canonical reference. No fabricated global parity percentage or unsupported-screen PASS.
