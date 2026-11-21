'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate } from '@/lib/os/hooks'
import { dueTone, enumLabel } from '@/lib/os/format'
import { TASK_BOARD_COLUMNS } from '@/lib/os/enums'
import type { Task } from '@/lib/os/types'
import { StatusDot } from './marks'
import { dotStateFor, dotToneForDue, DueText, PriorityText } from './TaskRow'
import { SkeletonLines } from './states'
import { IconButton } from './ui/button'
import { toastError } from './ui/toast'

const BOARD_SCOPE = ['/tasks', '/projects', '/dashboard', '/meta', '/activity']

/**
 * Kanban board. Dragging a card posts `POST /tasks/{id}/move` with the target
 * column and position — the board is a view over the API, never a local copy.
 * Arrow buttons on each card do the same thing for keyboard users.
 *
 * Columns are hairline boxes with no background; the drag target is the 1px
 * ink top rule (.os-drop-target), cards are canvas + hairline + 2px radius.
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

  const columnClass =
    'flex min-w-0 flex-col rounded-os border border-line transition-shadow'

  if (loading) {
    return (
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {TASK_BOARD_COLUMNS.map((column) => (
          <div key={column} className={columnClass}>
            <div className="border-b border-line px-3 py-2">
              <SkeletonLines rows={1} />
            </div>
            <div className="space-y-2.5 p-3">
              <SkeletonLines rows={3} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="os-scroll-x grid min-w-0 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
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
            columnClass,
            over?.column === status && dragId && 'os-drop-target'
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="os-label">{enumLabel(status)}</span>
            <span className="os-mono text-[11px] text-faint">{items.length}</span>
          </header>

          <ul className="min-w-0 flex-1 space-y-2 p-2">
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
              <li className="os-micro px-1 py-6 text-center">Drop a task here</li>
            ) : null}
          </ul>
        </section>
      ))}

      {columns.other.length ? (
        <p className="os-micro md:col-span-2 xl:col-span-4">
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
  const done = task.status === 'done'
  const tone = done ? 'none' : dueTone(task.due_date)
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
        'group rounded-os border border-line p-2.5 transition-colors hover:border-line-strong',
        dragging && 'os-drag-ghost',
        busy && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <StatusDot
          state={dotStateFor(task.status)}
          tone={dotToneForDue(tone)}
          className="mt-1.5"
        />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left text-[12.5px] leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className={cn('line-clamp-2', done ? 'text-faint' : 'text-foreground')}>
            {task.title}
          </span>
          {showProject && task.project ? (
            <span className="os-label mt-1 block truncate">{task.project.name}</span>
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

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <PriorityText value={task.priority} />
        <DueText value={task.due_date} muted={done} className="ml-auto" />
        {task.tags?.length ? (
          <span className="os-micro truncate">#{task.tags[0]}</span>
        ) : null}
      </div>
    </article>
  )
}
