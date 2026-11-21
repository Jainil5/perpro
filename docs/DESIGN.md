# DESIGN.md — Studio—BA language for the PerPro / MyOS app

Direction taken from the reference the owner pointed at (`recent.design/i/5o7pof2-studio-ba`,
brunoarizio.com). Values below were measured off the 1440×900 capture, not eyeballed.

## 1. What the reference actually is

A stark near-black canvas with **one white geometric object** (a disc) sitting on a bounded
field of **fine vertical hairlines**, a **massive sentence-case grotesque statement** at the
bottom ("Studio—BA® is a multidisciplinary design practice."), and everything else reduced to
**uppercase micro-labels and monospace data** pinned to the corners. No accent colour, no
gradients, no shadows, no rounded cards, no glass. Contrast comes from type size and empty
space, not from hue. The wordmark is uppercase and tracked (`STUDIO—BA®`); the statement is
sentence-case and tight.

Measured palette:

| role | hex | notes |
|---|---|---|
| canvas | `#0F1012` | 98% of pixels; slightly cool |
| canvas deep | `#060608` | behind the header rule, footer band |
| ink | `#FFFFFF` | disc, headline, active state |
| ink muted | `#CCCDCD` | body copy, secondary labels |
| hairline | `#2D2E2F` | grid lines, 1px rules, borders |
| hairline faint | `#1A1B1E` | inner separators, disabled |

Grid pitch ≈ 24px, line weight 1px, lines stop at the edge of their column — they never run
full-bleed. Header is a single 1px rule with 44–48px height: wordmark left, two city clocks
centred, label + theme toggle right. Bottom-left carries `N 40° 14'21.16"` style micro-data.

## 2. Translation rules for a working app

The reference is a portfolio page; this is a dense command centre. Keep its *grammar*, not its
emptiness:

1. **Colour is information, not decoration.** The app goes black/white/grey. The only hues left
   are semantic and desaturated: critical `#FF4D4D` → used only for overdue/failed, success
   `#3ECF8E` → only for completed/received, warning `#E5B800` → only for due-today/pending.
   Never for chips, headings, icons, progress fills or hover. Progress is a **white bar on a
   hairline track**, or a filled disc percentage.
2. **Type hierarchy does the organising.** Page title = display grotesque 40–64px, sentence-case
   (not all-caps, not title-case), `-0.03em` tracking, weight 500–600. Section label = 11px
   uppercase, `0.14em` tracking, `#CCCDCD`, never bold. Data (dates, counts, money, ids) =
   monospace 11–12px. Body 14px `#CCCDCD`. Nothing in between is allowed to be loud.
3. **Surfaces are separated by hairlines, not cards.** Kill `rounded-2xl`, `shadow-*`,
   `bg-white/5`, backdrop blur. Radius is 0 or 2px max. A panel is a 1px `#2D2E2F` border on the
   canvas, or nothing but a top rule + label. Hover = ink brightens to `#FFFFFF` and a hairline
   appears; not a background wash.
4. **The vertical grid is the signature.** Use it sparingly and only as a *bounded* field:
   behind the dashboard hero block, behind the disc mark, behind empty states. Implemented as
   `repeating-linear-gradient(90deg, transparent 0 23px, var(--hairline) 23px 24px)` inside a
   fixed-height region with a mask fading to the right — never site-wide, never on forms.
5. **The disc is the brand mark.** A white circle does double duty: the logo in the header, and
   a progress/"today" dial (conic-gradient ring with a hairline gap, or a clipped circle whose
   fill height = % complete). One per screen maximum.
6. **Micro-data in the corners.** Header right keeps the reference's live clocks (workspace
   timezone + one configured city, from Settings) and the half-disc theme toggle. Page footers /
   panel corners carry monospace facts: record counts, `SQLite · backend/data/myos.db`, ISO date,
   last-sync age. This replaces decorative labels.
7. **Motion is mechanical, not bouncy.** 120–180ms, `cubic-bezier(0.2,0.8,0.2,1)`, opacity and
   1px translate only. No spring, no scale on hover, no layout animation on lists. Respect
   `prefers-reduced-motion` (already global).

## 3. Token contract

