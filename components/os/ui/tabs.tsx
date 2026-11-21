'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * Tabs are a rail, not a pill set (docs/DESIGN.md §4): one bottom hairline
 * carries the row and the active tab grows a 2px ink bar on that same line.
 * The bar is a `before:` pseudo-element so switching tabs never moves text.
 */
export const Tabs = TabsPrimitive.Root

export const TabsList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn('flex min-w-0 items-center gap-6 border-b border-line text-muted-foreground', className)}
    {...props}
  />
)

export const TabsTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-0 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring before:absolute before:inset-x-0 before:bottom-0 before:h-[2px] before:bg-foreground before:opacity-0 data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:before:opacity-100 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',
      className
    )}
    {...props}
  />
)

export const TabsContent = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />
)
