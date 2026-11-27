'use client'

/**
 * Shared Finance furniture: the money-specific atoms every money screen needs, built once
 * here so `/finance`, expenses, income, subscriptions, scenarios and the converter all read
 * as one module (docs/DESIGN.md, docs/MYOS/PHASE3_FINANCE.md §1).
 *
 * Two rules hold throughout:
 *  - figures are formatted, never computed — `lib/os/currency.ts` is display-only and the
 *    server did the maths;
 *  - colour is a *state*, not a category. A category may carry a dot colour because the user
 *    chose it (`expense_categories.color`); income/cost, negative/positive and stale/fresh
 *    are the only other signals.
 */

import { useMemo, type ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Minus,
} from 'lucide-react'

import { cn } from '@/lib/os/cn'
import {
  formatMoney,
  formatRate,
  minorUnits,
  moneyInputError,
  monthLabel,
  monthShort,
  shareOf,
  type MoneyDelta,
} from '@/lib/os/currency'
import { INTERVAL_LABELS, FINANCE_PATHS, statusTone } from '@/lib/os/finance'
import type {
  CurrencyInfo,
  ExpenseCategory,
  IncomeProfile,
  Service,
} from '@/lib/os/finance'
import { useResource } from '@/lib/os/hooks'
import type { ListResponse } from '@/lib/os/types'
import { enumLabel, formatDate } from '@/lib/os/format'
import { Input } from '@/components/os/ui/input'
import { Field } from '@/components/os/ui/label'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { HairlineBar } from '@/components/os/marks'

/* ------------------------------------------------------------------ figures -- */

/** A money cell in a table or list: mono, tabular, right-aligned, dash when unknown. */
export function MoneyCell({
  value,
  currency,
  className,
  sign = 'auto',
  compact = false,
  tone,
  title,
}: {
  value: number | null | undefined
  currency: string | null | undefined
  className?: string
  sign?: 'auto' | 'always' | 'never'
  compact?: boolean
  tone?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'os-mono whitespace-nowrap text-right tabular-nums text-[12.5px]',
        tone ?? 'text-foreground',
        value === null || value === undefined ? 'text-faint' : null,
        className
      )}
    >
      {formatMoney(value, currency ?? undefined, { sign, compact })}
    </span>
  )
}

/** The one big number on a screen: label above, figure in the display voice, delta below. */
export function MoneyHero({
  label,
  value,
  currency,
  delta,
  goodWhen = 'up',
  hint,
  className,
}: {
  label: string
  value: number | null | undefined
  /** `null` when the server could not name one currency for these figures (§2.3). */
  currency: string | null | undefined
  delta?: MoneyDelta
  goodWhen?: 'up' | 'down'
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="os-label">{label}</p>
      <p className="os-mono mt-1.5 text-[clamp(1.75rem,3.4vw,2.6rem)] leading-none font-medium tracking-[-0.03em] text-foreground tabular-nums">
        {formatMoney(value, currency, { compact: true })}
      </p>
      <div className="os-micro mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta ? <DeltaTag delta={delta} goodWhen={goodWhen} /> : null}
        {hint}
      </div>
    </div>
  )
}

const DELTA_GLYPH = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus, unknown: Minus } as const

/**
 * Movement against the previous period. Whether an increase is *good* depends on the metric,
 * so the caller says: rising costs are not a win, and the tone follows `goodWhen`.
 */
export function DeltaTag({
  delta,
  goodWhen = 'up',
  currency,
}: {
  delta: MoneyDelta
  goodWhen?: 'up' | 'down'
  currency?: string | null
}) {
  if (delta.direction === 'unknown') {
    return <span className="text-faint">no prior period</span>
  }
  const Glyph = DELTA_GLYPH[delta.direction]
  const favourable =
    delta.direction === 'flat' ? null : (delta.direction === 'up') === (goodWhen === 'up')
  return (
    <span
      className={cn(
        'os-mono inline-flex items-center gap-1 tabular-nums',
        favourable === null ? 'text-muted-foreground' : favourable ? 'text-success' : 'text-danger'
      )}
      title={
        delta.direction === 'flat'
          ? 'unchanged from the previous period'
          : `change from the previous period`
      }
    >
      <Glyph className="size-3" aria-hidden="true" />
      {delta.pct === null
        ? currency
          ? formatMoney(delta.abs, currency, { sign: 'always' })
          : 'new'
        : `${delta.pct > 0 ? '+' : '−'}${Math.abs(delta.pct).toFixed(1)}%`}
    </span>
  )
}

