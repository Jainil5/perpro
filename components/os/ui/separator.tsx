'use client'

import * as SeparatorPrimitive from '@radix-ui/react-separator'
import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/os/cn'

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...props}
    />
  )
}

/** Thin vertical divider for toolbars. */
export function VDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('mx-1 h-5 w-px shrink-0 bg-line', className)} />
}
