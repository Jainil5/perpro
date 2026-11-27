'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Ban, Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react'

import {
  AmountField,
  CurrencySelect,
  IntervalSuffix,
  MoneyCell,
  SortHeader,
  StatusLabel,
} from '@/components/os/finance'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterBar, FilterChip, InlineSearch, LoadMore } from '@/components/os/filters'
import { Panel } from '@/components/os/ui/card'
import { Button, IconButton } from '@/components/os/ui/button'
import { Stat } from '@/components/os/ui/stats'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/os/ui/table'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/os/ui/dialog'
import { Field } from '@/components/os/ui/label'
import { Input } from '@/components/os/ui/input'
import { Textarea } from '@/components/os/ui/textarea'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { EnumSelect } from '@/components/os/pickers'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource, useWorkspace } from '@/lib/os/hooks'
import {
  FINANCE_DEFAULT_DIR,
  FINANCE_PATHS,
  FINANCE_SCOPE,
  type FinanceSummary,
  type PlanInterval,
  type ServicePlan,
  type SortDir,
  type Subscription,
  type SubscriptionInput,
  type SubscriptionStatus,
} from '@/lib/os/finance'
import type { ListResponse, PagedListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate, todayDate } from '@/lib/os/format'
import {
  formatMoney,
  minorUnits,
  moneyInputError,
  parseMoney,
  runwayLabel,
} from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

const PAGE = 100
const NONE = '__none'

/** `?renews=` on the API: which renewal window to keep. */
type RenewsWindow = 'all' | 'month' | 'week' | 'past'

const WINDOWS: Array<{ key: Exclude<RenewsWindow, 'all'>; label: string; note: string }> = [
  {
    key: 'month',
    label: 'Renews this month',
    note: 'renewal date inside the calendar month you are looking at',
  },
  { key: 'week', label: 'In 7 days', note: 'renewal date within a week of today' },
  {
    key: 'past',
    label: 'Slipped past',
    note: 'renewal date earlier than today — the row is still live unless it was paused',
  },
]

/**
 * Subscriptions — every recurring commitment, with the renewal date the server worked out
 * and the monthly figure the server normalised. A weekly price is never multiplied here:
 * `monthly_cost` and `annual_cost` come back on the row, because a burn built by adding
 * browser guesses is not a burn.
 */