/** Tiny 48×14 trend line for a number column; hairline only, no fill. */
export function Sparkline({
  values,
  className,
  label,
}: {
  values: number[]
  className?: string
  label?: string
}) {
  const path = useMemo(() => {
    if (values.length < 2) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 48
        const y = 13 - ((value - min) / span) * 12
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [values])

  if (!path) return null
  return (
    <svg
      viewBox="0 0 48 14"
      role="img"
      aria-label={label ?? 'trend'}
      preserveAspectRatio="none"
      className={cn('h-3.5 w-12 shrink-0', className)}
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Twelve months of in and out, mirrored on a shared baseline: income above the line in ink,
 * spend below it. The scale is stated once and every column is titled with its real figures,
 * so the bar is an aid and never the only place the number exists.
 */
export function InOutBars({
  series,
  currency,
  height = 72,
  className,
}: {
  series: Array<{
    month: string
    income: number | null
    expense: number | null
    net?: number | null
  }>
  currency: string | null | undefined
  height?: number
  className?: string
}) {
  // A figure the server could not name draws as no bar, not as a zero — see §2.3.
  const size = (value: number | null) => (value === null ? 0 : Math.abs(value))
  const scale = Math.max(1, ...series.flatMap((p) => [size(p.income), size(p.expense)]))
  const half = height / 2
  return (
    <div className={cn('min-w-0', className)}>
      <div className="os-micro flex items-baseline justify-between">
        <span>in / out · {series.length} months</span>
        <span className="os-mono">{formatMoney(scale, currency, { compact: true })}</span>
      </div>
      <div
        className="mt-2 flex items-stretch gap-1 border-b border-line pb-px"
        role="img"
        aria-label={`Monthly income and spend for the last ${series.length} months, up to ${formatMoney(
          scale,
          currency
        )} in one month`}
      >
        {series.map((point) => {
          const up = (size(point.income) / scale) * half
          const down = (size(point.expense) / scale) * half
          return (
            <div key={point.month} className="flex min-w-0 flex-1 flex-col items-stretch justify-center">
              <div className="flex h-[50%] items-end">
                <span
                  className="w-full bg-foreground/80 transition-[height] duration-150"
                  style={{ height: `${Math.max(size(point.income) > 0 ? 2 : 0, up).toFixed(1)}px` }}
                  title={`${monthLabel(point.month)} in ${formatMoney(point.income, currency)}`}
                />
              </div>
              <div className="flex h-[50%] items-start">
                <span
                  className="w-full bg-line-strong transition-[height] duration-150"
                  style={{ height: `${Math.max(size(point.expense) > 0 ? 2 : 0, down).toFixed(1)}px` }}
                  title={`${monthLabel(point.month)} out ${formatMoney(point.expense, currency)}`}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="os-micro mt-1 flex justify-between">
        {series.map((point, index) => (
          <span key={point.month} className={cn('min-w-0 flex-1 truncate', index % 3 ? 'opacity-0' : null)}>
            {monthShort(point.month)}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * One figure per month as a hairline bar row: the shape every money breakdown uses
 * (12-month spend, 12-month income, a scenario's cost). The longest month sets the scale and
 * every row still states its own number, so the bar never carries information alone.
 */
export function MonthBars({
  series,
  currency,
  caption,
  className,
}: {
  series: Array<{
    month: string
    amount?: number | null
    total?: number | null
    received?: number | null
  }>
  currency: string | null | undefined
  caption?: string
  className?: string
}) {
  const rows = series.map((point) => ({
    month: point.month,
    // A figure the server could not name stays unnamed: no bar, and an em dash, not a zero.
    value: point.amount ?? point.total ?? point.received ?? null,
  }))
  if (rows.length === 0) return <p className="os-micro">No months to draw yet.</p>
  const max = Math.max(...rows.map((row) => Math.abs(row.value ?? 0)), 0)
  return (
    <ul className={cn('min-w-0 space-y-1', className)}>
      {caption ? <li className="os-micro mb-1 text-faint">{caption}</li> : null}
      {rows.map((row) => (
        <li key={row.month} className="flex items-center gap-2">
          <span className="os-micro w-10 shrink-0 tabular-nums">{monthShort(row.month)}</span>
          <span className="h-[3px] min-w-0 flex-1 bg-line-faint" aria-hidden="true">
            <span
              className="block h-full bg-foreground/75"
              style={{ width: `${max ? (Math.abs(row.value ?? 0) / max) * 100 : 0}%` }}
            />
          </span>
          <span
            className="os-mono w-24 shrink-0 text-right text-[12px] tabular-nums text-foreground"
            title={`${monthLabel(row.month)} · ${formatMoney(row.value, currency)}`}
          >
            {formatMoney(row.value, currency, { compact: true })}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cumulative net across a scenario's horizon. The line is ink; the part of it below zero is
 * drawn in danger because "in debt" is a state, not a category; the break-even month gets a
 * labelled hairline so the crossing is readable without a tooltip.
 */
export function CumulativeCurve({
  months,
  currency,
  breakEvenMonth,
  height = 120,
  className,
}: {
  months: Array<{ month: string; cumulative: number | null }>
  currency: string | null | undefined
  breakEvenMonth?: string | null
  height?: number
  className?: string
}) {
  const model = useMemo(() => {
    // A month the server could not name is not a point on the line, and it is not a zero either.
    const named = months.flatMap((row, index) =>
      typeof row.cumulative === 'number' && Number.isFinite(row.cumulative)
        ? [{ month: row.month, cumulative: row.cumulative, index }]
        : []
    )
    if (named.length === 0) return null
    const values = named.map((m) => m.cumulative)
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    const span = max - min || 1
    const y = (value: number) => 100 - ((value - min) / span) * 100
    const zero = y(0)
    const last = months.length - 1
    const points = named.map((row) => {
      const x = last === 0 ? 50 : (row.index / last) * 100
      return { x, y: y(row.cumulative), value: row.cumulative, month: row.month }
    })
    /**
     * One polyline per side of zero. Where the curve crosses the axis the two polylines share
     * an interpolated point, so ink hands over to danger exactly on the line rather than a
     * segment early.
     */
    const crossing = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: a.y === b.y ? b.x : a.x + ((b.x - a.x) * (zero - a.y)) / (b.y - a.y),
      y: zero,
    })
    const runs: Array<{ positive: boolean; nodes: Array<{ x: number; y: number }> }> = []
    points.forEach((point, index) => {
      const positive = point.value >= 0
      const run = runs[runs.length - 1]
      if (run && run.positive === positive) {
        run.nodes.push(point)
        return
      }
      const next: { positive: boolean; nodes: Array<{ x: number; y: number }> } = { positive, nodes: [] }
      if (run) {
        const joint = crossing(points[index - 1], point)
        run.nodes.push(joint)
        next.nodes.push(joint)
      }
      next.nodes.push(point)
      runs.push(next)
    })
    return { runs, zero, points, min, max }
  }, [months])

  if (!model) {
    return (
      <p className="os-micro">
        {months.length === 0
          ? 'Add at least one item to see the curve.'
          : 'No month of this plan can be named in one currency, so there is nothing to plot — give the items a currency or ask for a target.'}
      </p>
    )
  }

  const line = (nodes: Array<{ x: number; y: number }>) =>
    nodes.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const breakPoint = breakEvenMonth
    ? model.points.find((point) => point.month === breakEvenMonth) ?? null
    : null
  const first = model.points[0]
  const final = model.points[model.points.length - 1]

  return (
    <div className={cn('min-w-0', className)}>
      <div className="os-micro flex items-baseline justify-between">
        <span>cumulative net · {months.length} months</span>
        <span className="os-mono">
          {formatMoney(model.max, currency, { compact: true })} / {formatMoney(model.min, currency, { compact: true })}
        </span>
      </div>
      <div className="relative mt-2" style={{ height }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Cumulative net from ${monthLabel(first.month)} to ${monthLabel(final.month)}, ending at ${formatMoney(
            final.value,
            currency
          )}${
            breakEvenMonth ? `, breaking even in ${monthLabel(breakEvenMonth)}` : ', never breaking even'
          }`}
        >
          <line
            x1="0"
            x2="100"
            y1={model.zero}
            y2={model.zero}
            stroke="hsl(var(--os-line))"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {model.runs.map((run, index) =>
            run.nodes.length < 2 ? (
              <circle
                key={`dot-${index}`}
                cx={run.nodes[0].x}
                cy={run.nodes[0].y}
                r="1.5"
                fill={run.positive ? 'hsl(var(--os-foreground))' : 'hsl(var(--os-danger))'}
              />
            ) : (
              <polyline
                key={`line-${index}`}
                points={line(run.nodes)}
                fill="none"
                stroke={run.positive ? 'hsl(var(--os-foreground))' : 'hsl(var(--os-danger))'}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            )
          )}
          {breakPoint ? (
            <>
              <line
                x1={breakPoint.x}
                x2={breakPoint.x}
                y1="0"
                y2="100"
                stroke="hsl(var(--os-line-strong))"
                strokeWidth="1"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={breakPoint.x}
                cy={breakPoint.y}
                r="2"
                fill="hsl(var(--os-foreground))"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        {breakPoint ? (
          <span
            className="os-micro absolute top-0 -translate-x-1/2 whitespace-nowrap text-muted-foreground"
            style={{ left: `${breakPoint.x}%` }}
          >
            break-even {monthShort(breakEvenMonth ?? '')}
          </span>
        ) : null}
      </div>
      <div className="os-micro mt-1 flex justify-between">
        <span>{monthShort(months[0].month)}</span>
        <span>{monthShort(months[months.length - 1].month)}</span>
      </div>
      {/* The same facts as text, for anyone who cannot use the shape. */}
      <ul className="sr-only">
        {months.map((m) => (
          <li key={m.month}>
            {monthLabel(m.month)}: {formatMoney(m.cumulative, currency)} cumulative
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------- labels -- */

/** The colour the user gave a category, as an 8px disc. Not used for maths anywhere. */
export function CategoryDot({
  color,
  label,
  className,
}: {
  color?: string | null
  label?: string | null
  className?: string
}) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full border border-line', className)}
      style={color ? { backgroundColor: color, borderColor: color } : undefined}
      aria-hidden="true"
      title={label ?? undefined}
    />
  )
}

/** `INCOME` / `COST` with the sign the column already implies. */
export function DirectionTag({ direction }: { direction: 'income' | 'cost' }) {
  return (
    <span
      className={cn(
        'os-label inline-flex items-center gap-1',
        direction === 'income' ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {direction === 'income' ? '+' : '−'}
      {enumLabel(direction)}
    </span>
  )
}

/** A status in the module's voice: mono label, tone only where the status is a state. */
export function StatusLabel({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="os-label text-faint">unset</span>
  return <span className={cn('os-label', statusTone(status as never))}>{enumLabel(status)}</span>
}

/** `monthly` → `₹/mo`-style suffix for a price column. */
export function IntervalSuffix({ interval }: { interval?: string | null }) {
  const label = interval ? INTERVAL_LABELS[interval as keyof typeof INTERVAL_LABELS] : ''
  if (!label) return null
  return <span className="os-micro ml-1 whitespace-nowrap">{label}</span>
}

/* --------------------------------------------------------------- interaction -- */

/** ‹ Nov 2026 › month stepper with a jump back to now. Keyboard: ← / →. */
export function PeriodNav({
  month,
  onChange,
  thisMonth,
  label = 'Period',
  className,
}: {
  month: string
  onChange: (next: string) => void
  thisMonth?: string
  label?: string
  className?: string
}) {
  const step = (delta: number) => {
    const [year, numeric] = month.split('-').map(Number)
    const total = year * 12 + (numeric - 1) + delta
    onChange(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`)
  }
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <p className="os-label mr-2">{label}</p>
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label={`Previous month`}
        className="os-tap-none flex size-8 items-center justify-center rounded-os border border-line text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="os-mono min-w-[92px] text-center text-[12.5px] tabular-nums text-foreground">
        {monthLabel(month)}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Next month"
        className="os-tap-none flex size-8 items-center justify-center rounded-os border border-line text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </button>
      {thisMonth && thisMonth !== month ? (
        <button
          type="button"
          onClick={() => onChange(thisMonth)}
          className="os-tap-none min-h-8 rounded-os px-2 text-[11px] text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
        >
          this month
        </button>
      ) : null}
    </div>
  )
}

/** Sticky, sortable column header for the money tables. */
export function SortHeader({
  children,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  children: ReactNode
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'os-tap-none flex w-full items-center gap-1 transition-colors duration-150',
        align === 'right' ? 'justify-end' : 'justify-start',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <span className="os-label">{children}</span>
      {active ? (
        <span className="os-mono text-[10px]" aria-hidden="true">
          {dir === 'asc' ? '↑' : '↓'}
        </span>
      ) : null}
    </button>
  )
}

/**
 * A share-of-total row: dot, name, hairline bar, figure, percent. Used by the overview and
 * the expense summary so a breakdown reads identically in both places.
 */
export function ShareList({
  rows,
  currency,
  total,
  emptyLabel = 'Nothing recorded in this period.',
  onSelect,
}: {
  rows: Array<{ id: string | null; label: string; color?: string | null; value: number | null }>
  currency: string | null | undefined
  /** The server's own total. Without it the percentages are shares of the listed rows. */
  total?: number | null
  emptyLabel?: string
  onSelect?: (id: string | null) => void
}) {
  if (rows.length === 0) return <p className="os-micro">{emptyLabel}</p>
  const whole = total ?? rows.reduce((sum, row) => sum + (row.value ?? 0), 0)
  return (
    <ul className="min-w-0 space-y-2">
      {rows.map((row) => {
        const pct = shareOf(row.value, whole)
        const body = (
          <div className="min-w-0 px-1 py-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <CategoryDot color={row.color} label={row.label} />
                <span className="min-w-0 truncate text-[12.5px] text-foreground">{row.label}</span>
              </span>
              <span className="os-mono shrink-0 text-[12.5px] tabular-nums text-foreground">
                {formatMoney(row.value, currency)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <HairlineBar value={pct ?? 0} className="flex-1" label={row.label} />
              <span className="os-micro w-10 shrink-0 text-right tabular-nums">
                {pct === null ? '—' : `${Math.round(pct)}%`}
              </span>
            </div>
          </div>
        )
        return (
          <li key={`${row.id ?? 'none'}-${row.label}`} className="min-w-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className="os-tap-none -mx-1 block w-full rounded-os text-left transition-colors duration-150 hover:bg-canvas-deep focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* --------------------------------------------------------------------- forms -- */

/**
 * Money input with the currency stated in the field and a reason why it is not valid yet.
 * Grouping commas are accepted on the way in and stripped, because people paste them.
 */
export function AmountField({
  label = 'Amount',
  value,
  onChange,
  currency,
  required,
  min,
  max,
  hint,
  id,
  className,
  disabled,
}: {
  label?: string
  value: string
  onChange: (next: string) => void
  currency: string | null | undefined
  required?: boolean
  min?: number
  max?: number
  hint?: ReactNode
  id?: string
  className?: string
  disabled?: boolean
}) {
  const error = moneyInputError(value, { required, min, max })
  const step = currency ? formatMoney(minorUnits(currency) === 0 ? 1 : 0.01, currency) : null
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={value ? error : null}
      hint={
        hint ??
        (step ? (
          <span className="os-mono">{`${currency} · smallest step ${step}`}</span>
        ) : (
          'choose a currency first'
        ))
      }
      className={className}
    >
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(value && error) || undefined}
        placeholder={minorUnits(currency) === 0 ? '0' : '0.00'}
        className="os-mono tabular-nums"
      />
    </Field>
  )
}

const NONE = '__none'

export function CurrencySelect({
  value,
  onChange,
  label = 'Currency',
  hint,
  className,
  id,
  required,
  error,
}: {
  value: string | null | undefined
  onChange: (next: string) => void
  label?: string
  hint?: ReactNode
  className?: string
  id?: string
  required?: boolean
  error?: string | null
}) {
  const currencies = useResource<ListResponse<CurrencyInfo>>(FINANCE_PATHS.currencies)
  const items = currencies.data?.items ?? (value ? [{ code: value, symbol: '', name: value, minor_units: 2, decimal: '.', group: ',' }] : [])
  return (
    <Field label={label} htmlFor={id} hint={hint} required={required} error={error ?? null} className={className}>
      <Select
        value={value || NONE}
        onValueChange={(next) => onChange(next === NONE ? '' : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={currencies.loading ? 'Loading currencies…' : 'Choose a currency'} />
        </SelectTrigger>
        <SelectContent>
          <Option value={NONE}>No currency</Option>
          {items.map((item) => (
            <Option key={item.code} value={item.code}>
              {item.code} {item.symbol ? `${item.symbol} ` : ''}
              {item.name ? `· ${item.name}` : ''}
            </Option>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function CategorySelect({
  value,
  onChange,
  label = 'Category',
  hint,
  className,
  required,
  error,
}: {
  value: string | null | undefined
  onChange: (next: string | null) => void
  label?: string
  hint?: ReactNode
  className?: string
  required?: boolean
  error?: string | null
}) {
  const categories = useResource<ListResponse<ExpenseCategory>>(FINANCE_PATHS.categories)
  const flat = useMemo(() => flattenCategories(categories.data?.items ?? []), [categories.data])
  return (
    <Field label={label} hint={hint} required={required} error={error ?? null} className={className}>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
        <SelectTrigger>
          <SelectValue placeholder={categories.loading ? 'Loading…' : 'Uncategorised'} />
        </SelectTrigger>
        <SelectContent>
          <Option value={NONE}>Uncategorised</Option>
          {flat.map((row) => (
            <Option key={row.id} value={row.id}>
              {'\u00A0'.repeat(row.depth * 2)}
              {row.name}
            </Option>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** Depth-first list of the category tree, each row remembering how deep it sits. */
export function flattenCategories(
  nodes: ExpenseCategory[],
  depth = 0
): Array<ExpenseCategory & { depth: number }> {
  const out: Array<ExpenseCategory & { depth: number }> = []
  for (const node of nodes) {
    out.push({ ...node, depth })
    if (node.children?.length) out.push(...flattenCategories(node.children, depth + 1))
  }
  return out
}

export function ServiceSelect({
  value,
  onChange,
  label = 'Service',
  hint,
  className,
  required,
  error,
}: {
  value: string | null | undefined
  onChange: (next: string | null) => void
  label?: string
  hint?: ReactNode
  className?: string
  required?: boolean
  error?: string | null
}) {
  const services = useResource<ListResponse<Service>>(FINANCE_PATHS.services)
  return (
    <Field label={label} hint={hint} required={required} error={error ?? null} className={className}>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
        <SelectTrigger>
          <SelectValue placeholder={services.loading ? 'Loading…' : 'Not tied to a service'} />
        </SelectTrigger>
        <SelectContent>
          <Option value={NONE}>Not tied to a service</Option>
          {(services.data?.items ?? []).map((service) => (
            <Option key={service.id} value={service.id}>
              {service.name}
            </Option>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function ProfileSelect({
  value,
  onChange,
  label = 'Income profile',
  hint,
  className,
  required,
  error,
}: {
  value: string | null | undefined
  onChange: (next: string | null) => void
  label?: string
  hint?: ReactNode
  className?: string
  required?: boolean
  error?: string | null
}) {
  const profiles = useResource<ListResponse<IncomeProfile>>(FINANCE_PATHS.profiles)
  return (
    <Field label={label} hint={hint} required={required} error={error ?? null} className={className}>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
        <SelectTrigger>
          <SelectValue placeholder={profiles.loading ? 'Loading…' : 'No profile'} />
        </SelectTrigger>
        <SelectContent>
          <Option value={NONE}>No profile</Option>
          {(profiles.data?.items ?? []).map((profile) => (
            <Option key={profile.id} value={profile.id}>
              {profile.name} · {profile.tax_regime}
            </Option>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** One line stating the rate a conversion actually used, with its age. */
export function RateStrip({
  base,
  quote,
  rate,
  asOf,
  ageDays,
  derived,
  stale,
}: {
  base: string
  quote: string
  rate: number
  /** `null` when the answer needed no rate row at all (same currency both sides). */
  asOf: string | null
  ageDays?: number | null
  derived?: boolean
  stale?: boolean
}) {
  return (
    <p className="os-micro flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="os-mono text-foreground">
        1 {base} = {formatRate(rate)} {quote}
      </span>
      {asOf ? <span>rate as of {formatDate(asOf)}</span> : <span>same currency on both sides</span>}
      {derived ? (
        <span className="text-muted-foreground">
          · derived from the {quote}→{base} rate
        </span>
      ) : null}
      {ageDays != null ? (
        <span className={cn('os-mono', stale ? 'text-warning' : 'text-faint')}>
          {stale ? `last known, ${ageDays}d old` : `${ageDays}d old`}
        </span>
      ) : null}
    </p>
  )
}
