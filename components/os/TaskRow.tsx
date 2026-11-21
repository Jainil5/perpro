'use client'

import Link from 'next/link'
import { Check, Pencil, Repeat } from 'lucide-react'
import { useCallback, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate } from '@/lib/os/hooks'
import { dueLabel, DUE_TONE_TEXT, dueTone, enumLabel, formatDate, type DueTone } from '@/lib/os/format'
import { isOpenStatus } from '@/lib/os/enums'
import type { CompleteResult, Task } from '@/lib/os/types'
import { StatusDot, type DotState, type DotTone } from './marks'
import { Checkbox } from './ui/checkbox'
import { IconButton } from './ui/button'
import { toastError, toastSuccess } from './ui/toast'

/** Cache prefixes a task status change touches. */
const AFFECTED = ['/tasks', '/projects', '/dashboard', '/meta', '/activity', '/notifications']

/* ------------------------------------------------- shared row vocabulary ----
   The list-row language of docs/DESIGN.md: the leading glyph is an 8px disc
   (outline = open, half = in progress, filled = done), priority is a mono text
   code, dates are mono and right-aligned. Every list in this folder renders
   status the same way, so TaskBoard and ProjectCard import these from here. */

const DOT_STATE: Record<string, DotState> = {
  todo: 'open',
  open: 'open',
  backlog: 'open',
  blocked: 'open',
  on_hold: 'open',
  planning: 'open',
  review: 'open',
  in_progress: 'in_progress',
  doing: 'in_progress',
  done: 'done',
  completed: 'completed',
  dropped: 'abandoned',
  abandoned: 'abandoned',
  archived: 'archived',
}

/** Status → disc state. Unknown API values render as an outline (open). */
export function dotStateFor(status?: string | null): DotState {
  return DOT_STATE[status ?? ''] ?? 'open'
}

/** Hue only for overdue (critical) and due-today (warning) — DESIGN rule 1. */
export function dotToneForDue(tone: DueTone): DotTone | undefined {
  return tone === 'overdue' ? 'critical' : tone === 'today' ? 'warning' : undefined
}

const PRIORITY_CODE: Record<string, string> = {
  urgent: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4',
}

/** Priority as a mono text code — never a coloured badge. */
export function PriorityText({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn('os-mono shrink-0 text-[11px] leading-none text-muted-foreground', className)}
      title={`Priority: ${enumLabel(value)}`}
    >
      {PRIORITY_CODE[value] ?? enumLabel(value)}
    </span>
  )
}

/** Due date, mono and right-aligned; coloured only when overdue / due today. */
export function DueText({
  value,
  muted,
  className,
}: {
  value?: string | null
  muted?: boolean
  className?: string
}) {
  const tone = dueTone(value)
  return (
    <span
      className={cn(
        'os-mono shrink-0 text-right text-[11px] leading-none',
        muted || tone === 'none' ? 'text-faint' : DUE_TONE_TEXT[tone],
        className
      )}
    >
      {value ? dueLabel(value) : 'No due date'}
    </span>
  )
}

/* ------------------------------------------------------------------ toggle */

/**
 * Completes / reopens a task through the API and reports the recurring
 * rollover the server returns as `{ task, next }`.
 */
export function useTaskToggle() {
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggle = useCallback(
    async (task: Task): Promise<Task | null> => {
      const closing = isOpenStatus(task.status)
      setBusyId(task.id)
      try {
        const res = await api<Task | CompleteResult>(`/tasks/${task.id}/${closing ? 'complete' : 'reopen'}`, {
          method: 'POST',
        })
        invalidate(...AFFECTED)
        const rolled = res && 'task' in res ? (res as CompleteResult) : null
        if (closing) {
          if (rolled?.next) {
            toastSuccess('Completed and rescheduled', {
              description: `${task.title} · next due ${formatDate(rolled.next.due_date)}`,
            })
          } else {
            toastSuccess('Completed', { description: task.title })
          }
        } else {
          toastSuccess('Reopened', { description: task.title })
        }
        return rolled?.task ?? (res as Task)
      } catch (e) {
        toastError(errorMessage(e, 'Could not update the task'))
        return null
      } finally {
        setBusyId(null)
      }
    },
    []
  )

  return { toggle, busyId }
}

