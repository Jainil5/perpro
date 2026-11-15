# Perpro Design Enhancement Plan

## Brief Analysis
A personal productivity dashboard (Tasks, Meetings, Notes, Inbox, News) with AI-assisted capture and extraction. Dark theme, zinc/indigo palette. Framer Motion already heavily integrated with staggered entrances, layout animations, spring micro-interactions.

**Subject matter**: Personal command center for knowledge workers — capturing, organizing, acting on information. Feels like a pilot's cockpit or mission control: dense, functional, high-trust, low-friction.

---

## Color Token System

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-deep` | `#0A0B0F` | Page background — near-black with subtle blue undertone |
| `bg-surface` | `#11131A` | Cards, modals, inputs — elevated surface |
| `bg-elevated` | `#181B23` | Hover states, active elements, dropdowns |
| `fg-primary` | `#E8EAF0` | Primary text — warm white, not pure |
| `fg-muted` | `#6B7280` | Secondary text, timestamps, placeholders |
| `fg-subtle` | `#3D4451` | Dividers, disabled, borders |
| `accent-brand` | `#6366F1` | Indigo — primary actions, links, focus rings |
| `accent-brand-hover` | `#818CF8` | Hover state for brand actions |
| `accent-warn` | `#F59E0B` | Amber — due today, pinned, attention |
| `accent-critical` | `#EF4444` | Red — overdue, destructive, dismiss |
| `accent-success` | `#22C55E` | Green — completed, saved, confirmed |
| `accent-ai` | `#A855F7` | Purple — AI features, magic moments |

**Rationale**: Moving away from generic zinc/indigo to a deeper, more atmospheric palette with semantic accent colors. The near-black base with blue undertone (`#0A0B0F`) creates depth; warm white text reduces eye strain. Semantic accents (warn/critical/success/ai) replace the single indigo accent for clearer affordances.

---

## Typography

| Role | Family | Scale | Weight | Tracking |
|------|--------|-------|--------|----------|
| Display | `Space Grotesk` | `text-4xl` / `3.5rem` | 700 | `-0.02em` |
| Heading | `Space Grotesk` | `text-xl` / `1.25rem` | 600 | `-0.01em` |
| Subheading | `Space Grotesk` | `text-sm` / `0.875rem` | 600 | `+0.05em` (uppercase) |
| Body | `DM Sans` | `text-sm` / `0.875rem` | 400 | `0` |
| Body-sm | `DM Sans` | `text-xs` / `0.75rem` | 400 | `0` |
| Mono | `JetBrains Mono` | `text-xs` / `0.75rem` | 400 | `0` |

**Rationale**: `Space Grotesk` for display/headings — geometric, technical, distinctive. `DM Sans` for body — highly readable at small sizes, neutral but warm. `JetBrains Mono` for code/timestamps. Avoids Inter/Roboto defaults. Uppercase tracking-wide subheadings only for section labels (not everywhere).

---

## Layout Concept

**Alignment**: Left-aligned throughout. Content max-width `max-w-3xl` (dashboard) / `max-w-4xl` (notes grid). No centered hero sections.

**Grid System**:
- Dashboard: Single column, sections stacked with `space-y-8`
- Notes: `sm:grid-cols-2 lg:grid-cols-3` responsive grid
- Forms: Single column, `space-y-4`, labels above inputs
- Modals: `max-w-2xl` wide, centered overlay

**Spacing Scale**: 4px base unit. `space-y-2` (8px) for tight groups, `space-y-4` (16px) for form fields, `space-y-8` (32px) for sections.

**ASCII Wireframe — Dashboard**:
```
┌─────────────────────────────────────┐
│  Today, November 8          3 ovrd  │  ← PageHeader (staggered entrance)
│  2 due today · 5 in inbox           │
├─────────────────────────────────────┤
│  [ Capture anything...          ] [Capture]  ← Quick capture (focus scale)
├─────────────────────────────────────┤
│  DUE TODAY & OVERDUE          [All] │  ← Section header + link
│  ┌───────────────────────────────┐  │
│  │ ☐  High priority task      ★ │  │  ← TaskRow (slide-in, checkbox spring)
│  │    Due today · #work #urgent  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ☐  Overdue item             │  │  ← Red accent on overdue
│  │    Overdue by 2 days · #home  │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  NEXT MEETING                 [All] │
│  ┌───────────────────────────────┐  │
│  │ Investor call          2:30PM │  │  ← Meeting card (hover lift)
│  │ John, Sarah · Zoom link       │  │
│  │ Q3 metrics review...          │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  INBOX (3)                    [Triage]│
│  ┌───────────────────────────────┐  │
│  │ Quick thought captured...     │  │  ← Inbox item (slide from left)
│  │ Nov 8 · 9:15 AM  [→Task][→Note]│  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  PINNED NOTES                 [All] │
│  ┌──────┐ ┌──────┐ ┌────────────┐  │  ← Note cards (scale entrance)
│  │Note 1│ │Note 2│ │   Note 3   │  │
│  │body..│ │body..│ │   body.... │  │
│  └──────┘ └──────┘ └────────────┘  │
└─────────────────────────────────────┘
```

