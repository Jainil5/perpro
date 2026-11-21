'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays, FolderGit2, Milestone as MilestoneIcon } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { daysUntil, dueLabel, DUE_TONE_TEXT, dueTone, formatDate } from '@/lib/os/format'
import type { Project } from '@/lib/os/types'
import { Badge, PriorityBadge, PROJECT_STATUS_TONE, StatusBadge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'

/** Project card used by /os/projects and the dashboard grid. */
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
  const overdue = counts.overdue > 0
  const pastTarget = left != null && left < 0 && project.status !== 'completed' && project.status !== 'archived'

  return (
    <Card className={cn('flex min-w-0 flex-col gap-3 p-4', className)}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/os/projects/${project.id}`}
            className="block truncate font-os-display text-[13.5px] font-semibold tracking-tight hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {project.name}
          </Link>
          {project.category ? (
            <p className="mt-0.5 truncate text-[11px] text-faint">{project.category}</p>
          ) : null}
        </div>
        {onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(project)}
            className="os-tap-none shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-accent hover:text-foreground"
          >
            Edit
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge value={project.status} table={PROJECT_STATUS_TONE} />
        <PriorityBadge value={project.priority} />
        {project.description ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {project.description}
          </span>
        ) : null}
      </div>

      <Progress
        value={project.progress}
        showValue
        size="sm"
        label={`${project.name} progress`}
        tone={pastTarget ? 'bg-warning' : undefined}
      />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <Stat label="Open" value={counts.open} />
        <Stat label="Done" value={counts.done} />
        <Stat label="Overdue" value={counts.overdue} tone={overdue ? 'text-destructive' : undefined} />
        <Stat
          label="Milestones"
          value={`${project.milestones_done ?? 0}/${project.milestone_count ?? 0}`}
        />
      </dl>

      <div className="min-w-0 rounded-lg border border-line bg-muted/40 px-2.5 py-2">
        <p className="os-eyebrow">Next action</p>
        {project.next_action ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-foreground">{project.next_action}</p>
        ) : (
          <p className="mt-0.5 text-[12px] text-faint">
            Not set —{' '}
            <button
              type="button"
              onClick={() => onEdit?.(project)}
              className="text-primary underline-offset-2 hover:underline"
            >
              add one
            </button>
          </p>
        )}
        {project.next_due?.title ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ArrowRight className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{project.next_due.title}</span>
            {project.next_due.due_date ? (
              <span className={cn('os-num shrink-0', DUE_TONE_TEXT[dueTone(project.next_due.due_date)])}>
                {dueLabel(project.next_due.due_date)}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {project.target_date ? (
          <span
            className={cn(
              'flex items-center gap-1',
              pastTarget && 'text-warning',
              left != null && left >= 0 && left <= 7 && 'text-warning'
            )}
          >
            <CalendarDays className="size-3" />
            <span className="os-num">{formatDate(project.target_date)}</span>
            <span>
              {left == null
                ? ''
                : left < 0
                  ? ` · ${Math.abs(left)}d late`
                  : left === 0
                    ? ' · today'
                    : ` · ${left}d left`}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-faint">
            <CalendarDays className="size-3" />
            no target date
          </span>
        )}
        {project.milestone_count ? (
          <span className="flex items-center gap-1">
            <MilestoneIcon className="size-3" />
            <span className="os-num">{project.milestone_count}</span>
          </span>
        ) : null}
        {project.repository_url ? (
          <a
            href={project.repository_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 underline-offset-2 hover:text-primary hover:underline"
          >
            <FolderGit2 className="size-3" />
            repo
          </a>
        ) : null}
        {project.documentation_url ? (
          <a
            href={project.documentation_url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-primary hover:underline"
          >
            docs
          </a>
        ) : null}
        <Link
          href={`/os/tasks?project=${project.id}`}
          className="ml-auto shrink-0 text-faint underline-offset-2 hover:text-primary hover:underline"
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
      <dt className="truncate text-faint">{label}</dt>
      <dd className={cn('os-num text-[13px] text-foreground', tone)}>{value}</dd>
    </div>
  )
}

/** Tiny badge row used where a full card would be too heavy. */
export function ProjectLine({ project }: { project: Project }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={`/os/projects/${project.id}`}
        className="truncate text-[12.5px] underline-offset-2 hover:text-primary hover:underline"
      >
        {project.name}
      </Link>
      <Badge tone="outline" size="sm">
        {project.progress}%
      </Badge>
    </span>
  )
}
