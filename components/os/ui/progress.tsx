'use client'

import { cn } from '@/lib/os/cn'
import { HairlineBar } from '../marks'

export interface ProgressProps {
  value?: number | null
  /**
   * Class string the screens already pass (e.g. `bg-warning`). Progress fills are
   * ink-only in this language (docs/DESIGN.md rule 1: colour is never a progress
   * fill), so a hue is not painted into the bar — it is kept as *state* and put
   * on the numeric readout instead.
   */
  tone?: string
  className?: string
  trackClassName?: string
  label?: string
  showValue?: boolean
  size?: 'sm' | 'md'
}

/** Maps a caller's tone class onto a semantic text colour, or null for none. */
function stateText(tone?: string): string | null {
  if (!tone) return null
  if (tone.includes('destructive') || tone.includes('danger')) return 'text-destructive'
  if (tone.includes('warning')) return 'text-warning'
  if (tone.includes('success')) return 'text-success'
  return null
}

/**
 * Determinate progress as a 2px ink fill on a hairline track — the shared
 * `HairlineBar` ornament, never a coloured bar. Values outside 0–100 clamp.
 *
 * `HairlineBar` owns the `progressbar` role and its value, so `label` is spoken
 * from an adjacent sr-only line rather than an aria attribute we cannot pass in.
 */
export function Progress({
  value,
  tone,
  className,
  trackClassName,
  label,
  showValue,
  size = 'md',
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value ?? 0)))
  const readoutState = stateText(tone)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {label ? <span className="sr-only">{label}</span> : null}
      <HairlineBar
        value={pct}
        className={cn('min-w-0 flex-1', size === 'sm' && 'h-px', trackClassName)}
      />
      {showValue ? (
        <span
          className={cn(
            'os-mono shrink-0 text-[11px] text-muted-foreground',
            pct === 100 && !readoutState && 'text-foreground',
            readoutState
          )}
        >
          {pct}%
        </span>
      ) : null}
    </div>
  )
}

/** Small stacked meter for dashboards where the number matters more than the bar. */
export function StatBar({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone?: string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-muted-foreground">{label}</span>
        <span className="os-mono shrink-0 tabular-nums text-foreground">
          {value}/{total}
        </span>
      </div>
      <Progress value={pct} tone={tone} size="sm" label={`${label}: ${pct}%`} />
    </div>
  )
}
