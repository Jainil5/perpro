'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays, FolderGit2 } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { daysUntil, dueLabel, DUE_TONE_TEXT, dueTone, enumLabel, formatDate } from '@/lib/os/format'
import type { Project } from '@/lib/os/types'
import { HairlineBar, StatusDot } from './marks'
import { dotStateFor, dotToneForDue, PriorityText } from './TaskRow'
import { Card } from './ui/card'

/**
 * Project card used by /projects and the dashboard grid. A panel here is the
 * canvas + 1px hairline + 2px radius — no fill, no shadow. Progress is the
 * white HairlineBar on a hairline track; status leads with the 8px disc.
 */
export function ProjectCard({
  project,
  onEdit,
  className,
}: {
  project: Project
  onEdit?: (project: Project) => void
  className?: string
}) {
  const counts = project.task_counts ?? { total: 0, done: 0, open: 0, overdue: 0 }
  const left = daysUntil(project.target_date)
  const settled = project.status === 'completed' || project.status === 'archived'
  const targetTone = settled ? 'none' : dueTone(project.target_date)

  return (
    <Card
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-os border-line bg-transparent p-4 shadow-none',
        className
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <StatusDot
            state={dotStateFor(project.status)}
            tone={dotToneForDue(targetTone)}
            title={enumLabel(project.status)}
            className="mt-[6px]"
          />
          <div className="min-w-0">
            <Link
              href={`/projects/${project.id}`}
              className="block truncate font-os-display text-[13.5px] font-medium tracking-tight text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
            >
              {project.name}
            </Link>
            {project.category ? (
              <p className="os-label os-label-faint mt-1 truncate">{project.category}</p>
            ) : null}
          </div>
        </div>
        {onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(project)}
            className="os-tap-none shrink-0 rounded-os px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
          >
            Edit
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="os-label">{enumLabel(project.status)}</span>
        <PriorityText value={project.priority} />
        {project.description ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {project.description}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <HairlineBar value={project.progress ?? 0} className="min-w-0 flex-1" />
        <span className="os-mono shrink-0 text-[11px] text-muted-foreground">
          {Math.round(project.progress ?? 0)}%
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        <Stat label="Open" value={counts.open} />
        <Stat label="Done" value={counts.done} />
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue > 0 && !settled ? 'text-danger' : undefined} />
        <Stat label="Milestones" value={`${project.milestones_done ?? 0}/${project.milestone_count ?? 0}`} />
      </dl>

      <div className="min-w-0 border-t border-line pt-2.5">
        <p className="os-label">Next action</p>
        {project.next_action ? (
          <p className="mt-1 text-[12.5px] leading-snug text-foreground">{project.next_action}</p>
        ) : (
          <p className="mt-1 text-[12px] text-faint">
            Not set —{' '}
            <button
              type="button"
              onClick={() => onEdit?.(project)}
              className="text-muted-foreground underline decoration-line-strong underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              add one
            </button>
          </p>
        )}
        {project.next_due?.title ? (
          <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
            <ArrowRight className="size-3 shrink-0 self-center text-faint" />
            <span className="min-w-0 truncate">{project.next_due.title}</span>
            {project.next_due.due_date ? (
              <span
                className={cn(
                  'os-mono ml-auto shrink-0 text-right',
                  DUE_TONE_TEXT[dueTone(project.next_due.due_date)]
                )}
              >
                {dueLabel(project.next_due.due_date)}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="os-mono mt-auto flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {project.target_date ? (
          <span className={cn('inline-flex items-center gap-1', DUE_TONE_TEXT[targetTone])}>
            <CalendarDays className="size-3 self-center text-faint" />
            <span>{formatDate(project.target_date)}</span>
            <span className="text-faint">
              {left == null
                ? ''
                : left < 0
                  ? ` · ${Math.abs(left)}d late`
                  : left === 0
                    ? ' · today'
                    : ` · ${left}d`}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-faint">
            <CalendarDays className="size-3 self-center" />
            no target date
          </span>
        )}
        {project.milestone_count ? (
          <span className="text-faint">{project.milestone_count} ms</span>
        ) : null}
        {project.repository_url ? (
          <a
            href={project.repository_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 hover:text-foreground hover:decoration-foreground"
          >
            <FolderGit2 className="size-3 self-center" />
            repo
          </a>
        ) : null}
        {project.documentation_url ? (
          <a
            href={project.documentation_url}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line-strong underline-offset-2 hover:text-foreground hover:decoration-foreground"
          >
            docs
          </a>
        ) : null}
        <Link
          href={`/tasks?project=${project.id}`}
          className="ml-auto shrink-0 underline decoration-line-strong underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          tasks
        </Link>
      </div>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="os-label os-label-faint truncate">{label}</dt>
      <dd className={cn('os-mono text-right text-[13px] text-foreground', tone)}>{value}</dd>
    </div>
  )
}

/** Tiny row used where a full card would be too heavy. */
export function ProjectLine({ project }: { project: Project }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <StatusDot state={dotStateFor(project.status)} />
      <Link
        href={`/projects/${project.id}`}
        className="min-w-0 truncate text-[12.5px] text-foreground underline decoration-line-strong underline-offset-2 hover:decoration-foreground"
      >
        {project.name}
      </Link>
      <span className="os-mono shrink-0 text-right text-[11px] text-muted-foreground">
        {Math.round(project.progress ?? 0)}%
      </span>
    </span>
  )
}
