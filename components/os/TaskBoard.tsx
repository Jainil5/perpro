'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate } from '@/lib/os/hooks'
import { dueLabel, DUE_TONE_TEXT, dueTone, enumLabel } from '@/lib/os/format'
import { TASK_BOARD_COLUMNS } from '@/lib/os/enums'
import type { Task } from '@/lib/os/types'
import { Badge, toneFor, PRIORITY_TONE } from './ui/badge'
import { IconButton } from './ui/button'
import { SkeletonRows } from './ui/skeleton'
import { toastError } from './ui/toast'

const BOARD_SCOPE = ['/tasks', '/projects', '/dashboard', '/meta', '/activity']

/**
 * Kanban board. Dragging a card posts `POST /tasks/{id}/move` with the target
 * column and position — the board is a view over the API, never a local copy.
 * Arrow buttons on each card do the same thing for keyboard users.
 */
export function TaskBoard({
  tasks,
  loading,
  onEdit,
  showProject = false,
}: {
  tasks: Task[]
  loading?: boolean
  onEdit?: (task: Task) => void
  showProject?: boolean
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ column: string; index: number } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const columns = useMemo(() => {
    const buckets: Record<string, Task[]> = {}
    const other: Task[] = []
    for (const status of TASK_BOARD_COLUMNS) buckets[status] = []
    for (const task of tasks) {
      const bucket = buckets[task.status]
      if (bucket) bucket.push(task)
      else other.push(task)
    }
    for (const list of TASK_BOARD_COLUMNS.map((status) => buckets[status]))
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title))
    const statuses = other.map((task) => task.status).filter((value, i, all) => all.indexOf(value) === i)
    return {
      list: TASK_BOARD_COLUMNS.map((status) => ({ status, items: buckets[status] })),
      other,
      statuses,
    }
  }, [tasks])

  async function move(task: Task, status: string, position: number) {
    if (task.status === status && task.position === position) return
    setBusyId(task.id)
    try {
      await api<Task>(`/tasks/${task.id}/move`, { method: 'POST', body: { status, position } })
      invalidate(...BOARD_SCOPE)
    } catch (e) {
      toastError(errorMessage(e, 'Could not move the task'))
    } finally {
      setBusyId(null)
      setDragId(null)
      setOver(null)
    }
  }

  function step(task: Task, direction: -1 | 1) {
    const index = TASK_BOARD_COLUMNS.indexOf(task.status as (typeof TASK_BOARD_COLUMNS)[number])
    const target = TASK_BOARD_COLUMNS[Math.min(TASK_BOARD_COLUMNS.length - 1, Math.max(0, index + direction))]
    if (!target || target === task.status) return
    void move(task, target, task.position)
  }

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TASK_BOARD_COLUMNS.map((column) => (
          <div key={column} className="rounded-xl border border-line bg-card/60 p-3">
            <SkeletonRows rows={3} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="os-scroll-x grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {columns.list.map(({ status, items }, colIndex) => (
        <section
          key={status}
          aria-label={`${status} column`}
          onDragOver={(event) => {
            event.preventDefault()
            setOver({ column: status, index: items.length })
          }}
          onDragLeave={() => setOver((prev) => (prev?.column === status ? null : prev))}
          onDrop={(event) => {
            event.preventDefault()
            const id = event.dataTransfer.getData('text/plain') || dragId
            const task = tasks.find((item) => item.id === id)
            if (task) void move(task, status, over?.column === status ? over.index : items.length)
          }}
          className={cn(
            'flex min-w-0 flex-col rounded-xl border bg-card/60 transition-colors',
            over?.column === status && dragId ? 'border-primary/60 bg-primary/5' : 'border-line'
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="os-eyebrow">{enumLabel(status)}</span>
            <span className="os-num text-[11px] text-faint">{items.length}</span>
          </header>

          <ul className="min-w-0 flex-1 space-y-1.5 p-2">
            {items.map((task, index) => (
              <li
                key={task.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOver({ column: status, index })
                }}
              >
                <BoardCard
                  task={task}
                  dragging={dragId === task.id}
                  busy={busyId === task.id}
                  showProject={showProject}
                  onDragStart={() => setDragId(task.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setOver(null)
                  }}
                  onOpen={() => onEdit?.(task)}
                  onStep={step}
                  canBack={colIndex > 0}
                  canForward={colIndex < columns.list.length - 1}
                />
              </li>
            ))}
            {!items.length ? (
              <li className="px-1 py-6 text-center text-[11px] text-faint">Drop a task here</li>
            ) : null}
          </ul>
        </section>
      ))}

      {columns.other.length ? (
        <p className="text-[11px] text-faint md:col-span-2 xl:col-span-4">
          {columns.other.length} task{columns.other.length === 1 ? '' : 's'} outside the board (
          {columns.statuses.join(', ')}) — edit one to bring it back.
        </p>
      ) : null}
    </div>
  )
}

function BoardCard({
  task,
  dragging,
  busy,
  showProject,
  onDragStart,
  onDragEnd,
  onOpen,
  onStep,
  canBack,
  canForward,
}: {
  task: Task
  dragging: boolean
  busy: boolean
  showProject: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onStep: (task: Task, direction: -1 | 1) => void
  canBack: boolean
  canForward: boolean
}) {
  const tone = dueTone(task.due_date)
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-lg border border-line bg-card p-2.5 shadow-os transition-all hover:border-line-strong',
        dragging && 'os-drag-ghost',
        busy && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left text-[12.5px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="line-clamp-2 text-foreground">{task.title}</span>
          {showProject && task.project ? (
            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
              {task.project.name}
            </span>
          ) : null}
        </button>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label="Move a column back"
            size="icon-sm"
            disabled={!canBack}
            onClick={() => onStep(task, -1)}
          >
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton
            label="Move a column forward"
            size="icon-sm"
            disabled={!canForward}
            onClick={() => onStep(task, 1)}
          >
            <ChevronRight className="size-3.5" />
          </IconButton>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge tone={toneFor(PRIORITY_TONE, task.priority)} size="sm">
          {task.priority}
        </Badge>
        {task.due_date ? (
          <span className={cn('os-num', DUE_TONE_TEXT[tone])}>{dueLabel(task.due_date)}</span>
        ) : null}
        {task.tags?.length ? (
          <span className="truncate text-faint">#{task.tags[0]}</span>
        ) : null}
      </div>
    </article>
  )
}
