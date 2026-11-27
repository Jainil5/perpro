'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeftRight, Coins, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'

import {
  AmountField,
  CurrencySelect,
  MoneyCell,
  MoneyHero,
  RateStrip,
} from '@/components/os/finance'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterChip, InlineSearch, LoadMore } from '@/components/os/filters'
import { Panel } from '@/components/os/ui/card'
import { Button, IconButton } from '@/components/os/ui/button'
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
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useDebounced, useResource, useWorkspace } from '@/lib/os/hooks'
import type { UseResourceResult } from '@/lib/os/hooks'
import {
  FINANCE_PATHS,
  FINANCE_SCOPE,
  type ConvertResult,
  type CurrencyInfo,
  type ExchangeRate,
  type ExchangeRateInput,
} from '@/lib/os/finance'
import type { ListResponse, PagedListResponse } from '@/lib/os/types'
import { countLabel, formatDate, todayDate } from '@/lib/os/format'
import { formatMoney, formatRate, minorUnits, parseMoney } from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

const PAGE = 100

/**
 * `?pair=USDINR` / `?pair=USD-INR` — the shape `services/links.py` emits for a stale-rate
 * notification. Anything that is not two ISO codes bolted together falls back to the search.
 */
function parsePair(raw: string | null): { base: string; quote: string } | null {
  if (!raw) return null
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '')
  if (letters.length !== 6) return null
  return { base: letters.slice(0, 3), quote: letters.slice(3) }
}

/**
 * Currency — one question, answered only from rows the user owns: what is this worth in
 * another currency? `GET /convert` returns the figure *and* the rate, its date, whether it
 * was the stored inverse, and how old it is. A missing rate is shown as a missing rate.
 */
