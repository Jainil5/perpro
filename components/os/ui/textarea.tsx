'use client'

import type { TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/os/cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

/**
 * Same contract as Input: app/os.css gives the field one bottom hairline that
 * brightens to ink on focus, so there is no box, no fill and no ring here.
 */
export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full min-w-0 rounded-os bg-transparent px-3 py-2 text-[13px] leading-relaxed text-foreground transition-colors duration-150 placeholder:text-faint focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
        invalid && 'aria-invalid:!border-b-destructive',
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
