'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * Unchecked = a hairline box; checked = a disc of ink with the canvas showing
 * through the tick. Radius is the app radius (2px), not a squircle.
 */
export const Checkbox = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      'peer size-4 shrink-0 rounded-os border border-line bg-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={2.5} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
)

/** Checkbox wrapped in a clickable label row — used in filters and bulk bars. */
export function CheckboxRow({
  label,
  checked,
  onCheckedChange,
  className,
  id,
  disabled,
}: {
  label: ReactNode
  checked: boolean | 'indeterminate'
  onCheckedChange: (next: boolean) => void
  className?: string
  id?: string
  disabled?: boolean
}) {
  return (
    <label
      htmlFor={id}
      className={cn('flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground', className)}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}
