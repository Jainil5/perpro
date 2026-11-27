'use client'

import { useEffect, useMemo, useState } from 'react'
import { Banknote, Download, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  AmountField,
  CurrencySelect,
  MoneyCell,
  MoneyHero,
  MonthBars,
  PeriodNav,
  ServiceSelect,
  ShareList,
  SortHeader,
  StatusLabel,
} from '@/components/os/finance'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterBar, FilterChip, InlineSearch, LoadMore } from '@/components/os/filters'
import { Panel } from '@/components/os/ui/card'
import { Button, IconButton, buttonVariants } from '@/components/os/ui/button'
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
import { api, apiUrl, errorMessage } from '@/lib/os/client'
import { useDebounced, useEnums, useResource } from '@/lib/os/hooks'
import {
  FINANCE_DEFAULT_DIR,
  FINANCE_PATHS,
  type IncomeMethod,
  type IncomeStatus,
  type IncomeSummary,
  type IncomeTransaction,
  type IncomeTransactionInput,
  type SortDir,
} from '@/lib/os/finance'
import type { PagedListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate, todayDate } from '@/lib/os/format'
import {
  formatMoney,
  monthBounds,
  monthKey,
  monthLabel,
  moneyDelta,
  moneyInputError,
  parseMoney,
} from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

const PAGE = 100
const NONE = '__none'

/** The order the status chips appear in, so the rail never reshuffles between months. */
const STATUS_ORDER: IncomeStatus[] = ['expected', 'invoiced', 'overdue', 'paid', 'written_off']

/**
 * The money that actually arrived (or was meant to). `/income` for the rows,
 * `/income/summary` for every figure above them — this page adds nothing up, so an
 * invoice in USD and a salary in INR are never merged into one number.
 */
