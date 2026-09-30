# Exact Claude source tokens

All values below are literal values from `CAP Inbox.dc.html`, not estimates.

| Token | Value | Source lines |
|---|---|---|
| shell sidebar | 104px | 17 |
| compact sidebar | Not defined | 17, 394, 475 |
| shell topbar | Not present | 17–47 |
| outer gutter | top/right/bottom 8px; left 0 | 49 |
| list width | minmax(280px,340px) | 50 |
| contact panel | 300px; separation 8px | 49,114 |
| panel breakpoint | 1320px | 475 |
| list padding | 24px 14px 14px 22px | 51 |
| chat padding | 26px 26px 18px 16px | 72 |
| page padding | 30px 34px 40px | 142,175,221,243,266 |
| panel radius | 32px | 50,115,130 |
| card radius | 24px | 147,149 |
| action/input | 42px / 44px | 78,52 |
| modal | min(580px,100%), padding30px, radius32px, gap18px | 277 |
| rail filter | width84px; padding13px 4px 11px; gap7px; icon24px; text12.5px/500/1.2 | 21–24 |
| rail page | width84px; padding11px 4px 10px; gap6px; icon22px; text11.5px/500/1.2 | 28–31 |
| rail logo | 44×44px, margin-bottom30px | 19 |
| rail profile | margin-top:auto; padding12px 4px 4px | 33 |
| list avatar | 58×58px, radius14px, font19px/500 | 60 |
| list row | padding12px 10px, gap14px, radius18px | 59 |
| list title | 15.5px/500 | 62 |
| list preview | 13.5px | 63 |
| chat heading | 32px/500/1.2; letter-spacing -.01em | 75 |
| bubble | row max78%, gap14px; padding12px 18px 10px; radius16px | 85–98 |
| message avatar | 56×56px, radius12px | 86,98 |
| message text | 15px, line-height1.5 | 90,96 |
| message label | 14px/500; first of speaker group only | 88,483–490 |
| group margin | last14px, other6px; avatar only at group end | 489 |
| quick reply | height32px, padding0 14px, gap8px, font12.5px/500 | 102 |
| composer | padding6px 6px 6px 8px, gap10px, border1px #e4e5fb, radius16px | 103 |
| scrollbar | width/height8px, thumb#dcdce8 radius99px | 15 |
| font | Poppins 400/500/600/700, system-ui fallback | 12,15 |
| ink / rail selected | #202022 / #2f2f34 | 336 |
| violet / dark / soft / light | #7678ed / #4f51c4 / #e4e5fb / #f1f1fb | 336 |
| coral / dark / soft | #ff7a55 / #c2451f / #ffe6dd | 336 |
| surface / history / border | #f9fafc / #dedff9 / #ececf3 | 50,130,336 |
| muted / tertiary / chip | #737384 / #9a9aa6 / #ededf2 | 336 |

Source hover changes rail foreground to white without adding a background. Conversation hover/selection is #f1f1fb. Active navigation is #2f2f34, not a white tile. Source has no list heading, horizontal filter tabs, chat tag strip, technical trace buttons in bubbles, or list synchronization footer. CAP-only controls are retained in secondary menus/details.
