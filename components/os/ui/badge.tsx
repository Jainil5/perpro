'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { enumLabel } from '@/lib/os/format'
import type { Priority, ProjectStatus, Severity, TaskStatus } from '@/lib/os/types'

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-muted/70 text-muted-foreground',
        solid: 'border-transparent bg-primary text-primary-foreground',
        outline: 'border-line-strong bg-transparent text-muted-foreground',
        primary: 'border-primary/25 bg-primary/12 text-primary',
        success: 'border-success/25 bg-success/12 text-success',
        warning: 'border-warning/30 bg-warning/12 text-warning',
        danger: 'border-destructive/30 bg-destructive/12 text-destructive',
        info: 'border-info/25 bg-info/12 text-info',
        ai: 'border-ai/25 bg-ai/12 text-ai',
      },
      size: { sm: 'text-[10px] px-1 py-0', md: '' },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  children: ReactNode
}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />
}

/* ------------------------------------------------------- domain vocabularies */

export const PRIORITY_TONE: Record<Priority, VariantProps<typeof badgeVariants>['tone']> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

export const TASK_STATUS_TONE: Record<TaskStatus, VariantProps<typeof badgeVariants>['tone']> = {
  todo: 'neutral',
  in_progress: 'primary',
  blocked: 'danger',
  done: 'success',
  dropped: 'outline',
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, VariantProps<typeof badgeVariants>['tone']> = {
  backlog: 'neutral',
  planning: 'info',
  in_progress: 'primary',
  on_hold: 'warning',
  review: 'ai',
  completed: 'success',
  archived: 'outline',
}

export const SEVERITY_TONE: Record<'critical' | 'warning' | 'info' | 'success', VariantProps<typeof badgeVariants>['tone']> =
  {
    critical: 'danger',
    warning: 'warning',
    info: 'info',
    success: 'success',
  }

/** Unknown values from the API render as the raw string, per the contract. */
export function toneFor(
  table: Record<string, VariantProps<typeof badgeVariants>['tone']>,
  value: string
): VariantProps<typeof badgeVariants>['tone'] {
  return table[value] ?? 'neutral'
}

export function PriorityBadge({ value, className }: { value: string; className?: string }) {
  return (
    <Badge tone={toneFor(PRIORITY_TONE, value)} className={className}>
      {enumLabel(value)}
    </Badge>
  )
}

export function StatusBadge({
  value,
  table,
  className,
}: {
  value: string
  table: Record<string, VariantProps<typeof badgeVariants>['tone']>
  className?: string
}) {
  return (
    <Badge tone={toneFor(table, value)} className={className}>
      {enumLabel(value)}
    </Badge>
  )
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  const tone = toneFor(SEVERITY_TONE as Record<string, VariantProps<typeof badgeVariants>['tone']>, severity)
  const color =
    tone === 'danger'
      ? 'bg-destructive'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'success'
          ? 'bg-success'
          : 'bg-info'
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', color, className)} />
}
