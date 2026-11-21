'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

type LabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { hint?: ReactNode }

/** Every form label is the `.os-label` micro-label from app/os.css. */
export function Label({ className, children, hint, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root className={cn('os-label flex items-baseline gap-2', className)} {...props}>
      <span>{children}</span>
      {hint ? (
        <span className="font-os-body text-[10px] font-normal normal-case tracking-normal text-faint">
          {hint}
        </span>
      ) : null}
    </LabelPrimitive.Root>
  )
}

/** Label + control + inline error: the building block of every MyOS form. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="os-mono text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
