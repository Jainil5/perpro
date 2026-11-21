'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

export function Empty({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-6 py-10 text-center',
        className
      )}
    >
      {children}
    </div>
  )
}

export function EmptyMedia({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn('mb-1 text-faint [&_svg]:size-5', className)}
    >
      {children}
    </span>
  )
}

export function EmptyTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('font-os-display text-[13px] font-semibold', className)}>{children}</p>
}

export function EmptyDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('max-w-sm text-xs text-muted-foreground', className)}>{children}</p>
}

export function EmptyAction({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('mt-3 flex flex-wrap items-center justify-center gap-2', className)}>{children}</span>
}
