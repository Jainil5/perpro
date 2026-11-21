'use client'

import { cn } from '@/lib/os/cn'

/**
 * Loading placeholders are flat hairline blocks — no pulse, no shimmer, no fill
 * that could be mistaken for a surface. Motion here would only be noise: the
 * language moves on opacity and 1px translate at most (docs/DESIGN.md rule 7).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('h-[2px] rounded-os bg-line-faint', className)} />
}

/** Loading placeholder shaped like N rows of a list: disc slot + two hairlines. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('min-w-0', className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-faint py-2.5">
          <Skeleton className="size-2 rounded-full bg-line" />
          <Skeleton className="flex-1" />
          <Skeleton className="hidden w-20 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('os-panel min-w-0 space-y-2.5 p-3', className)}>
      <Skeleton className="h-[2px] w-1/3 bg-line" />
      <Skeleton className="w-full" />
      <Skeleton className="w-4/5" />
    </div>
  )
}
