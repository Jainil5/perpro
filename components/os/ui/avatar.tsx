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
 *
 * It is a disc (the brand motif) drawn as a hairline ring with muted ink — a
 * fill would read as a card, and a hue would read as state.
 */
export function Avatar({
  name,
  size = 'md',
  className,
  tone = 'border-line text-muted-foreground',
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
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-os-display font-medium uppercase tracking-[0.04em]',
        SIZES[size],
        tone,
        className
      )}
    >
      {initials(name)}
    </span>
  )
}