---

## Motion Principles

### 1. One Orchestrated Page Load
- Single staggered sequence per page (not per section)
- Parent container: `staggerChildren: 0.08`, `delayChildren: 0.15`
- Sections enter together, not sequentially

### 2. Micro-Interactions Answer Actions
- **Tap**: `scale: 0.96` (buttons), `scale: 0.92` (icon buttons)
- **Hover**: `scale: 1.015` (cards), `x: 4` (list items), `y: -2` (note cards)
- **Focus**: `scale: 1.01` (inputs), ring `accent-brand`
- **Drag/Reorder**: `layout` + `transition: { type: 'spring', stiffness: 400, damping: 30 }`

### 3. State Transitions Are Expressive
- **Checkbox**: Path-drawing spring (existing — keep)
- **Pin/Star**: Scale + rotate spring (existing — keep)
- **Complete task**: Fade + slide right + scale down, `layout` for siblings to fill gap
- **Delete**: Collapse height → 0, opacity → 0, `AnimatePresence popLayout`
- **AI loading**: Pulsing ring on button, skeleton shimmer on result area
- **Toast/Notice**: Slide from bottom-right, stack, auto-dismiss with fade

### 4. Modal/Overlay Choreography
- Backdrop: `opacity: 0 → 1`, `backdrop-blur: 0 → 8px`
- Panel: `y: 30, scale: 0.96 → y: 0, scale: 1`, spring
- Fields: Staggered `0.04s` delay each
- Exit: Reverse, faster (`duration: 0.15`)

### 5. Respect Reduced Motion
- `@media (prefers-reduced-motion: reduce)` disables all non-essential motion
- Keep: layout transitions for reordering, instant state changes
- Remove: stagger, hover/tap transforms, page-load sequences

---

## Component Enhancements

### Global
- Add `MotionConfig` at app root with reduced-motion detection
- CSS custom properties for all color tokens
- Consistent `transition: { type: 'spring', stiffness: 400, damping: 28 }` as default

### Button (ui.tsx)
- Variants: `primary` (brand), `secondary` (surface), `ghost`, `danger` (critical), `ai` (purple)
- Loading state: spinner + disabled, width locked
- Icon-only: `h-11 w-11` touch target

### TaskRow
- Priority indicator: animated gradient bar (left edge) instead of dots
- Due date: color + icon (calendar/exclamation) based on state
- Tags: `Tag` component with entrance stagger

### Modal
- Size variants: `default`, `wide`, `full`
- Header with drag handle visual (non-functional but communicative)
- Footer actions: primary right, danger left

### PageHeader
- Title + subtitle + action slot
- Subtitle shows live count (existing) with count animation on change

### News Page
- Source filter chips: animate width on selection
- Article cards: summary expand/collapse on click
- Save button: star morph animation

### Notes Page
- Grid cards: flip to preview on click (3D rotateY)
- AI buttons: progress ring during streaming
- Summary: typewriter effect on append

### Meetings Page
- Upcoming/Past tabs with animated underline indicator
- Linked tasks: drag to reorder, drop to create new
- Extract actions: streaming result with staggered item appearance

### Inbox Page
- Swipe actions on mobile (touch)
- Bulk select mode with checkbox reveal animation
- Convert buttons: icon morph (→ becomes ✓ on success)

---

## Review Against Brief

| Generic Default | This Plan's Choice | Why |
|-----------------|-------------------|-----|
| Zinc/indigo only | 12-token semantic palette | Clear affordances for states |
| Inter/Roboto | Space Grotesk + DM Sans | Distinctive, technical personality |
| Centered hero | Left-aligned command center | Matches "pilot's cockpit" mental model |
| Fade-slide everything | One orchestrated load + action-driven micro | Restraint, purposeful motion |
| Card grid everywhere | Section-appropriate layouts | Hierarchy, not uniformity |
| Single accent color | 4 semantic accents + AI purple | State clarity, feature identity |
| Generic hover scale | Lift (y:-2), slide (x:4), morph | Context-appropriate feedback |

---

## Implementation Order

1. **Tokens & Foundation** — CSS custom properties, MotionConfig, reduced-motion
2. **Typography** — Font imports, type scale utilities
3. **ui.tsx** — Button variants, Modal sizes, PageHeader, Tag, Spinner
4. **TaskRow** — Priority bar, due date icons, tag stagger
5. **Dashboard (page.tsx)** — Orchestrated load, section choreography
6. **Tasks page** — Filter tabs animation, modal field stagger
7. **Inbox page** — Swipe actions, bulk select, convert morph
8. **Meetings page** — Tab indicator, linked tasks drag, streaming AI
9. **Notes page** — Card flip, AI typewriter, summary append
10. **News page** — Filter chip width, article expand, save morph
11. **Polish** — Reduced motion audit, performance, focus states