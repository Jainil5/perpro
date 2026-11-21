'use client'

import { cn } from '@/lib/os/cn'
import { enumLabel } from '@/lib/os/format'
import { HairlineBar } from '../marks'

/**
 * A stat is a monospace number with an uppercase micro-label under it — the
 * reference's corner data, not a tile. No fills, no sparkline colours, and a
 * hue only where the number itself is a warning (overdue, failed).
 */
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
          : 'text-foreground'
  return (
    <div className={cn('min-w-0', className)}>
      {/* `.os-num` would pin the colour to ink and win the tie against a tone
          utility (app/os.css loads after the utilities), so the number is set
          with the same three properties as utilities and stays colourable. */}
      <p
        className={cn(
          'font-os-mono text-[20px] font-medium leading-none tracking-[-0.02em] tabular-nums',
          toneClass
        )}
      >
        {value}
      </p>
      <p className="os-label mt-1 truncate">{label}</p>
    </div>
  )
}

/**
 * `by_status` / `by_priority` maps from the stats endpoint, rendered as a
 * share-of-total hairline meter per bucket. The bar is ink on a faint hairline
 * track; the number is mono. Nothing here is coloured, because a bucket is a
 * category and colour is reserved for state.
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
    <div className="min-w-0 space-y-2">
      <p className="os-label">{title}</p>
      {total ? (
        <div className="min-w-0 space-y-2">
          {entries
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => (
              <div key={key} className="min-w-0 space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-muted-foreground">{enumLabel(key)}</span>
                  <span className="os-mono shrink-0 tabular-nums text-foreground">
                    {count}/{total}
                  </span>
                </div>
                <HairlineBar value={Math.round((count / total) * 100)} />
              </div>
            ))}
        </div>
      ) : (
        <p className="os-micro">Nothing counted yet.</p>
      )}
    </div>
  )
}