/* --------------------------------------------------------------------- row */

/** One line in a task list: status disc, tick, title, then mono meta right. */
export function TaskRow({
  task,
  onEdit,
  showProject = true,
  selected,
  onSelect,
}: {
  task: Task
  onEdit?: (task: Task) => void
  showProject?: boolean
  selected?: boolean
  onSelect?: (id: string, next: boolean) => void
}) {
  const { toggle, busyId } = useTaskToggle()
  const done = task.status === 'done'
  const tone = done ? 'none' : dueTone(task.due_date)
  const busy = busyId === task.id

  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-2.5 border-b border-line-faint border-l-2 px-2 py-1.5 transition-colors',
        selected ? 'border-l-foreground' : 'border-l-transparent',
        busy && 'opacity-60'
      )}
      data-task-id={task.id}
    >
      {onSelect ? (
        <Checkbox
          checked={!!selected}
          onCheckedChange={(next) => onSelect(task.id, next === true)}
          aria-label={`Select ${task.title}`}
        />
      ) : null}

      <StatusDot
        state={dotStateFor(task.status)}
        tone={dotToneForDue(tone)}
        title={enumLabel(task.status)}
      />

      <button
        type="button"
        onClick={() => void toggle(task)}
        disabled={busy}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        title={done ? 'Reopen' : 'Complete'}
        className={cn(
          'os-tap-none grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
          done
            ? 'border-foreground text-foreground'
            : 'border-line-strong text-transparent hover:border-line-strong hover:text-muted-foreground'
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </button>

      <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
        <span
          className={cn(
            'min-w-0 truncate text-[13px]',
            done ? 'text-faint line-through' : 'text-foreground'
          )}
          title={task.title}
        >
          {task.title}
        </span>
        {task.recurrence && task.recurrence !== 'none' ? (
          <Repeat
            className="size-3 shrink-0 text-faint"
            aria-label={`Repeats ${task.recurrence}`}
          />
        ) : null}
        {showProject && task.project ? (
          <Link
            href={`/projects/${task.project.id}`}
            className="shrink-0 truncate text-[11px] text-muted-foreground underline decoration-line-strong underline-offset-2 hover:text-foreground hover:decoration-foreground"
          >
            {task.project.name}
          </Link>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {task.tags?.length ? (
          <span className="os-micro hidden gap-2 lg:flex" aria-label={task.tags.join(', ')}>
            {task.tags.slice(0, 3).map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
            {task.tags.length > 3 ? <span>+{task.tags.length - 3}</span> : null}
          </span>
        ) : null}
        <span className="os-label hidden md:inline">{enumLabel(task.status)}</span>
        <PriorityText value={task.priority} />
        <DueText value={task.due_date} muted={done} className="w-20" />
        {onEdit ? (
          <IconButton
            label={`Edit ${task.title}`}
            size="icon-sm"
            onClick={() => onEdit(task)}
            className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  )
}

/** Renders a list of tasks with a consistent empty line. */
export function TaskList({
  tasks,
  onEdit,
  showProject = true,
  emptyLabel = 'Nothing here',
  selected,
  onSelect,
}: {
  tasks: Task[]
  onEdit?: (task: Task) => void
  showProject?: boolean
  emptyLabel?: string
  selected?: Set<string>
  onSelect?: (id: string, next: boolean) => void
}) {
  if (!tasks.length) return <p className="os-micro px-2 py-3">{emptyLabel}</p>
  return (
    <ul className="min-w-0">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            onEdit={onEdit}
            showProject={showProject}
            selected={selected?.has(task.id)}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  )
}
