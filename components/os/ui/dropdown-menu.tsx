'use client'

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * Menu grammar: the surface is canvas with one hairline, the highlighted row
 * brightens to ink and grows a 2px ink bar at the left — no background wash,
 * no shadow. The bar is a `before:` pseudo-element so rows never shift.
 */
const ROW =
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-os px-2 py-1.5 text-[13px] outline-none transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-foreground before:opacity-0 focus:text-foreground focus:before:opacity-100 data-[highlighted]:text-foreground data-[highlighted]:before:opacity-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

const SURFACE =
  'z-50 min-w-[11rem] overflow-hidden rounded-os border border-line bg-background p-1 text-popover-foreground'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          SURFACE,
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        ROW,
        '[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        inset && 'pl-7',
        variant === 'destructive' &&
          'text-destructive focus:text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive',
        className
      )}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(ROW, 'py-1.5 pl-7 pr-2', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center text-foreground">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" strokeWidth={2.5} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(ROW, 'py-1.5 pl-7 pr-2', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center text-foreground">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" strokeWidth={2.5} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('os-label px-2 pb-1 pt-1.5', inset && 'pl-7', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn('my-1 h-px shrink-0 bg-line', className)} {...props} />
  )
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        ROW,
        'justify-between gap-2 data-[state=open]:text-foreground data-[state=open]:before:opacity-100',
        inset && 'pl-7',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="size-3.5 text-muted-foreground" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        className={cn(SURFACE, 'data-[state=open]:animate-in data-[state=open]:fade-in-0', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuShortcut({ className, ...props }: ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      className={cn('os-mono ml-auto text-[10px] tracking-normal text-faint', className)}
      {...props}
    />
  )
}
