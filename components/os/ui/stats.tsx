'use client'

import { cn } from '@/lib/os/cn'
import { enumLabel } from '@/lib/os/format'
import { Progress } from './progress'

/** Compact labelled number used across dashboards and detail headers. */
export function Stat({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string
  value: number | string
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : tone === 'primary'
            ? 'text-primary'
            : 'text-foreground'
  return (
    <div className={cn('min-w-0', className)}>
      <p className="os-eyebrow">{label}</p>
      <p className={cn('os-num text-[15px] font-semibold leading-tight', toneClass)}>{value}</p>
    </div>
  )
}

/**
 * `by_status` / `by_priority` maps from the stats endpoint, rendered as a
 * share-of-total meter per bucket.
 */
export function BucketBar({
  title,
  values,
}: {
  title: string
  values: Record<string, number> | null | undefined
}) {
  const entries = Object.entries(values ?? {}).filter(([, count]) => count > 0)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="os-eyebrow">{title}</p>
      {total ? (
        entries
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => (
            <div key={key} className="min-w-0 space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{enumLabel(key)}</span>
                <span className="os-mono shrink-0 tabular-nums">
                  {count}/{total}
                </span>
              </div>
              <Progress
                value={Math.round((count / total) * 100)}
                size="sm"
                tone={count === total ? 'bg-success' : 'bg-primary/70'}
                label={`${enumLabel(key)}: ${count} of ${total}`}
              />
            </div>
          ))
      ) : (
        <p className="text-[11px] text-faint">Nothing counted yet.</p>
      )}
    </div>
  )
}