export default function IncomeLedger({
  focusId,
  defaultCurrency,
  onChanged,
}: {
  focusId: string | null
  defaultCurrency: string
  onChanged: () => void
}) {
  const { enums } = useEnums()

  const thisMonth = monthKey(todayDate()) ?? todayDate().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [allTime, setAllTime] = useState(Boolean(focusId))
  const [status, setStatus] = useState<IncomeStatus | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState('received_on')
  const [dir, setDir] = useState<SortDir>(FINANCE_DEFAULT_DIR.received_on ?? 'desc')
  const [pages, setPages] = useState(1)
  const [highlight, setHighlight] = useState<string | null>(focusId)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<IncomeTransaction | null>(null)
  const [deleting, setDeleting] = useState<IncomeTransaction | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const search = useDebounced(term)

  const bounds = useMemo(() => monthBounds(month), [month])

  const income = useResource<PagedListResponse<IncomeTransaction>>(FINANCE_PATHS.income, {
    from: allTime ? undefined : bounds.from,
    to: allTime ? undefined : bounds.to,
    status: status ?? undefined,
    service_id: serviceId ?? undefined,
    currency: currencyCode ?? undefined,
    q: search || undefined,
    sort,
    dir,
    limit: PAGE * pages,
    offset: 0,
  })
  const summary = useResource<IncomeSummary>(FINANCE_PATHS.incomeSummary, {
    month: bounds.from,
  })

  const rows = income.data?.items ?? []
  const total = income.data?.total ?? 0
  const missing = income.error?.status === 404 || summary.error?.status === 404
  const linked = highlight && rows.some((row) => row.id === highlight) ? highlight : null
  const linkedBeyondPage =
    Boolean(highlight) && income.data !== undefined && !linked && rows.length < total

  // A deep link (`?income=` from a notification, search or the activity spine) names a row,
  // not a month — so the window widens rather than pretending the entry is elsewhere.
  useEffect(() => {
    if (!focusId) return
    setHighlight(focusId)
    clearWindows()
  }, [focusId])

  useEffect(() => {
    if (!highlight) return
    const node = document.getElementById(`income-${highlight}`)
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

  function refresh() {
    onChanged()
    income.reload()
    summary.reload()
  }

  /** Focus a row from the overdue list: drop every filter that could hide it, then scroll. */
  function clearWindows() {
    setAllTime(true)
    setStatus(null)
    setServiceId(null)
    setCurrencyCode(null)
    setTerm('')
    setPages(1)
  }

  function focusRow(id: string) {
    setHighlight(id)
    clearWindows()
  }

  async function markPaid(row: IncomeTransaction) {
    setMarking(row.id)
    try {
      await api<IncomeTransaction>(`${FINANCE_PATHS.income}/${row.id}/mark-paid`, {
        method: 'POST',
      })
      toastSuccess('Marked paid', { description: row.label })
      refresh()
    } catch (e) {
      toastError('Could not mark it paid', { description: errorMessage(e) })
    } finally {
      setMarking(null)
    }
  }

  const statuses = (enums.income_status ?? STATUS_ORDER) as IncomeStatus[]

  return (
    <div className="space-y-4">
      <FilterBar>
        <PeriodNav
          month={month}
          onChange={setMonth}
          thisMonth={thisMonth}
          label="Summary for"
        />
        <FilterChip
          active={allTime}
          onClick={() => {
            setAllTime((prev) => !prev)
            setPages(1)
          }}
        >
          All-time rows
        </FilterChip>
        <InlineSearch
          value={term}
          onChange={(next) => {
            setTerm(next)
            setPages(1)
          }}
          placeholder="Search label, invoice, notes…"
          className="max-w-xs"
        />
        <a
          className={cn(
            buttonVariants({ size: 'sm', variant: 'outline' }),
            'ml-auto bg-transparent'
          )}
          href={apiUrl(FINANCE_PATHS.incomeExport, {
            from: allTime ? undefined : bounds.from,
            to: allTime ? undefined : bounds.to,
            status: status ?? undefined,
            service_id: serviceId ?? undefined,
            currency: currencyCode ?? undefined,
            q: search || undefined,
          })}
          title="Download this exact window as CSV, with per-currency totals"
        >
          <Download /> Export CSV
        </a>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialog(true)
          }}
        >
          <Plus /> Log income
        </Button>
      </FilterBar>

      {missing ? (
        <ErrorBlock
          error={income.error ?? summary.error}
          onRetry={refresh}
          title="This API has no Finance endpoints yet"
          className="border-line"
        />
      ) : (
        <>
          <section className="os-panel min-w-0 px-4 py-3">
            <ResourceState
              resource={summary}
              skeleton={
                <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-3 sm:grid-cols-4">
                  <LoadingBlock rows={2} />
                </div>
              }
            >
              {(s) => (
                <div className="grid min-w-0 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
                  <MoneyHero
                    label={`Received in ${monthLabel(month)}`}
                    value={s.received}
                    currency={s.currency}
                    delta={moneyDelta(s.received, s.series.at(-2)?.received ?? null)}
                    goodWhen="up"
                    hint={
                      <span className="text-faint">
                        {s.currency === null
                          ? 'more than one currency in this month, so no single total is named'
                          : `in ${s.currency}; rows in other currencies are listed beside it, never merged`}
                      </span>
                    }
                  />
                  <Stat
                    label="Invoiced"
                    value={formatMoney(s.invoiced, s.currency, { compact: true })}
                  />
                  <Stat
                    label="Receivables"
                    value={formatMoney(s.receivables, s.currency, { compact: true })}
                    tone={s.receivables && s.receivables > 0 ? 'warning' : 'default'}
                  />
                  <Stat
                    label="Overdue rows"
                    value={s.overdue.length}
                    tone={s.overdue.length ? 'danger' : 'default'}
                  />
                </div>
              )}
            </ResourceState>
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Panel
              dense
              title="Where it came from"
              description="Tap a service to filter the rows beside it."
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Adding up the month…</p>}
              >
                {(s) => (
                  <div className="space-y-4">
                    <ShareList
                      rows={s.by_service.map((row) => ({
                        id: row.service_id,
                        label: row.name,
                        value: row.amount,
                      }))}
                      currency={s.currency}
                      emptyLabel="No income recorded in this month yet."
                      onSelect={(id) => {
                        if (id === null) {
                          // The API's "Unlinked" bucket is rows with no service, and there is
                          // no `service_id=` value that asks for exactly that.
                          toastError('Unlinked rows have no service to filter by', {
                            description: 'Clear the service filter and look for them in the list.',
                          })
                          return
                        }
                        setServiceId(id)
                        setPages(1)
                      }}
                    />
                    <div className="border-t border-line-faint pt-3">
                      <p className="os-label mb-2">{`${s.series.length} months`}</p>
                      <MonthBars
                        series={s.series}
                        currency={s.currency}
                        caption="received, in the month’s own currency where one can be named"
                      />
                    </div>
                    {s.by_currency.length > 1 ? (
                      <div className="border-t border-line-faint pt-3">
                        <p className="os-label mb-1">Per currency — never added together</p>
                        <ul className="min-w-0 space-y-1">
                          {s.by_currency.map((row) => (
                            <li
                              key={row.currency}
                              className="flex items-baseline justify-between gap-3"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrencyCode(currencyCode === row.currency ? null : row.currency)
                                  setPages(1)
                                }}
                                aria-pressed={currencyCode === row.currency}
                                className={cn(
                                  'os-tap-none os-mono min-w-0 truncate rounded-os px-1 py-0.5 text-left text-[12.5px] underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground',
                                  currencyCode === row.currency
                                    ? 'text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                )}
                              >
                                {row.currency}
                              </button>
                              <span className="shrink-0">
                                <MoneyCell value={row.amount} currency={row.currency} />
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="os-micro mt-2">
                          a code above filters the rows beside it; the figures stay in the currency
                          they arrived in
                        </p>
                      </div>
                    ) : null}
                    {s.overdue.length ? (
                      <div className="border-t border-line-faint pt-3">
                        <p className="os-label mb-2 text-danger">Overdue</p>
                        <ul className="min-w-0 space-y-1">
                          {s.overdue.map((row) => (
                            <li key={row.id} className="flex items-baseline justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => focusRow(row.id)}
                                className="min-w-0 truncate text-[12.5px] text-foreground underline-offset-2 hover:underline"
                              >
                                {row.label}
                                <span className="os-micro ml-2">{formatDate(row.received_on)}</span>
                              </button>
                              <MoneyCell value={row.amount} currency={row.currency} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </ResourceState>
            </Panel>

            <Panel
              dense
              title="Money in"
              description={
                income.data
                  ? `${countLabel(rows.length, 'entry', 'entries')} shown of ${total} · ${
                      allTime ? 'every row on record' : `inside ${monthLabel(month)}`
                    } · click a row to edit`
                  : 'Salary, invoices and anything else that arrived'
              }
              bodyClassName="px-0 py-0"
            >
              {income.error && income.data === undefined ? (
                <div className="px-3 py-3">
                  <ErrorBlock error={income.error} onRetry={income.reload} />
                </div>
              ) : income.loading && income.data === undefined ? (
                <div className="px-3 py-3">
                  <LoadingBlock rows={6} />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-3">
                  <EmptyBlock
                    title="Nothing has arrived in this window"
                    description="Log a salary payment, an invoice you have already sent, or a client payment. Invoices and expectations stay in the same ledger, so receivables are a status away rather than a separate app."
                    icon={<Banknote className="size-5" />}
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(null)
                          setDialog(true)
                        }}
                      >
                        <Plus /> Log income
                      </Button>
                    }
                  />
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[7.5rem] pl-4">
                          <SortHeader
                            active={sort === 'received_on'}
                            dir={dir}
                            onClick={() => pickSort('received_on')}
                          >
                            Received
                          </SortHeader>
                        </TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead className="w-[6.5rem]">
                          <span className="os-label">Status</span>
                        </TableHead>
                        <TableHead className="w-[8.5rem] pr-4 text-right">
                          <SortHeader
                            active={sort === 'amount'}
                            dir={dir}
                            onClick={() => pickSort('amount')}
                            align="right"
                          >
                            Amount
                          </SortHeader>
                        </TableHead>
                        <TableHead className="w-20 pr-3" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <IncomeRow
                          key={row.id}
                          row={row}
                          focused={row.id === linked}
                          marking={marking === row.id}
                          onMarkPaid={() => void markPaid(row)}
                          onEdit={() => {
                            setEditing(row)
                            setDialog(true)
                          }}
                          onDelete={() => setDeleting(row)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                  <div className="px-4 pb-3 pt-2">
                    <LoadMore
                      loaded={rows.length}
                      total={total}
                      loading={income.loading}
                      size={PAGE}
                      onMore={() => setPages((n) => n + 1)}
                      onReset={() => setPages(1)}
                    />
                    <p className="os-micro mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-faint">status</span>
                      {statuses.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setStatus(status === value ? null : value)
                            setPages(1)
                          }}
                          aria-pressed={status === value}
                          className={cn(
                            'underline underline-offset-2 transition-colors duration-150',
                            status === value ? 'text-foreground' : 'hover:text-foreground'
                          )}
                        >
                          {enumLabel(value)}
                        </button>
                      ))}
                      {serviceId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setServiceId(null)
                            setPages(1)
                          }}
                          className="text-foreground underline underline-offset-2"
                        >
                          clear the service filter
                        </button>
                      ) : null}
                      {currencyCode ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCurrencyCode(null)
                            setPages(1)
                          }}
                          className="text-foreground underline underline-offset-2"
                        >
                          clear {currencyCode}
                        </button>
                      ) : null}
                      {linkedBeyondPage ? (
                        <span className="text-faint">
                          the linked entry is not in the {rows.length} rows loaded —
                          <button
                            type="button"
                            onClick={() => setPages((n) => n + 1)}
                            className="ml-1 text-foreground underline underline-offset-2"
                          >
                            load more
                          </button>
                        </span>
                      ) : null}
                    </p>
                  </div>
                </>
              )}
            </Panel>
          </div>
        </>
      )}

      <IncomeDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) setEditing(null)
        }}
        row={editing}
        defaultCurrency={defaultCurrency}
        defaultReceivedOn={monthKey(todayDate()) === month ? todayDate() : bounds.to}
        statuses={statuses}
        methods={(enums.income_method ?? [
          'bank',
          'card',
          'upi',
          'cash',
          'crypto',
          'other',
        ]) as IncomeMethod[]}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.label ?? 'entry'}”`}
        description="The row goes and the month totals are recomputed without it. Nothing else is touched."
        confirmLabel="Delete entry"
        onConfirm={() =>
          api(`${FINANCE_PATHS.income}/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Income deleted')
            refresh()
          })
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------- pieces -- */

