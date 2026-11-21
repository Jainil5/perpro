'use client'

/**
 * Shared ornaments for the app-wide design language (docs/DESIGN.md).
 *
 * These are the only three things this design allows as "decoration": the white
 * disc, the bounded field of vertical hairlines, and monospace micro-data in the
 * corners of a block. Everything else gets its structure from type size and
 * 1px rules. Both the MyOS screens and the PerPro/legacy screens compose from
 * here so there is one implementation of each motif — components should not
 * re-create a disc or a grid with ad-hoc Tailwind classes.
 *
 * Styling comes from the token classes in app/os.css (.os-disc, .os-grid,
 * .os-dial, .os-dot, .os-micro), never from literal hex values.
 */

import { useEffect, useState } from 'react'

import { cn } from '@/lib/os/cn'

/* ------------------------------------------------------------------ disc */

/**
 * The brand mark. A solid ink disc, 12–14px in chrome, larger only when it is
 * the single focal object of a screen. One disc per screen (DESIGN.md rule 5).
 */
export function DiscMark({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('os-disc', className)}
      style={{ width: size, height: size }}
    />
  )
}

/** Half-filled disc: the theme control's glyph (see ThemeToggle.tsx). */
export function HalfDisc({ className }: { className?: string }) {
  return <span aria-hidden className={cn('os-toggle-disc', className)} />
}

/* ----------------------------------------------------------------- grid */

/**
 * Bounded vertical hairline field. `rows` is not a thing — the field is a fixed
 * height and the lines fade out to the right (`.os-grid`), which is what keeps
 * it a signature rather than a background texture. Use behind a dashboard hero,
 * a disc, or an empty state; never behind a form and never full-bleed.
 */
export function GridField({
  height = 96,
  className,
  full = false,
  children,
}: {
  height?: number
  className?: string
  /** disable the right-fade mask (only for small square blocks) */
  full?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      aria-hidden={children ? undefined : true}
      className={cn('relative', full ? 'os-grid-full os-grid' : 'os-grid', className)}
      style={{ height }}
    >
      {children}
    </div>
  )
}

/* ----------------------------------------------------------------- dial */

/**
 * Progress as a white arc on a hairline ring — the app's version of the
 * reference's single geometric object. Prefer this over a coloured bar.
 */
export function Dial({
  value,
  size = 44,
  label,
  className,
}: {
  value: number
  size?: number
  /** text drawn inside the ring, usually `62%` in mono */
  label?: React.ReactNode
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span
      className={cn('os-dial inline-grid place-items-center', className)}
      style={
        {
          width: size,
          height: size,
          '--dial': pct,
        } as React.CSSProperties
      }
    >
      <span className="os-mono text-[0.625rem] leading-none text-foreground">
        {label ?? `${pct}%`}
      </span>
    </span>
  )
}

/** Progress as a white fill on a hairline track (the non-disc alternative). */
export function HairlineBar({
  value,
  label,
  title,
  className,
}: {
  value: number
  /** rendered by the caller next to the bar; kept here so a bar alone is still
   *  self-describing for screen readers and tooltips */
  label?: string
  title?: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      title={title ?? (label ? `${label} ${pct}%` : `${pct}%`)}
      className={cn('block h-[2px] w-full bg-line-faint', className)}
    >
      <span className="block h-full bg-foreground" style={{ width: `${pct}%` }} />
    </span>
  )
}

/* ------------------------------------------------------------------ dot */

export type DotState =
  | 'open'
  | 'in_progress'
  | 'done'
  | 'completed'
  | 'abandoned'
  | 'archived'

export type DotTone = 'critical' | 'warning' | 'success'

/**
 * The 8px leading status glyph for any list row: outline = open, half = in
 * progress, filled = done. `tone` is the only place a hue may appear on a row,
 * and it means "this needs you" (overdue / due today), never "this is category X".
 */
export function StatusDot({
  state = 'open',
  tone,
  className,
  title,
}: {
  state?: DotState
  tone?: DotTone
  className?: string
  title?: string
}) {
  return (
    <span
      aria-hidden
      title={title}
      data-state={state}
      data-tone={tone}
      className={cn('os-dot', className)}
      style={
        tone === 'success'
          ? { borderColor: 'hsl(var(--os-success))', background: 'hsl(var(--os-success))' }
          : undefined
      }
    />
  )
}

/* ------------------------------------------------------------- micro-data */

/**
 * Monospace facts pinned to a corner: counts, store name, ISO date, last-sync
 * age. This is what replaces the reference's `N 40° 14'21.16"` coordinates —
 * so it must be real data, never decorative text.
 */
export function MicroData({
  items,
  className,
}: {
  items: Array<string | null | undefined | false>
  className?: string
}) {
  const list = items.filter((x): x is string => Boolean(x))
  if (list.length === 0) return null
  return (
    <span className={cn('os-micro inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {list.map((item, i) => (
        <span key={`${item}-${i}`}>{item}</span>
      ))}
    </span>
  )
}

/* ----------------------------------------------------------------- clock */

/**
 * Live mono clock, the header's counterpart to the reference's city clocks.
 * `tz` must be an IANA name; the workspace timezone and one configured city
 * come from Settings. Ticks on the minute boundary plus seconds.
 */
export function Clock({
  tz,
  label,
  className,
}: {
  tz: string
  label?: string
  className?: string
}) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const time = formatClock(now, tz)

  return (
    <span className={cn('os-micro inline-flex items-baseline gap-1.5 whitespace-nowrap', className)}>
      {label ? <span className="uppercase">{label}</span> : null}
      {/* the date is SSR-stable, the time is not: only the time re-renders */}
      <span suppressHydrationWarning>{time || '--:--:--'}</span>
    </span>
  )
}

/** Server-safe: returns '' when the zone is unknown so nothing throws in SSR. */
function formatClock(now: Date | null, tz: string): string {
  if (!now) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(now)
  } catch {
    return ''
  }
}

/** `HH:MM` for a specific instant in a zone — used for static corner data. */
export function clockFor(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(at)
  } catch {
    return '--:--'
  }
}