export default function SubscriptionsView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const defaultCurrency = workspace.data?.currency ?? 'INR'

  const focusSub = params.get('sub')
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [renewsWindow, setRenewsWindow] = useState<RenewsWindow>('all')
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [sort, setSort] = useState('renews')
  const [dir, setDir] = useState<SortDir>(FINANCE_DEFAULT_DIR.renews ?? 'asc')
  const [pages, setPages] = useState(1)
  const [highlight, setHighlight] = useState<string | null>(focusSub)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Subscription | null>(null)
  const [deleting, setDeleting] = useState<Subscription | null>(null)
  const [cancel, setCancel] = useState<Subscription | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flags, setFlags] = useState<string[]>([])
  const search = useDebounced(term)

  const subscriptions = useResource<PagedListResponse<Subscription>>(
    FINANCE_PATHS.subscriptions,
    {
      status: status ?? undefined,
      renews: renewsWindow === 'all' ? undefined : renewsWindow,
      q: search || undefined,
      sort,
      dir,
      limit: PAGE * pages,
      offset: 0,
    }
  )
  // The burn and the renewal count are the overview's own numbers, not a sum of this table.
  const summary = useResource<FinanceSummary>(FINANCE_PATHS.summary, { today: todayDate() })
  const plans = useResource<ListResponse<ServicePlan>>(FINANCE_PATHS.plans, { active: 'true' })

  const rows = subscriptions.data?.items ?? []
  const total = subscriptions.data?.total ?? 0
  const missing = subscriptions.error?.status === 404 || summary.error?.status === 404
  const linked = focusSub && rows.some((row) => row.id === focusSub) ? focusSub : null
  const activeWindow = WINDOWS.find((item) => item.key === renewsWindow)

  // A notification names a subscription, not a filter — clear what could hide it.
  useEffect(() => {
    if (!focusSub) return
    setStatus(null)
    setRenewsWindow('all')
    setTerm('')
  }, [focusSub])

  useEffect(() => {
    if (!highlight) return
    const node = document.getElementById(`sub-${highlight}`)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, rows.length])

  function pickSort(next: string) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(FINANCE_DEFAULT_DIR[next] ?? 'asc')
    setPages(1)
  }

  function clearFilters() {
    setStatus(null)
    setRenewsWindow('all')
    setTerm('')
    setPages(1)
  }

  function refresh() {
    invalidate(...FINANCE_SCOPE)
    subscriptions.reload()
    summary.reload()
    plans.reload()
  }

  const ACTED: Record<'pause' | 'resume' | 'cancel', string> = {
    pause: 'Subscription paused',
    resume: 'Subscription resumed',
    cancel: 'Subscription cancelled',
  }

  async function act(row: Subscription, verb: 'pause' | 'resume' | 'cancel') {
    setBusy(`${row.id}:${verb}`)
    try {
      const next = await api<Subscription>(`${FINANCE_PATHS.subscriptions}/${row.id}/${verb}`, {
        method: 'POST',
      })
      toastSuccess(ACTED[verb], { description: next.label ?? row.label ?? undefined })
      setFlags(next.warnings ?? [])
      refresh()
    } catch (e) {
      toastError(`Could not ${verb} it`, { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const statuses = (enums.subscription_status ?? [
    'trialing',
    'active',
    'paused',
    'cancelled',
    'expired',
  ]) as SubscriptionStatus[]
  const renewing = summary.data?.renewing_this_month ?? []

  function clearFlags() {
    setFlags([])
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Subscriptions</h1>
          <p className="os-micro mt-2">
            What repeats, when it renews, and what each one costs per month once the interval is
            normalised. Pause and resume are real states — a paused row stays in the ledger and
            leaves the burn.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialog(true)
            }}
          >
            <Plus /> New subscription
          </Button>
        </div>
      </header>

      {missing ? (
        <ErrorBlock
          error={subscriptions.error ?? summary.error}
          onRetry={refresh}
          title="This API has no Finance endpoints yet"
          className="border-line"
        />
      ) : (
        <>
          <section className="os-panel min-w-0 px-4 py-3">
            <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-4 sm:grid-cols-4">
              <Stat
                label="On record"
                value={subscriptions.data ? total : '—'}
              />
              <Stat
                label="Renews this month"
                value={summary.data ? renewing.length : '—'}
                tone={renewing.length ? 'warning' : 'default'}
              />
              <div className="min-w-0">
                <p className="os-label">Monthly burn</p>
                <p className="os-mono mt-1.5 text-[1.35rem] leading-none tabular-nums text-foreground">
                  {summary.data
                    ? formatMoney(summary.data.monthly_burn, summary.data.currency, {
                        compact: true,
                        sign: 'never',
                      })
                    : '—'}
                </p>
                <p className="os-micro mt-1.5">recurring rows + this month’s spend</p>
              </div>
              <div className="min-w-0">
                <p className="os-label">Runway</p>
                <p className="os-mono mt-1.5 text-[1.35rem] leading-none tabular-nums text-foreground">
                  {summary.data
                    ? runwayLabel(summary.data.runway_months, {
                        named: summary.data.currency !== null,
                        burn: summary.data.monthly_burn,
                        cash: summary.data.cash_in_90d,
                      })
                    : '—'}
                </p>
                <p className="os-micro mt-1.5">
                  cash in 90 days ÷ burn, in one currency — name it on the overview
                </p>
              </div>
            </div>
          </section>

          <FilterBar>
            <InlineSearch
              value={term}
              onChange={(next) => {
                setTerm(next)
                setPages(1)
              }}
              placeholder="Search invoice number, notes…"
              className="max-w-xs"
            />
            <FilterChip active={status === null} onClick={() => setStatus(null)}>
              Any status
            </FilterChip>
            {statuses.map((value) => (
              <FilterChip
                key={value}
                active={status === value}
                onClick={() => {
                  setStatus(status === value ? null : value)
                  setPages(1)
                }}
              >
                {enumLabel(value)}
              </FilterChip>
            ))}
            <FilterChip active={renewsWindow === 'all'} onClick={() => setRenewsWindow('all')}>
              Any date
            </FilterChip>
            {WINDOWS.map((item) => (
              <FilterChip
                key={item.key}
                active={renewsWindow === item.key}
                onClick={() => {
                  setRenewsWindow(renewsWindow === item.key ? 'all' : item.key)
                  setPages(1)
                }}
              >
                {item.label}
              </FilterChip>
            ))}
          </FilterBar>

          {activeWindow ? (
            <p className="os-micro -mt-1.5">
              {activeWindow.note} — asked of the API as `renews={activeWindow.key}`, not filtered
              here.
            </p>
          ) : null}

          {flags.length > 0 ? (
            <div
              className="os-panel flex items-start justify-between gap-3 border-line px-3 py-2"
              role="status"
            >
              <p className="os-micro min-w-0 text-warning">
                {flags.map((flag) => (
                  <span key={flag} className="block">
                    {flag}
                  </span>
                ))}
              </p>
              <button
                type="button"
                onClick={clearFlags}
                className="os-tap-none shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                dismiss
              </button>
            </div>
          ) : null}

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Panel
              dense
              title="Renews this month"
              description="Straight from the overview’s own figure — the calendar, not a guess."
            >
              <ResourceState
                resource={summary}
                skeleton={<LoadingBlock rows={4} />}
              >
                {(s) => {
                  const items = s.renewing_this_month ?? []
                  if (items.length === 0) {
                    return (
                      <p className="os-micro">
                        Nothing is due in {s.month}. Rows in a currency other than {s.currency} are
                        listed in their own currency.
                      </p>
                    )
                  }
                  return (
                    <ul className="min-w-0 divide-y divide-line-faint">
                      {items.map((item) => (
                        <li key={item.id} className="flex items-baseline justify-between gap-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              clearFilters()
                              setHighlight(item.id)
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-[13px] text-foreground underline-offset-2 hover:underline">
                              {item.label}
                            </span>
                            <span className="os-micro block">
                              {formatDate(item.renews_on)} ·{' '}
                              {item.days_until <= 0
                                ? 'due today'
                                : item.days_until === 1
                                  ? 'tomorrow'
                                  : `in ${item.days_until} days`}
                            </span>
                          </button>
                          <MoneyCell value={item.amount} currency={item.currency} />
                        </li>
                      ))}
                    </ul>
                  )
                }}
              </ResourceState>
            </Panel>

            <Panel
              dense
              title="Commitments"
              description={
                subscriptions.data
                  ? `${countLabel(rows.length, 'row', 'rows')} shown of ${total} · click a row to edit it`
                  : 'Everything that bills you on a schedule'
              }
              bodyClassName="px-0 py-0"
            >
              {subscriptions.error && subscriptions.data === undefined ? (
                <div className="px-3 py-3">
                  <ErrorBlock error={subscriptions.error} onRetry={subscriptions.reload} />
                </div>
              ) : subscriptions.loading && subscriptions.data === undefined ? (
                <div className="px-3 py-3">
                  <LoadingBlock rows={6} />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-3">
                  <EmptyBlock
                    title="No subscriptions match this view"
                    description="Add the tools, services and plans that bill you repeatedly. Weekly, monthly, quarterly and yearly rows are all kept as they are; the monthly figure is what the burn uses."
                    icon={<Repeat className="size-5" />}
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(null)
                          setDialog(true)
                        }}
                      >
                        <Plus /> New subscription
                      </Button>
                    }
                  />
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Plan or label</TableHead>
                        <TableHead className="w-[6.5rem]">Status</TableHead>
                        <TableHead className="w-[7.5rem]">
                          <SortHeader
                            active={sort === 'renews'}
                            dir={dir}
                            onClick={() => pickSort('renews')}
                          >
                            Renews
                          </SortHeader>
                        </TableHead>
                        <TableHead className="w-[8rem] text-right">
                          <SortHeader
                            active={sort === 'price'}
                            dir={dir}
                            onClick={() => pickSort('price')}
                            align="right"
                          >
                            Price
                          </SortHeader>
                        </TableHead>
                        <TableHead className="w-[7.5rem] text-right">
                          <SortHeader
                            active={sort === 'cost'}
                            dir={dir}
                            onClick={() => pickSort('cost')}
                            align="right"
                          >
                            Per month
                          </SortHeader>
                        </TableHead>
                        <TableHead className="w-[8.5rem] pr-3" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <SubscriptionRow
                          key={row.id}
                          row={row}
                          focused={row.id === linked}
                          busy={busy}
                          onEdit={() => {
                            setEditing(row)
                            setDialog(true)
                          }}
                          onDelete={() => setDeleting(row)}
                          onCancel={() => setCancel(row)}
                          onAct={(verb) => void act(row, verb)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                  <div className="px-4 pb-3 pt-2">
                    <LoadMore
                      loaded={rows.length}
                      total={total}
                      loading={subscriptions.loading}
                      size={PAGE}
                      onMore={() => setPages((n) => n + 1)}
                      onReset={() => setPages(1)}
                    />
                    <p className="os-micro mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => pickSort('created')}
                        className={cn(
                          'underline underline-offset-2 transition-colors duration-150',
                          sort === 'created' ? 'text-foreground' : 'hover:text-foreground'
                        )}
                      >
                        sort by when it was added
                      </button>
                      {status || renewsWindow !== 'all' || search ? (
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="text-foreground underline underline-offset-2"
                        >
                          clear the filters
                        </button>
                      ) : null}
                      <span className="text-faint">
                        a one-off price stays one-off: it has no monthly figure and is not in the burn
                      </span>
                    </p>
                  </div>
                </>
              )}
            </Panel>
          </div>
        </>
      )}

      <SubscriptionDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) setEditing(null)
        }}
        row={editing}
        defaultCurrency={defaultCurrency}
        plans={plans.data?.items ?? []}
        statuses={statuses}
        intervals={(enums.plan_interval ?? [
          'monthly',
          'quarterly',
          'yearly',
          'one_time',
        ]) as PlanInterval[]}
        onSaved={(next) => {
          setFlags(next)
          refresh()
          setHighlight(null)
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.label ?? deleting?.plan?.name ?? 'subscription'}”`}
        description="The row and its renewal history go. Income already booked against it is not touched."
        confirmLabel="Delete subscription"
        onConfirm={() =>
          api(`${FINANCE_PATHS.subscriptions}/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Subscription deleted')
            refresh()
          })
        }
      />

      <ConfirmDialog
        open={!!cancel}
        onOpenChange={(next) => (next ? undefined : setCancel(null))}
        title={`Cancel “${cancel?.label ?? cancel?.plan?.name ?? 'subscription'}”`}
        description="Cancellation keeps the row and stamps today as the end date, so the burn drops next month without erasing the history. Use pause if you only mean “not right now”."
        confirmLabel="Cancel subscription"
        onConfirm={() => {
          if (!cancel) return undefined
          return act(cancel, 'cancel').then(() => setCancel(null))
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------- pieces -- */

function SubscriptionRow({
  row,
  focused,
  busy,
  onEdit,
  onDelete,
  onCancel,
  onAct,
}: {
  row: Subscription
  focused: boolean
  busy: string | null
  onEdit: () => void
  onDelete: () => void
  onCancel: () => void
  onAct: (verb: 'pause' | 'resume') => void
}) {
  const running = row.is_running !== false
  const paused = row.status === 'paused'
  const dead = row.status === 'cancelled' || row.status === 'expired'
  const days = row.renews_in_days
  const late = days !== null && days !== undefined && days < 0 && running
  return (
    <TableRow id={`sub-${row.id}`} className={cn(focused ? 'bg-canvas-deep' : null)}>
      <TableCell className="pl-4">
        <button
          type="button"
          onClick={onEdit}
          className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className="block truncate text-[13px] text-foreground">
            {row.label ?? row.plan?.name ?? row.invoice_number ?? 'untitled commitment'}
          </span>
          <span className="os-micro block truncate">
            since {formatDate(row.started_on)}
            {row.plan ? ` · ${enumLabel(row.plan.interval)} plan` : ''}
            {row.cancelled_on ? ` · ended ${formatDate(row.cancelled_on)}` : ''}
            {row.source === 'demo' ? ' · demo' : ''}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <StatusLabel status={row.status} />
      </TableCell>
      <TableCell>
        {row.renews_on ? (
          <span className="block">
            <span className="os-mono text-[12.5px] tabular-nums text-muted-foreground">
              {formatDate(row.renews_on)}
            </span>
            <span
              className={cn(
                'os-micro block',
                late ? 'text-danger' : days === 0 ? 'text-warning' : 'text-faint'
              )}
            >
              {days === null || days === undefined
                ? ''
                : days < 0
                  ? `${Math.abs(days)}d overdue`
                  : days === 0
                    ? 'today'
                    : `in ${days}d`}
            </span>
          </span>
        ) : (
          <span className="os-micro">never</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <span className="flex items-baseline justify-end gap-1">
          <MoneyCell value={row.price} currency={row.currency} sign="never" />
          <IntervalSuffix interval={row.interval} />
        </span>
      </TableCell>
      <TableCell className="text-right">
        {row.monthly_cost === null || row.monthly_cost === undefined ? (
          <span className="os-micro">one-off</span>
        ) : (
          <MoneyCell value={row.monthly_cost} currency={row.currency} sign="never" />
        )}
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex items-center justify-end gap-0.5">
          {!dead ? (
            <IconButton
              label={paused ? `Resume ${row.label ?? 'subscription'}` : `Pause ${row.label ?? 'subscription'}`}
              size="icon-sm"
              disabled={busy === `${row.id}:pause` || busy === `${row.id}:resume`}
              onClick={() => onAct(paused ? 'resume' : 'pause')}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </IconButton>
          ) : null}
          {!dead ? (
            <IconButton
              label={`Cancel ${row.label ?? 'subscription'}`}
              size="icon-sm"
              onClick={onCancel}
            >
              <Ban className="size-3.5" />
            </IconButton>
          ) : null}
          <IconButton
            label={`Edit ${row.label ?? 'subscription'}`}
            size="icon-sm"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton
            label={`Delete ${row.label ?? 'subscription'}`}
            size="icon-sm"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

interface SubscriptionForm {
  plan_id: string
  status: SubscriptionStatus
  started_on: string
  renews_on: string
  cancelled_on: string
  price: string
  currency: string
  interval: PlanInterval
  invoice_number: string
  notes: string
}

/**
 * The form keeps the two things the API needs to normalise a row — the price and its
 * interval — beside each other, because `45 / quarter` and `45 / month` are different
 * commitments and the difference is the whole point of the screen.
 */
function SubscriptionDialog({
  open,
  onOpenChange,
  row,
  defaultCurrency,
  plans,
  statuses,
  intervals,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  row: Subscription | null
  defaultCurrency: string
  plans: ServicePlan[]
  statuses: SubscriptionStatus[]
  intervals: PlanInterval[]
  /** The API's own `warnings` come back with the saved row, so the screen can show them. */
  onSaved: (flags: string[]) => void
}) {
  const editing = Boolean(row?.id)
  const [values, setValues] = useState<SubscriptionForm>(() => blank(defaultCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(
      row
        ? {
            plan_id: row.plan_id ?? NONE,
            status: row.status,
            started_on: row.started_on,
            renews_on: row.renews_on ?? '',
            cancelled_on: row.cancelled_on ?? '',
            price: String(row.price),
            currency: row.currency || defaultCurrency,
            interval: row.interval ?? 'monthly',
            invoice_number: row.invoice_number ?? '',
            notes: row.notes ?? '',
          }
        : blank(defaultCurrency)
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  const patch = (next: Partial<SubscriptionForm>) => setValues((prev) => ({ ...prev, ...next }))

  /** Picking a plan copies what it charges — it does not recalculate anything. */
  function pickPlan(id: string) {
    const plan = plans.find((item) => item.id === id)
    if (!plan) {
      patch({ plan_id: NONE })
      return
    }
    patch({
      plan_id: plan.id,
      price: String(plan.price),
      currency: plan.currency ?? defaultCurrency,
      interval: plan.interval,
    })
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.started_on) next.started_on = 'When did it start?'
    const price = moneyInputError(values.price, { required: true, min: 0 })
    if (price) next.price = price
    if (!values.currency) next.currency = 'Pick the currency it bills in'
    if (values.renews_on && values.renews_on < values.started_on) {
      next.renews_on = 'A renewal cannot fall before the start date'
    }
    if (values.cancelled_on && values.cancelled_on < values.started_on) {
      next.cancelled_on = 'Cancelled before it started — check the dates'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: SubscriptionInput = {
      plan_id: values.plan_id === NONE ? null : values.plan_id,
      status: values.status,
      started_on: values.started_on,
      renews_on: values.renews_on || null,
      cancelled_on: values.cancelled_on || null,
      price: parseMoney(values.price) ?? 0,
      currency: values.currency,
      interval: values.interval,
      invoice_number: values.invoice_number.trim() || null,
      notes: values.notes.trim() || null,
    }
    try {
      const saved = await api<Subscription & { warnings?: string[] }>(
        editing ? `${FINANCE_PATHS.subscriptions}/${row?.id}` : FINANCE_PATHS.subscriptions,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Subscription saved' : 'Subscription added', {
        description: saved.label ?? body.invoice_number ?? undefined,
      })
      // A live row with a renewal date already behind it is legal — people log late — but
      // the API says so, and that answer belongs on the screen rather than in a toast.
      onSaved(saved.warnings ?? [])
      onOpenChange(false)
    } catch (e) {
      setFormError(errorMessage(e))
      const mapped: Record<string, string> = {}
      for (const detail of (e as { details?: Array<{ field?: string; message: string }> }).details ??
        []) {
        if (!detail.field) continue
        const key = detail.field.split('.').pop()
        if (key && key in body) mapped[key] = detail.message
      }
      setIssues((prev) => ({ ...prev, ...mapped }))
    } finally {
      setPending(false)
    }
  }

  const chosen = plans.find((plan) => plan.id === values.plan_id)
  const late =
    (values.status === 'active' || values.status === 'trialing') &&
    values.renews_on !== '' &&
    values.renews_on < todayDate()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={editing ? 'Edit subscription' : 'Add a subscription'}
          description="The price and its interval are stored as you write them; the monthly and annual figures are what the server normalises them to."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <Field
            label="Bill from a plan"
            htmlFor="sub-plan"
            hint={
              chosen
                ? `copies ${chosen.name}’s price and interval — change either one freely`
                : 'optional — a plan link lets revenue find this row'
            }
          >
            <Select value={values.plan_id} onValueChange={pickPlan}>
              <SelectTrigger id="sub-plan">
                <SelectValue placeholder="Not from a catalogue plan" />
              </SelectTrigger>
              <SelectContent>
                <Option value={NONE}>Not from a catalogue plan</Option>
                {plans.map((plan) => (
                  <Option key={plan.id} value={plan.id}>
                    {plan.service?.name ? `${plan.service.name} · ` : ''}
                    {plan.name} — {formatMoney(plan.price, plan.currency ?? undefined, {
                      sign: 'never',
                    })}
                    <IntervalSuffix interval={plan.interval} />
                  </Option>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <AmountField
              label="Price"
              id="sub-price"
              value={values.price}
              onChange={(next) => patch({ price: next })}
              currency={values.currency}
              required
              min={0}
            />
            <CurrencySelect
              id="sub-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              required
              error={issues.currency ?? null}
              hint={null}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Every" htmlFor="sub-interval" required>
              <EnumSelect
                id="sub-interval"
                value={values.interval}
                onChange={(next) => patch({ interval: next as PlanInterval })}
                options={intervals}
              />
            </Field>
            <Field label="Status" htmlFor="sub-status" required>
              <EnumSelect
                id="sub-status"
                value={values.status}
                onChange={(next) => patch({ status: next as SubscriptionStatus })}
                options={statuses}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Started" htmlFor="sub-started" required error={issues.started_on ?? null}>
              <Input
                id="sub-started"
                type="date"
                value={values.started_on}
                onChange={(event) => patch({ started_on: event.target.value })}
                aria-invalid={Boolean(issues.started_on) || undefined}
              />
            </Field>
            <Field
              label="Renews"
              htmlFor="sub-renews"
              error={issues.renews_on ?? null}
              hint={late ? 'behind today — the API will flag it, not reject it' : null}
            >
              <Input
                id="sub-renews"
                type="date"
                value={values.renews_on}
                onChange={(event) => patch({ renews_on: event.target.value })}
                aria-invalid={Boolean(issues.renews_on) || undefined}
              />
            </Field>
            <Field
              label="Cancelled"
              htmlFor="sub-cancelled"
              error={issues.cancelled_on ?? null}
              hint={values.status === 'cancelled' ? null : 'only used when cancelled'}
            >
              <Input
                id="sub-cancelled"
                type="date"
                value={values.cancelled_on}
                onChange={(event) => patch({ cancelled_on: event.target.value })}
                aria-invalid={Boolean(issues.cancelled_on) || undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice number" htmlFor="sub-invoice">
              <Input
                id="sub-invoice"
                value={values.invoice_number}
                onChange={(event) => patch({ invoice_number: event.target.value })}
                className="os-mono"
              />
            </Field>
            <Field label="Notes" htmlFor="sub-notes">
              <Textarea
                id="sub-notes"
                rows={1}
                value={values.notes}
                onChange={(event) => patch({ notes: event.target.value })}
              />
            </Field>
          </div>

          {values.interval === 'one_time' ? (
            <p className="os-micro border-t border-line-faint pt-3">
              A one-off price has no monthly figure, so it is shown as it stands and left out of the
              recurring burn.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <p className="os-micro mr-auto text-faint">
            {values.currency
              ? `smallest stored step ${minorUnits(values.currency) === 0 ? 'whole units' : '0.01'} · ${values.currency}`
              : 'choose a currency first'}
          </p>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save subscription' : 'Add subscription'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blank(defaultCurrency: string): SubscriptionForm {
  return {
    plan_id: NONE,
    status: 'active',
    started_on: todayDate(),
    renews_on: '',
    cancelled_on: '',
    price: '',
    currency: defaultCurrency,
    interval: 'monthly',
    invoice_number: '',
    notes: '',
  }
}
