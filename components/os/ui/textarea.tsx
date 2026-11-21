'use client'

import type { TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/os/cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-w-0 rounded-lg border bg-input px-3 py-2 text-[13px] leading-relaxed text-foreground shadow-os transition-colors placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        invalid ? 'border-destructive' : 'border-line',
        'resize-y',
        className
      )}
      {...props}
    />
  )
}

/** Monospace editor used for markdown bodies and pasted JSON. */
export function CodeArea({ className, ...props }: TextareaProps) {
  return (
    <Textarea
      spellCheck={false}
      className={cn('os-mono min-h-[220px] leading-[1.65] text-[12.5px]', className)}
      {...props}
    />
  )
}
