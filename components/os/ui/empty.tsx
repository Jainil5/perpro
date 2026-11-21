'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { GridField } from '../marks'

/**
 * Empty state per docs/DESIGN.md §4: a bounded hairline grid field, one
 * sentence in the display face, and a monospace hint. The container is not a
 * card — it is space on the canvas with an optional hairline from the caller.
 */
export function Empty({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-10 text-center', className)}>
      {children}
    </div>
  )
}

export function EmptyMedia({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <GridField
      height={72}
      full
      className={cn('grid w-full max-w-[10rem] place-items-center', className)}
    >
      <span aria-hidden className="flex size-full items-center justify-center text-faint [&_svg]:size-5">
        {children}
      </span>
    </GridField>
  )
}

export function EmptyTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('font-os-display text-[17px] font-medium leading-snug tracking-[-0.02em] text-foreground', className)}>
      {children}
    </p>
  )
}

export function EmptyDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('os-micro max-w-sm', className)}>{children}</p>
}

export function EmptyAction({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('mt-1 flex flex-wrap items-center justify-center gap-2', className)}>{children}</span>
}
