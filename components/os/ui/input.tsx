'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * The field *is* the line: app/os.css gives every input inside `.os-root` a
 * transparent box with one bottom hairline that brightens to ink on focus, so
 * this primitive only owns size, padding and the error state — and deliberately
 * has no border box, no fill and no ring glow.
 */
const inputVariants = cva(
  'flex w-full min-w-0 rounded-os bg-transparent px-3 py-2 text-[13px] text-foreground transition-colors duration-150 placeholder:text-faint focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9',
        lg: 'h-11 px-3.5 text-sm',
      },
      invalid: {
        true: 'aria-invalid:!border-b-destructive aria-invalid:text-foreground',
        false: '',
      },
    },
    defaultVariants: { size: 'md', invalid: false },
  }
)

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export function Input({ className, size, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(inputVariants({ size, invalid }), className)}
      {...props}
    />
  )
}

/** Read-only value displayed with input chrome (e.g. an API URL). */
export function StaticField({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn('os-mono min-w-0 break-all border-b border-line px-3 py-2 text-[12.5px] text-muted-foreground', className)}>
      {value}
    </div>
  )
}