function IncomeRow({
  row,
  focused,
  marking,
  onMarkPaid,
  onEdit,
  onDelete,
}: {
  row: IncomeTransaction
  focused: boolean
  marking: boolean
  onMarkPaid: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const converted =
    row.converted_amount !== null && row.converted_amount !== undefined
      ? formatMoney(row.converted_amount, row.converted_currency ?? undefined)
      : null
  // Where the money came from, stated once: a named service beats a subscription, a
  // subscription beats the payment rail, and none of them are invented.
  const origin = row.service?.name
    ? row.service.name
    : row.subscription_id
      ? 'subscription'
      : row.method
        ? enumLabel(row.method)
        : 'no source recorded'
  return (
    <TableRow id={`income-${row.id}`} className={cn(focused ? 'bg-canvas-deep' : null)}>
      <TableCell className="pl-4">
        <span className="os-mono whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
          {formatDate(row.received_on)}
        </span>
      </TableCell>
      <TableCell className="min-w-0">
        <button
          type="button"
          onClick={onEdit}
          className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className="block truncate text-[13px] text-foreground">{row.label}</span>
          <span className="os-micro block truncate">
            {origin}
            {row.invoice_number ? ` · ${row.invoice_number}` : ''}
            {row.source === 'demo' ? ' · demo' : ''}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <StatusLabel status={row.status} />
      </TableCell>
      <TableCell className="pr-4">
        <span className="block text-right">
          <MoneyCell value={row.amount} currency={row.currency} />
          {converted ? (
            <span
              className="os-micro block text-faint"
              title={
                row.converted_at
                  ? `converted on ${formatDate(row.converted_at.slice(0, 10))} at a rate you stored`
                  : undefined
              }
            >
              {converted} booked
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex items-center justify-end gap-0.5">
          {row.status !== 'paid' && row.status !== 'written_off' ? (
            <IconButton
              label={`Mark “${row.label}” paid`}
              size="icon-sm"
              onClick={onMarkPaid}
              disabled={marking}
            >
              <Banknote className={cn('size-3.5', marking ? 'opacity-40' : null)} />
            </IconButton>
          ) : null}
          <IconButton label={`Edit ${row.label}`} size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`Delete ${row.label}`} size="icon-sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

interface IncomeForm {
  label: string
  amount: string
  currency: string
  received_on: string
  status: IncomeStatus
  method: string
  service_id: string | null
  invoice_number: string
  notes: string
}

function blank(defaultCurrency: string, defaultReceivedOn: string): IncomeForm {
  return {
    label: '',
    amount: '',
    currency: defaultCurrency,
    received_on: defaultReceivedOn > todayDate() ? todayDate() : defaultReceivedOn,
    status: 'paid',
    method: 'bank',
    service_id: null,
    invoice_number: '',
    notes: '',
  }
}

/**
 * One form for every kind of money in — a salary that landed, an invoice still owed, a
 * client payment booked in another currency. Status is what separates them, so it sits with
 * the amount rather than in a details drawer.
 */
function IncomeDialog({
  open,
  onOpenChange,
  row,
  defaultCurrency,
  defaultReceivedOn,
  statuses,
  methods,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  row: IncomeTransaction | null
  defaultCurrency: string
  defaultReceivedOn: string
  statuses: IncomeStatus[]
  methods: IncomeMethod[]
  onSaved: () => void
}) {
  const editing = Boolean(row?.id)
  const [values, setValues] = useState<IncomeForm>(() => blank(defaultCurrency, defaultReceivedOn))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(
      row
        ? {
            label: row.label,
            amount: String(row.amount),
            currency: row.currency || defaultCurrency,
            received_on: row.received_on,
            status: row.status,
            method: row.method ?? NONE,
            service_id: row.service_id,
            invoice_number: row.invoice_number ?? '',
            notes: row.notes ?? '',
          }
        : blank(defaultCurrency, defaultReceivedOn)
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  const patch = (next: Partial<IncomeForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.label.trim()) next.label = 'Name it — “Salary — Nov”, “Invoice #142”'
    const amount = moneyInputError(values.amount, { required: true, min: 0 })
    if (amount) next.amount = amount
    if (!values.currency) next.currency = 'Pick the currency the money arrived in'
    if (!values.received_on) {
      next.received_on = values.status === 'paid' ? 'Pick the date it arrived' : 'Pick the date it is due'
    } else if (values.status === 'overdue' && values.received_on > todayDate()) {
      next.received_on = 'Overdue means already late — the date has to be in the past'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: IncomeTransactionInput = {
      label: values.label.trim(),
      amount: parseMoney(values.amount) ?? 0,
      currency: values.currency,
      received_on: values.received_on,
      status: values.status,
      service_id: values.service_id,
      invoice_number: values.invoice_number.trim() || null,
      method: values.method === NONE ? null : (values.method as IncomeMethod),
      notes: values.notes.trim() || null,
    }
    try {
      await api<IncomeTransaction>(
        editing ? `${FINANCE_PATHS.income}/${row?.id}` : FINANCE_PATHS.income,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Entry saved' : 'Income logged', { description: body.label })
      onOpenChange(false)
      onSaved()
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

  const future = values.received_on > todayDate()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={editing ? 'Edit income' : 'Log income'}
          description="The amount is stored exactly as you write it, in the currency it arrived in. Marking a row paid moves its date to today unless it already had one."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Field label="Label" htmlFor="income-label" required error={issues.label ?? null}>
            <Input
              id="income-label"
              autoFocus
              value={values.label}
              placeholder="Invoice #142 — Northwind"
              onChange={(event) => patch({ label: event.target.value })}
              aria-invalid={Boolean(issues.label) || undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <AmountField
              label="Amount"
              id="income-amount"
              value={values.amount}
              onChange={(next) => patch({ amount: next })}
              currency={values.currency}
              required
              min={0}
            />
            <CurrencySelect
              id="income-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              required
              error={issues.currency ?? null}
              hint={null}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={values.status === 'paid' ? 'Received on' : 'Due on'}
              htmlFor="income-date"
              required
              error={issues.received_on ?? null}
              hint={future ? 'a date in the future — expected or invoiced, not yet banked' : null}
            >
              <Input
                id="income-date"
                type="date"
                value={values.received_on}
                onChange={(event) => patch({ received_on: event.target.value })}
                aria-invalid={Boolean(issues.received_on) || undefined}
              />
            </Field>
            <Field label="Status" htmlFor="income-status">
              <EnumSelect
                id="income-status"
                value={values.status}
                onChange={(next) => patch({ status: next as IncomeStatus })}
                options={statuses}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" htmlFor="income-method" hint="How it was paid, if you care to track it">
              <Select
                value={values.method}
                onValueChange={(next) => patch({ method: next })}
              >
                <SelectTrigger id="income-method">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <Option value={NONE}>Not recorded</Option>
                  {methods.map((method) => (
                    <Option key={method} value={method}>
                      {enumLabel(method)}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ServiceSelect
              value={values.service_id}
              onChange={(service_id) => patch({ service_id })}
              hint="Optional — ties the money to something you sell"
            />
          </div>

          <Field label="Invoice number" htmlFor="income-invoice">
            <Input
              id="income-invoice"
              value={values.invoice_number}
              onChange={(event) => patch({ invoice_number: event.target.value })}
              className="os-mono"
            />
          </Field>

          <Field label="Notes" htmlFor="income-notes">
            <Textarea
              id="income-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <p className="os-micro mr-auto text-faint">
            {editing ? 'Editing an existing row' : 'Nothing is sent until you press save'}
          </p>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save entry' : 'Log income'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
