'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { enumLabel } from '@/lib/os/format'
import type { Priority, ProjectStatus, Severity, TaskStatus } from '@/lib/os/types'
import { StatusDot, type DotState, type DotTone } from '../marks'

/**
 * A chip in this language is a hairline around an uppercase tracked micro-label
 * (docs/DESIGN.md §4, rule 1): no fill, and no hue unless the hue means
 * something the API actually reported — overdue, received, failed.
 *
 * The tone keys are the screen contract; only their class strings changed. The
 * `!` on every non-default line colour is deliberate: `app/os.css` paints
 * `--os-line` on all borders inside `.os-root` with the same specificity as a
 * Tailwind utility and a later place in the cascade, so a plain utility loses.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-os border px-1.5 py-0.5 font-os-display text-[11px] font-medium uppercase leading-4 tracking-[0.14em] whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-line text-muted-foreground',
        solid: '!border-primary bg-primary text-primary-foreground',
        outline: '!border-line-faint text-faint',
        primary: '!border-line-strong text-foreground',
        success: '!border-success/40 text-success',
        warning: '!border-warning/40 text-warning',
        danger: '!border-destructive/40 text-destructive',
        info: 'border-line text-muted-foreground',
        ai: 'border-line text-muted-foreground',
      },
      size: { sm: 'px-1 py-0 text-[10px] tracking-[0.1em]', md: '' },
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

/**
 * Priority is a code, not a chip: `P1…P4` in mono (docs/DESIGN.md §4). The
 * letter+number is the whole message, so it carries no hue.
 */
export const PRIORITY_CODE: Record<Priority, string> = {
  urgent: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4',
}

export function PriorityBadge({ value, className }: { value: string; className?: string }) {
  const code = PRIORITY_CODE[value as Priority]
  return (
    <span
      className={cn('os-mono shrink-0 text-[11px] tracking-[0.08em] text-muted-foreground', className)}
      title={code ? `${enumLabel(value)} priority` : undefined}
    >
      {code ?? enumLabel(value)}
    </span>
  )
}

/**
 * Status reads through the shared 8px glyph (outline = open, half = in progress,
 * filled = done) plus an uppercase micro-label. The tone tables survive as the
 * bridge from an API enum to that glyph; only blocked/overdue/due-today/completed
 * get a hue, because those are the states that ask something of you.
 */
const DOT_FOR_TONE: Record<string, { state: DotState; tone?: DotTone }> = {
  success: { state: 'done' },
  solid: { state: 'done' },
  danger: { state: 'open', tone: 'critical' },
  warning: { state: 'in_progress', tone: 'warning' },
  primary: { state: 'in_progress' },
  neutral: { state: 'open' },
  outline: { state: 'archived' },
  info: { state: 'open' },
  ai: { state: 'open' },
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
  const mark = DOT_FOR_TONE[toneFor(table, value) ?? 'neutral'] ?? DOT_FOR_TONE.neutral
  return (
    <span className={cn('inline-flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap', className)}>
      <StatusDot state={mark.state} tone={mark.tone} title={enumLabel(value)} />
      <span className="os-label truncate">{enumLabel(value)}</span>
    </span>
  )
}

/**
 * Severity reads through the shared 8px status glyph (components/os/marks.tsx)
 * rather than a second dot implementation: a filled one means "this is done",
 * a tinted outline means "this needs you", a plain outline means context.
 */
export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  const tone = toneFor(SEVERITY_TONE as Record<string, VariantProps<typeof badgeVariants>['tone']>, severity)
  return (
    <StatusDot
      state={tone === 'success' ? 'done' : 'open'}
      tone={tone === 'danger' ? 'critical' : tone === 'warning' ? 'warning' : undefined}
      title={enumLabel(severity)}
      className={className}
    />
  )
}