export default function CurrencyView() {
  const params = useSearchParams()
  const workspace = useWorkspace()
  const defaultCurrency = workspace.data?.currency ?? 'INR'

  const pair = useMemo(() => parsePair(params.get('pair')), [params])

  const [amount, setAmount] = useState('100')
  const [base, setBase] = useState(pair?.base ?? defaultCurrency)
  const [quote, setQuote] = useState(pair?.quote ?? (defaultCurrency === 'INR' ? 'USD' : 'INR'))
  const [asOf, setAsOf] = useState(todayDate())
  const [pairFilter, setPairFilter] = useState(Boolean(pair))
  const [staleOnly, setStaleOnly] = useState(false)
  const [term, setTerm] = useState(pair ? '' : params.get('q') ?? '')
  const [pages, setPages] = useState(1)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<ExchangeRate | null>(null)
  const [deleting, setDeleting] = useState<ExchangeRate | null>(null)
  const [seeding, setSeeding] = useState<{ base: string; quote: string; as_of: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const search = useDebounced(term)

  const parsed = parseMoney(amount)
  const canConvert = parsed !== null && parsed !== 0 && base.length >= 2 && quote.length >= 2

  const result = useResource<ConvertResult>(canConvert ? FINANCE_PATHS.convert : null, {
    amount: parsed ?? undefined,
    base,
    quote,
    as_of: asOf,
  })
  const rates = useResource<PagedListResponse<ExchangeRate>>(FINANCE_PATHS.rates, {
    base: pairFilter ? base : undefined,
    quote: pairFilter ? quote : undefined,
    q: search || undefined,
    limit: PAGE * pages,
    offset: 0,
  })
  const currencies = useResource<ListResponse<CurrencyInfo>>(FINANCE_PATHS.currencies)

  const rows = rates.data?.items ?? []
  const total = rates.data?.total ?? 0
  const visible = staleOnly ? rows.filter((row) => row.stale) : rows
  const missing = rates.error?.status === 404 || currencies.error?.status === 404
  const noRate =
    result.error !== null &&
    result.error.status === 422 &&
    base !== quote

  // The deep link only names the pair on arrival; typing a new pair should not be fought.
  useEffect(() => {
    if (!pair) return
    setBase(pair.base)
    setQuote(pair.quote)
    setPairFilter(true)
  }, [pair])

  function refresh() {
    invalidate(...FINANCE_SCOPE)
    rates.reload()
    result.reload()
    currencies.reload()
  }

  async function sync() {
    setSyncing(true)
    setSyncNote(null)
    try {
      const res = await api<{ created: number; updated: number; source: string }>(
        `${FINANCE_PATHS.rates}/sync`,
        { method: 'POST' }
      )
      toastSuccess('Rates synced', {
        description: `${res.created} new, ${res.updated} updated from the configured source`,
      })
      setSyncNote(null)
      refresh()
    } catch (e) {
      const message = errorMessage(e)
      // 503 not_configured is an answer, not a failure: the module stays offline-first.
      setSyncNote(message)
      toastError('Sync unavailable', { description: message })
    } finally {
      setSyncing(false)
    }
  }

  function openNew(prefill?: { base: string; quote: string; as_of: string }) {
    setSeeding(prefill ?? null)
    setEditing(null)
    setDialog(true)
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Currency Converter</h1>
          <p className="os-micro mt-2">
            Every figure below comes from a rate row you stored. Nothing is fetched behind your back,
            nothing is rounded twice, and a currency with no minor unit is printed with no decimals.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void sync()} loading={syncing}>
            <RefreshCw /> Sync
          </Button>
          <Button size="sm" onClick={() => openNew()}>
            <Plus /> New rate
          </Button>
        </div>
      </header>

      {syncNote ? (
        <p className="os-micro -mt-1.5 flex flex-wrap items-center gap-2 text-warning">
          <span>{syncNote}</span>
          <button
            type="button"
            onClick={() => openNew({ base, quote, as_of: todayDate() })}
            className="text-foreground underline underline-offset-2"
          >
            add the rate by hand
          </button>
        </p>
      ) : null}

      {missing ? (
        <ErrorBlock
          error={rates.error ?? currencies.error}
          onRetry={refresh}
          title="This API has no Finance endpoints yet"
          className="border-line"
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="min-w-0 space-y-4">
            <Panel
              title="Convert"
              description="The answer carries the rate, its date and its age, so you can see what it was built from."
            >
              <div className="space-y-4">
                <AmountField
                  label="Amount"
                  id="convert-amount"
                  value={amount}
                  onChange={setAmount}
                  currency={base}
                  required
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <CurrencySelect
                    id="convert-base"
                    label="From"
                    value={base}
                    onChange={setBase}
                    required
                    hint={
                      minorUnits(base) === 0
                        ? 'no minor unit — whole units only'
                        : 'two decimal places'
                    }
                  />
                  <div className="flex items-end gap-2">
                    <CurrencySelect
                      id="convert-quote"
                      label="To"
                      value={quote}
                      onChange={setQuote}
                      required
                      className="min-w-0 flex-1"
                      hint={
                        minorUnits(quote) === 0
                          ? 'no minor unit — whole units only'
                          : 'two decimal places'
                      }
                    />
                    <IconButton
                      label="Swap the two currencies"
                      size="icon-sm"
                      variant="outline"
                      className="mb-6 shrink-0"
                      onClick={() => {
                        setBase(quote)
                        setQuote(base)
                      }}
                    >
                      <ArrowLeftRight className="size-3.5" />
                    </IconButton>
                  </div>
                </div>

                <Field
                  label="Rate on or before"
                  htmlFor="convert-as-of"
                  hint="A conversion is only ever made with a rate dated at or before this day."
                >
                  <Input
                    id="convert-as-of"
                    type="date"
                    value={asOf}
                    onChange={(event) => setAsOf(event.target.value)}
                  />
                </Field>

                {!canConvert ? (
                  <p className="os-micro">Enter an amount to see the converted figure.</p>
                ) : noRate ? (
                  <div className="space-y-2 border-t border-line-faint pt-3">
                    <p className="os-mono text-[12px] text-warning">
                      {errorMessage(result.error)}
                    </p>
                    <p className="os-micro">
                      The API will not guess one. Add the rate — from your bank statement, an invoice,
                      or any number you are willing to stand behind — and the conversion appears.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openNew({ base, quote, as_of: asOf })}
                    >
                      <Plus /> Add {base}→{quote}
                    </Button>
                  </div>
                ) : (
                  <div className="border-t border-line-faint pt-3">
                    <ResourceState
                      resource={result}
                      skeleton={<LoadingBlock rows={2} />}
                      empty={<p className="os-micro">Nothing to show yet.</p>}
                    >
                      {(r) => (
                        <div className="space-y-3">
                          <MoneyHero
                            label={`${formatMoney(r.amount, r.base)} in ${r.quote}`}
                            value={r.converted}
                            currency={r.quote}
                            hint={
                              <RateStrip
                                base={r.base}
                                quote={r.quote}
                                rate={r.rate}
                                asOf={r.as_of}
                                ageDays={r.age_days}
                                derived={r.derived}
                                stale={r.stale}
                              />
                            }
                          />
                          {r.derived ? (
                            <p className="os-micro">
                              Only the {r.quote}→{r.base} rate is stored, so this is its reciprocal —
                              the same number, read the other way round.
                            </p>
                          ) : null}
                          <p className="os-micro flex items-baseline justify-between gap-3 border-t border-line-faint pt-2">
                            <span className="text-faint">original</span>
                            <MoneyCell value={r.amount} currency={r.base} />
                          </p>
                        </div>
                      )}
                    </ResourceState>
                  </div>
                )}
              </div>
            </Panel>

            <RegistryPanel
              resource={currencies}
              onPick={(code) => {
                // A code you are already converting from swaps the pair; any other code
                // becomes the source. No guessing about which side the user meant.
                if (code === base) {
                  setBase(quote)
                  setQuote(code)
                } else {
                  setBase(code)
                }
              }}
            />
          </div>

          <Panel
            title="The rates you own"
            description={
              rates.data
                ? `${countLabel(rows.length, 'row', 'rows')} of ${total} loaded · newest first${
                    staleOnly ? ', showing only the rows the API calls stale' : ''
                  }`
                : 'Every pair stored in this workspace'
            }
            bodyClassName="px-0 py-0"
            action={
              <div className="flex items-center gap-2">
                <FilterChip
                  active={pairFilter}
                  onClick={() => {
                    setPairFilter((prev) => !prev)
                    setPages(1)
                  }}
                >
                  {base}→{quote} only
                </FilterChip>
                <FilterChip active={staleOnly} onClick={() => setStaleOnly((prev) => !prev)}>
                  Stale
                </FilterChip>
              </div>
            }
          >
            <div className="border-b border-line-faint px-4 py-2">
              <InlineSearch
                value={term}
                onChange={(next) => {
                  setTerm(next)
                  setPages(1)
                }}
                placeholder="Search a code or a source…"
              />
            </div>
            {rates.error && rates.data === undefined ? (
              <div className="px-3 py-3">
                <ErrorBlock error={rates.error} onRetry={rates.reload} />
              </div>
            ) : rates.loading && rates.data === undefined ? (
              <div className="px-3 py-3">
                <LoadingBlock rows={6} />
              </div>
            ) : visible.length === 0 ? (
              <div className="px-3 py-3">
                <EmptyBlock
                  title={
                    staleOnly
                      ? `None of the ${rows.length} rows loaded is stale`
                      : 'No rates stored for this pair'
                  }
                  description={
                    staleOnly
                      ? `Staleness is a flag the API puts on your own rows — it never replaces the number. Load more rows, or turn the filter off.`
                      : 'Add one by hand, or convert something and the converter will tell you exactly which pair is missing.'
                  }
                  icon={<Coins className="size-5" />}
                  action={
                    <Button size="sm" onClick={() => openNew({ base, quote, as_of: todayDate() })}>
                      <Plus /> New rate
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[9rem] pl-4">Pair</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="w-[9rem]">Dated</TableHead>
                      <TableHead className="w-[7rem]">Source</TableHead>
                      <TableHead className="w-16 pr-3" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <RateRow
                        key={row.id}
                        row={row}
                        onDelete={() => setDeleting(row)}
                        onUse={() => {
                          setBase(row.base)
                          setQuote(row.quote)
                          setAsOf(row.as_of)
                          setPairFilter(true)
                        }}
                        onEdit={() => {
                          setEditing(row)
                          setSeeding(null)
                          setDialog(true)
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
                <div className="px-4 pb-3 pt-2">
                  <LoadMore
                    loaded={rows.length}
                    total={total}
                    loading={rates.loading}
                    size={PAGE}
                    onMore={() => setPages((n) => n + 1)}
                    onReset={() => setPages(1)}
                  />
                  <p className="os-micro mt-2 text-faint">
                    a pair is stored one way round; the API reads the other direction as its
                    reciprocal and labels it as derived
                  </p>
                </div>
              </>
            )}
          </Panel>
        </div>
      )}

      <RateDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) {
            setEditing(null)
            setSeeding(null)
          }
        }}
        rate={editing}
        seed={seeding}
        currencies={currencies.data?.items ?? []}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete the ${deleting?.base ?? ''}→${deleting?.quote ?? ''} rate`}
        description="Conversions already made are not stored, so nothing else changes — a later conversion will fall back to the newest row before it, or ask you for a rate."
        confirmLabel="Delete rate"
        onConfirm={() =>
          api(`${FINANCE_PATHS.rates}/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Rate deleted')
            refresh()
          })
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------- pieces -- */

