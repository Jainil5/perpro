'use client'

/**
 * Phase 2 · the two things Career and CRM share: a pipeline board over a server-owned state
 * machine, and the per-currency figure the money rules force on anything that adds up value.
 *
 * The board is a view over the API, never a local copy: dropping a card POSTs the transition and
 * the lists re-read. An illegal jump comes back 409 and the card goes exactly where it was.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { formatMoney } from '@/lib/os/currency'
import { enumLabel } from '@/lib/os/format'
import { HairlineBar, StatusDot, type DotState, type DotTone } from './marks'
import { IconButton } from './ui/button'
import { SkeletonLines } from './states'

export interface PipelineColumn {
  status: string
  /** Card height is content-driven; a column with nothing in it still takes its slot. */
  hint?: string
}

/**
 * `columns` is the state machine's open half, in order; `rows` are the live records. A row whose
 * status has no column (a closed record in a board view) is reported, not hidden — silently
 * dropping rows from a funnel is how a pipeline starts lying.
 *
 * `canMove` is the same question the server answers with 200 or 409, asked locally: a jump the
 * state machine does not allow is never offered, so the board cannot present a move that will fail.
 * The server still decides — the answer only changes which affordances are drawn.
 */
export function PipelineBoard<T>({
  columns,
  rows,
  idOf,
  statusOf,
  onMove,
  onOpen,
  card,
  canMove,
  loading,
  busyId,
}: {
  columns: readonly PipelineColumn[]
  rows: T[]
  idOf: (row: T) => string
  statusOf: (row: T) => string
  /** The transition call. Returning a rejected promise leaves the board where it was. */
  onMove: (row: T, status: string) => void | Promise<void>
  onOpen?: (row: T) => void
  card: (row: T) => ReactNode
  canMove?: (row: T, status: string) => boolean
  loading?: boolean
  busyId?: string | null
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)

  /** Legal for *this* row, and not a no-op drop into the column it already sits in. */
  const legal = (row: T, status: string) =>
    status !== statusOf(row) && (canMove ? canMove(row, status) : true)

  const buckets = useMemo(() => {
    const map: Record<string, T[]> = {}
    for (const column of columns) map[column.status] = []
    const uncolumned: T[] = []
    for (const row of rows) {
      const bucket = map[statusOf(row)]
      if (bucket) bucket.push(row)
      else uncolumned.push(row)
    }
    const others: string[] = []
    for (const row of uncolumned) {
      const status = enumLabel(statusOf(row))
      if (!others.includes(status)) others.push(status)
    }
    return { map, uncolumned, others }
  }, [columns, rows, statusOf])

  const columnClass = 'flex min-w-0 flex-col rounded-os border border-line'

  /** The card currently being dragged, if any — legality decides which column lights up. */
  const dragRow = dragId ? rows.find((item) => idOf(item) === dragId) ?? null : null

  if (loading) {
    return (
      <div
        className="grid min-w-0 gap-2.5"
        style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => (
          <div key={column.status} className={columnClass}>
            <div className="border-b border-line px-3 py-2">
              <SkeletonLines rows={1} />
            </div>
            <div className="space-y-2.5 p-2">
              <SkeletonLines rows={3} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      <div
        className="os-scroll-x grid min-w-0 gap-2.5"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(11rem, 1fr))` }}
      >
        {columns.map((column, index) => {
          const items = buckets.map[column.status] ?? []
          return (
            <section
              key={column.status}
              aria-label={`${enumLabel(column.status)} column`}
              onDragOver={(event) => {
                event.preventDefault()
                setOverColumn(column.status)
              }}
              onDragLeave={() => setOverColumn((prev) => (prev === column.status ? null : prev))}
              onDrop={(event) => {
                event.preventDefault()
                const id = event.dataTransfer.getData('text/plain') || dragId
                const row = rows.find((item) => idOf(item) === id)
                setOverColumn(null)
                setDragId(null)
                if (row && legal(row, column.status)) void onMove(row, column.status)
              }}
              className={cn(
                columnClass,
                dragRow && overColumn === column.status && legal(dragRow, column.status) && 'os-drop-target'
              )}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
                <span className="os-label">{enumLabel(column.status)}</span>
                <span className="os-mono text-[11px] text-faint">{items.length}</span>
              </header>
              <ul className="min-w-0 flex-1 space-y-2 p-2">
                {items.map((row) => {
                  const back = columns[index - 1]
                  const forward = columns[index + 1]
                  return (
                    <li key={idOf(row)}>
                      <PipelineCard
                        rowId={idOf(row)}
                        draggable={columns.some((other) => legal(row, other.status))}
                        onDragStart={() => setDragId(idOf(row))}
                        onDragEnd={() => {
                          setDragId(null)
                          setOverColumn(null)
                        }}
                        busy={busyId === idOf(row)}
                        onOpen={onOpen ? () => onOpen(row) : undefined}
                        onStep={(direction) => {
                          const target = direction < 0 ? back : forward
                          if (target) void onMove(row, target.status)
                        }}
                        canBack={Boolean(back) && legal(row, back?.status ?? '')}
                        canForward={Boolean(forward) && legal(row, forward?.status ?? '')}
                      >
                        {card(row)}
                      </PipelineCard>
                    </li>
                  )
                })}
                {!items.length ? (
                  <li className="os-micro px-1 py-6 text-center">
                    {column.hint ?? 'Nothing here yet'}
                  </li>
                ) : null}
              </ul>
            </section>
          )
        })}
      </div>
      {buckets.uncolumned.length ? (
        <p className="os-micro">
          {buckets.uncolumned.length}
          {buckets.uncolumned.length === 1 ? ' record is' : ' records are'} outside the board (
          {buckets.others.join(', ')}) — they stay in the table view, where a closed state is a row
          and not a column.
        </p>
      ) : null}
    </div>
  )
}

function PipelineCard({
  children,
  rowId,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
  onStep,
  canBack,
  canForward,
  busy,
}: {
  children: ReactNode
  rowId: string
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen?: () => void
  onStep: (direction: -1 | 1) => void
  canBack: boolean
  canForward: boolean
  busy?: boolean
}) {
  return (
    <article
      data-id={rowId}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return
        event.dataTransfer.setData('text/plain', rowId)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-os border border-line p-2.5 transition-colors hover:border-line-strong',
        busy && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
            >
              {children}
            </button>
          ) : (
            children
          )}
        </div>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label="Move a stage back"
            size="icon-sm"
            disabled={!canBack}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton
            label="Move a stage forward"
            size="icon-sm"
            disabled={!canForward}
            onClick={() => onStep(1)}
          >
            <ChevronRight className="size-3.5" />
          </IconButton>
        </span>
      </div>
    </article>
  )
}

/**
 * The funnel as one hairline rail: counts per stage, the widest bar being the stage with the most
 * records. Numbers come from the server, so the rail is a rendering of `funnel[]`, never a tally
 * of the rows currently on screen.
 */
export function FunnelRail({
  steps,
  emptyLabel = 'No records yet.',
}: {
  steps: Array<{ status: string; count: number }>
  emptyLabel?: string
}) {
  const total = steps.reduce((sum, step) => sum + (step.count || 0), 0)
  const widest = Math.max(1, ...steps.map((step) => step.count || 0))
  if (!total) return <p className="os-micro">{emptyLabel}</p>
  return (
    <ul className="min-w-0 space-y-2">
      {steps.map((step) => (
        <li key={step.status} className="flex items-center gap-3">
          <span className="os-label w-28 shrink-0 truncate">{enumLabel(step.status)}</span>
          <HairlineBar
            value={(100 * (step.count || 0)) / widest}
            label={enumLabel(step.status)}
            title={`${step.count} at ${enumLabel(step.status)}`}
            className="min-w-0 flex-1"
          />
          <span className="os-mono w-8 shrink-0 text-right text-[11px] tabular-nums text-faint">
            {step.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Health is a state, not a category, so it may carry hue (DESIGN §4). */
export function HealthDisc({
  health,
  className,
}: {
  health: string | null | undefined
  className?: string
}) {
  const tone: DotTone | undefined =
    health === 'red' ? 'critical' : health === 'amber' ? 'warning' : health === 'green' ? 'success' : undefined
  const state: DotState =
    health === 'green' ? 'done' : health === 'unknown' || !health ? 'open' : 'in_progress'
  return (
    <StatusDot
      state={state}
      tone={tone}
      title={health ? `Health: ${enumLabel(health)}` : 'Health not set'}
      className={className}
    />
  )
}

/**
 * A per-currency figure, printed the way the rules require: each code on its own line, and an em
 * dash when the API could not name one. There is no branch here that adds two codes together.
 */
export function TallyFigures({
  entries,
  compact = true,
  emptyLabel = 'Nothing to total yet.',
}: {
  entries: Array<{ currency: string; amount: number | null }> | null | undefined
  compact?: boolean
  emptyLabel?: string
}) {
  const rows = (entries ?? []).filter((entry) => entry.amount !== null && entry.amount !== 0)
  if (!rows.length) return <p className="os-micro">{emptyLabel}</p>
  return (
    <ul className="min-w-0 space-y-1">
      {rows.map((entry) => (
        <li key={entry.currency} className="flex items-baseline justify-between gap-3">
          <span className="os-label shrink-0">{entry.currency}</span>
          <span className="os-mono truncate text-right text-[13px] tabular-nums text-foreground">
            {formatMoney(entry.amount, entry.currency, { compact })}
          </span>
        </li>
      ))}
    </ul>
  )
}
