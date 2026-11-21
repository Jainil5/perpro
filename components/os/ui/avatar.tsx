'use client'

import { cn } from '@/lib/os/cn'
import { initials } from '@/lib/os/format'

const SIZES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-[11px]',
  lg: 'size-11 text-sm',
} as const

/**
 * Initials avatar. No Radix dependency: the people directory only ever needs a
 * stable, themed placeholder, never a remote image.
 */
export function Avatar({
  name,
  size = 'md',
  className,
  tone = 'bg-primary/12 text-primary',
}: {
  name?: string | null
  size?: keyof typeof SIZES
  className?: string
  tone?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line font-os-display font-semibold uppercase',
        SIZES[size],
        tone,
        className
      )}
    >
      {initials(name)}
    </span>
  )
}
