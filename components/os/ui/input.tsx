'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/os/cn'

const inputVariants = cva(
  'flex w-full min-w-0 rounded-lg border bg-input px-3 py-2 text-[13px] text-foreground shadow-os transition-colors placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      size: {
        sm: 'h-8 text-xs',
        md: 'h-9',
        lg: 'h-11 text-sm',
      },
      invalid: {
        true: 'border-destructive focus-visible:ring-destructive',
        false: 'border-line',
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
    <div className={cn(inputVariants({ size: 'md' }), 'os-mono break-all bg-muted/60 py-2', className)}>
      {value}
    </div>
  )
}
