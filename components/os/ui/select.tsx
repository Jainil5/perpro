'use client'

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * The trigger is a hairline box (it is a control, not a field); the list is
 * canvas + hairline, and the highlighted option brightens to ink with a 2px bar
 * at the left, exactly like the menu primitives.
 */
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value
export const SelectSeparator = SelectPrimitive.Separator

export function SelectTrigger({
  className,
  children,
  size = 'md',
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'md' }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-2 rounded-os border border-line bg-transparent px-3 text-[13px] text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:border-line-strong focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-os border border-line bg-background text-popover-foreground',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn('p-1', position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]')}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectLabel({ className, ...props }: ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn('os-label px-2 pb-1 pt-1.5', className)} {...props} />
}

export function SelectItemText({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="absolute left-2 flex size-3.5 items-center justify-center text-foreground">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </>
  )
}

export function Option({
  value,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Item>, 'value'> & { value: string }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        'relative flex min-h-8 w-full cursor-pointer select-none items-center rounded-os py-1 pl-7 pr-2 text-[13px] outline-none transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-foreground before:opacity-0 focus:text-foreground focus:before:opacity-100 data-[highlighted]:text-foreground data-[highlighted]:before:opacity-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className
      )}
      {...props}
    >
      <SelectItemText>{children}</SelectItemText>
    </SelectPrimitive.Item>
  )
}