One token set for the whole app, defined in `app/os.css` on `html.os-root`
(dark, default) and inverted on `html.os-root.os-light`. `components/Shell.tsx`
mounts those classes on the single app root and `OsThemeScript` puts them on
`<html>` before paint, so MyOS screens, PerPro screens and `/legacy/*` screens all
read the same palette — there is no second design system.

`app/globals.css` keeps PerPro's original variable names (`--bg-deep`,
`--accent-brand`, `.text-display`, …) but they now resolve to the `--os-*`
tokens, so legacy components inherit the same look instead of a competing one.
`tailwind.config.ts` maps the semantic utilities onto the tokens
(`bg-card`, `border-line`, `text-success`, `text-faint` …) and deliberately
pins `rounded-os-lg`/`rounded-os-sm` to the same 2px as `rounded-os` and both
shadow variables to `none`, so a leftover utility class cannot resurrect the
old card language.

```css
--os-background / --os-canvas-deep / --os-line / --os-line-faint
--os-foreground / --os-muted-foreground / --os-faint
--os-danger / --os-success / --os-warn          /* semantic only, see rule 1 */
--os-primary                                     /* white ink, never a hue */
--os-font-display  'Space Grotesk'             /* headlines, wordmark */
--os-font-body     'DM Sans'                   /* running text */
--os-font-mono     'JetBrains Mono'            /* every number, date, id */
--os-grid-pitch: 24px;  --os-radius: 2px;  --os-h-display: clamp(2.5rem, 5.2vw, 4.5rem)
```

The reusable motifs live in `components/os/marks.tsx` (`DiscMark`, `HalfDisc`,
`GridField`, `Dial`, `HairlineBar`, `StatusDot`, `MicroData`, `Clock`) backed by
`.os-grid`, `.os-disc`, `.os-dial`, `.os-dot`, `.os-panel`, `.os-label`,
`.os-title`, `.os-display`, `.os-mono`, `.os-micro` in `app/os.css`. Nothing
should hand-roll a disc, grid, dial or clock a second time.

Light mode is the reference inverted, not a grey wash: canvas `#FFFFFF`, deep
`#F4F4F4`, ink `#0F1012`, hairline `#DCDCDE`, muted `#5A5C60`, disc becomes
black on white.

## 4. Component rules (what "done" looks like)

- **Header**: 1px bottom rule, wordmark `PERPRO—OS®` in display 14px tracked, clocks in mono,
  half-disc toggle. Sidebar (when present) is a plain column of uppercase 11px labels grouped
  PERSONAL / FINANCE / BUSINESS / SYSTEM, active item marked by a 2px white left bar + white ink,
  never a filled pill.
- **Buttons**: primary = white bg / black ink, 2px radius, 13px label, no shadow. Secondary =
  transparent with 1px hairline. Danger = hairline + `#FF4D4D` text, never a red fill.
- **Inputs**: transparent, 1px hairline bottom border only, focus = hairline → white + 1px
  underline offset. Labels above in uppercase micro. Errors in `#FF4D4D` mono.
- **Lists/tables**: hairline row separators, no zebra striping, no card wrappers. Leading status
  glyph is a 8px disc (outline = open, filled = done, half = in progress). Right-aligned mono
  dates. Priority as a text label `P1/P2/P3`, not a coloured badge.
- **Kanban**: columns separated by hairlines only; drag target = 1px white top rule on the
  column; card = canvas + hairline border, 2px radius.
- **Stats**: display-size number + uppercase label beneath, separated by hairlines; no sparkline
  colour, no gradient tiles.
- **Empty state**: bounded grid field + one sentence in display type + a monospace hint. No
  illustrations, no emoji.
- **Charts** (later phases): white lines on canvas, hairline gridlines, no fills, no legend
  boxes — labels sit on the axis in mono.

## 5. Non-negotiables

No indigo/violet/emerald accent anywhere. No rounded-2xl/3xl. No shadows or blur. No gradient
text. No emoji icons. No coloured chips. Icons stay 1px-stroke lucide at 16/20px, `#CCCDCD`
default, white when active. Density stays high — this is a tool: 12–14px gutters, 32–36px rows,
but with the reference's confident empty space around page titles.