function RateRow({
  row,
  onUse,
  onEdit,
  onDelete,
}: {
  row: ExchangeRate
  onUse: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <TableRow id={`rate-${row.id}`}>
      <TableCell className="pl-4">
        <button
          type="button"
          onClick={onUse}
          title="Load this pair into the converter"
          className="os-tap-none -mx-1 block rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className="os-mono text-[12.5px] text-foreground">
            {row.base}
            <span className="text-faint"> → </span>
            {row.quote}
          </span>
        </button>
      </TableCell>
      <TableCell className="text-right">
        <span className="os-mono text-[12.5px] tabular-nums text-foreground">
          {formatRate(row.rate)}
        </span>
      </TableCell>
      <TableCell>
        <span className="os-micro flex items-baseline gap-2">
          <span className="os-mono tabular-nums text-muted-foreground">{formatDate(row.as_of)}</span>
          {row.age_days !== null && row.age_days !== undefined ? (
            <span className={cn(row.stale ? 'text-warning' : 'text-faint')}>
              {row.age_days}d
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell>
        <span className="os-micro">{row.provider ?? 'manual'}</span>
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label={`Correct the ${row.base}→${row.quote} rate`} size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`Delete the ${row.base}→${row.quote} rate`} size="icon-sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

function RegistryPanel({
  resource,
  onPick,
}: {
  resource: UseResourceResult<ListResponse<CurrencyInfo>>
  onPick: (code: string) => void
}) {
  const [term, setTerm] = useState('')
  const items = resource.data?.items ?? []
  const needle = term.trim().toUpperCase()
  const shown = needle
    ? items.filter(
        (item) =>
          item.code.includes(needle) ||
          (item.name ?? '').toUpperCase().includes(needle) ||
          item.symbol.includes(term.trim())
      )
    : items
  return (
    <Panel
      dense
      title="Currency registry"
      description="The codes this API accepts, with the rounding each one uses."
      action={
        <div className="w-40">
          <InlineSearch value={term} onChange={setTerm} placeholder="Filter codes" />
        </div>
      }
      bodyClassName="px-0 py-0"
    >
      {resource.error && resource.data === undefined ? (
        <div className="px-3 py-3">
          <ErrorBlock error={resource.error} onRetry={resource.reload} />
        </div>
      ) : resource.loading && resource.data === undefined ? (
        <div className="px-3 py-3">
          <LoadingBlock rows={4} />
        </div>
      ) : (
        <ul className="os-mono max-h-72 divide-y divide-line-faint overflow-y-auto text-[12px]">
          {shown.map((item) => (
            <li key={item.code} className="flex items-center gap-3 px-4 py-1.5">
              <button
                type="button"
                onClick={() => onPick(item.code)}
                className="w-12 shrink-0 text-left text-foreground underline-offset-2 hover:underline"
              >
                {item.code}
              </button>
              <span className="w-6 shrink-0 text-muted-foreground">{item.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.name}</span>
              <span className="shrink-0 text-faint">
                {item.minor_units === 0 ? '0 dp' : `${item.minor_units} dp`}
              </span>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="px-4 py-3 text-faint">No code matches “{term}”.</li>
          ) : null}
        </ul>
      )}
    </Panel>
  )
}

interface RateForm {
  base: string
  quote: string
  rate: string
  as_of: string
}

/**
 * A rate is a fact the user states, so the form is short: pair, number, date. The API
 * uppercases the codes, refuses a pair with itself, refuses 0 or less, and refuses a
 * duplicate `(base, quote, as_of)` — all three land here as field errors rather than a toast.
 */
function RateDialog({
  open,
  onOpenChange,
  rate,
  seed,
  currencies,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  rate: ExchangeRate | null
  seed: { base: string; quote: string; as_of: string } | null
  currencies: CurrencyInfo[]
  onSaved: () => void
}) {
  const editing = Boolean(rate?.id)
  const [values, setValues] = useState<RateForm>({
    base: 'USD',
    quote: 'INR',
    rate: '',
    as_of: todayDate(),
  })
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const left = values.base.trim().toUpperCase()
  const right = values.quote.trim().toUpperCase()
  const stated = parseMoney(values.rate)

  useEffect(() => {
    if (!open) return
    setValues(
      rate
        ? {
            base: rate.base,
            quote: rate.quote,
            rate: String(rate.rate),
            as_of: rate.as_of,
          }
        : {
            base: seed?.base ?? 'USD',
            quote: seed?.quote ?? 'INR',
            rate: '',
            as_of: seed?.as_of ?? todayDate(),
          }
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rate?.id, seed?.base, seed?.quote, seed?.as_of])

  const patch = (next: Partial<RateForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!left) next.base = 'The currency the rate is stated in'
    if (!right) next.quote = 'The currency it buys'
    if (left && right && left === right) {
      next.quote = 'A pair needs two different currencies'
    }
    if (left && currencies.length && !currencies.some((item) => item.code === left)) {
      next.base = `${left} is not in the registry — pick a code from the list on the page`
    }
    if (right && currencies.length && !currencies.some((item) => item.code === right)) {
      next.quote = `${right} is not in the registry — pick a code from the list on the page`
    }
    if (!values.rate.trim()) next.rate = 'Enter the rate'
    else if (stated === null) next.rate = 'Numbers only'
    else if (stated <= 0) next.rate = 'A rate of 0 or less would invert the ledger'
    else if ((values.rate.trim().split('.')[1]?.length ?? 0) > 6) {
      next.rate = 'Rates are stored to 6 decimal places'
    }
    if (!values.as_of) next.as_of = 'Pick the date the rate was true'
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: ExchangeRateInput = {
      base: left,
      quote: right,
      rate: stated ?? 0,
      as_of: values.as_of,
    }
    try {
      await api<ExchangeRate>(
        editing ? `${FINANCE_PATHS.rates}/${rate?.id}` : FINANCE_PATHS.rates,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Rate corrected' : 'Rate stored', {
        description: `${body.base}→${body.quote} ${body.rate} on ${body.as_of}`,
      })
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Correct a rate' : 'Store a rate'}
          description="Rates are yours: one row per pair per date, no provider needed, and a conversion always says which row it used."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Field label="Base" htmlFor="rate-base" required error={issues.base ?? null}>
              <Input
                id="rate-base"
                value={values.base}
                autoFocus
                maxLength={3}
                placeholder="USD"
                onChange={(event) => patch({ base: event.target.value.toUpperCase() })}
                className="os-mono uppercase"
                aria-invalid={Boolean(issues.base) || undefined}
              />
            </Field>
            <span className="os-mono pb-1 self-end text-muted-foreground" aria-hidden="true">
              →
            </span>
            <Field label="Quote" htmlFor="rate-quote" required error={issues.quote ?? null}>
              <Input
                id="rate-quote"
                value={values.quote}
                maxLength={3}
                placeholder="INR"
                onChange={(event) => patch({ quote: event.target.value.toUpperCase() })}
                className="os-mono uppercase"
                aria-invalid={Boolean(issues.quote) || undefined}
              />
            </Field>
          </div>

          <Field
            label="Rate"
            htmlFor="rate-value"
            required
            error={issues.rate ?? null}
            hint={`how much one ${left || 'BASE'} buys in ${right || 'QUOTE'} — up to 6 decimals`}
          >
            <Input
              id="rate-value"
              inputMode="decimal"
              value={values.rate}
              placeholder="83.2150"
              onChange={(event) => patch({ rate: event.target.value })}
              className="os-mono"
              aria-invalid={Boolean(issues.rate) || undefined}
            />
          </Field>

          <Field
            label="True on"
            htmlFor="rate-as-of"
            required
            error={issues.as_of ?? null}
            hint="A conversion uses the newest row dated on or before the day it is asked for."
          >
            <Input
              id="rate-as-of"
              type="date"
              value={values.as_of}
              onChange={(event) => patch({ as_of: event.target.value })}
              aria-invalid={Boolean(issues.as_of) || undefined}
            />
          </Field>

          <p className="os-micro border-t border-line-faint pt-3">
            {stated !== null && stated > 0 && left && right
              ? `1 ${left} = ${formatRate(stated)} ${right} — the converted figure is rounded once, in ${right}’s minor units`
              : 'Pick both codes and a rate to see how the row will read.'}
          </p>
        </DialogBody>
        <DialogFooter>
          <p className="os-micro mr-auto text-faint">
            {editing ? 'Correcting a stored row' : 'Duplicates of the same pair and date are refused'}
          </p>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save rate' : 'Store rate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
