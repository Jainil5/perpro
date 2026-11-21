'use client'

import { cn } from '@/lib/os/cn'

export interface ProgressProps {
  value?: number | null
  /** Tailwind background class for the filled part. */
  tone?: string
  className?: string
  trackClassName?: string
  label?: string
  showValue?: boolean
  size?: 'sm' | 'md'
}

/** Determinate progress bar. Values outside 0–100 are clamped. */
export function Progress({
  value,
  tone = 'bg-primary',
  className,
  trackClassName,
  label,
  showValue,
  size = 'md',
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value ?? 0)))
  const ariaLabel = label ?? `Progress ${pct}%`
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
        className={cn(
          'min-w-0 flex-1 overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1' : 'h-1.5',
          trackClassName
        )}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue ? (
        <span className={cn('os-mono shrink-0 text-[11px] text-muted-foreground', pct === 100 && 'text-success')}>
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
  tone = 'bg-primary',
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
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="os-mono shrink-0 tabular-nums">
          {value}/{total}
        </span>
      </div>
      <Progress value={pct} tone={tone} size="sm" label={`${label}: ${pct}%`} />
    </div>
  )
}
