'use client'

import Link from 'next/link'
import { Check, Pencil, Repeat } from 'lucide-react'
import { useCallback, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate } from '@/lib/os/hooks'
import { dueLabel, DUE_TONE_TEXT, dueTone, formatDate } from '@/lib/os/format'
import { isOpenStatus } from '@/lib/os/enums'
import type { CompleteResult, Task } from '@/lib/os/types'
import { Badge, PriorityBadge, StatusBadge, TASK_STATUS_TONE } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { IconButton } from './ui/button'
import { toastError, toastSuccess } from './ui/toast'

/** Cache prefixes a task status change touches. */
const AFFECTED = ['/tasks', '/projects', '/dashboard', '/meta', '/activity', '/notifications']

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

/** One line in a task list: tick, title, project, due, priority. */
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
        'group flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50',
        selected && 'bg-accent'
      )}
      data-task-id={task.id}
    >
      {onSelect ? (
        <Checkbox
          checked={!!selected}
          onCheckedChange={(next) => onSelect(task.id, next === true)}
          aria-label={`Select ${task.title}`}
          className="mt-1"
        />
      ) : null}

      <button
        type="button"
        onClick={() => void toggle(task)}
        disabled={busy}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        title={done ? 'Reopen' : 'Complete'}
        className={cn(
          'os-tap-none mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
          done
            ? 'border-success bg-success text-primary-foreground'
            : 'border-line-strong text-transparent hover:border-primary hover:text-primary/50',
          busy && 'opacity-60'
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
            <Repeat className="size-3 shrink-0 text-faint" aria-label={`Repeats ${task.recurrence}`} />
          ) : null}
          {showProject && task.project ? (
            <Link
              href={`/os/projects/${task.project.id}`}
              className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              {task.project.name}
            </Link>
          ) : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {task.due_date ? (
            <span className={cn('os-num', DUE_TONE_TEXT[tone])}>{dueLabel(task.due_date)}</span>
          ) : (
            <span className="text-faint">no due date</span>
          )}
          <StatusBadge value={task.status} table={TASK_STATUS_TONE} />
          <PriorityBadge value={task.priority} />
          {task.tags?.length ? (
            <span className="hidden flex-wrap gap-1 sm:flex">
              {task.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} tone="outline" size="sm">
                  {tag}
                </Badge>
              ))}
              {task.tags.length > 3 ? (
                <Badge tone="outline" size="sm">
                  +{task.tags.length - 3}
                </Badge>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {onEdit ? (
        <IconButton
          label={`Edit ${task.title}`}
          size="icon-sm"
          onClick={() => onEdit(task)}
          className="mt-0.5 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="size-3.5" />
        </IconButton>
      ) : null}
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
  if (!tasks.length) return <p className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
  return (
    <ul className="min-w-0 space-y-px">
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
