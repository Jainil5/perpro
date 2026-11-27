'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, RefreshCw } from 'lucide-react'

import { DeltaTag, InOutBars, MoneyCell, MoneyHero, ShareList } from '@/components/os/finance'
import { Panel } from '@/components/os/ui/card'
import { Stat } from '@/components/os/ui/stats'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { Button, buttonVariants } from '@/components/os/ui/button'
import { EmptyBlock, ErrorBlock, SkeletonLines } from '@/components/os/states'
import { FINANCE_PATHS, type CurrencyInfo, type FinanceSummary } from '@/lib/os/finance'
import { useResource, useWorkspace } from '@/lib/os/hooks'
import type { ListResponse } from '@/lib/os/types'
import { formatMoney, moneyDelta, monthLabel, runwayLabel, type MoneyDelta } from '@/lib/os/currency'
import { countLabel, formatDate, relativeFuture } from '@/lib/os/format'
import { OS_NAV_GROUPS } from '@/lib/os/nav'
import { cn } from '@/lib/os/cn'

/**
 * Finance overview — every figure on this page is derived per request by
 * `GET /finance/summary` (`backend/app/services/money.py::finance_summary`). Nothing is stored,
 * nothing is added in the browser, and money in more than one currency is listed per code
 * instead of being silently blended (docs/MYOS/PHASE3_FINANCE.md §2 rule 3).
 */

/** href → the `counts` key that tells this module how many rows exist. */
const COUNT_KEY_BY_HREF: Record<string, keyof FinanceSummary['counts']> = {
  '/finance/income': 'income',
  '/finance/subscriptions': 'subscriptions',
  '/finance/services': 'services',
  '/finance/scenarios': 'scenarios',
  '/finance/expenses': 'expenses',
}

/** Nothing recorded anywhere: the whole module is waiting for a first row. */
function isEmpty(summary: FinanceSummary): boolean {
  const counts = summary.counts
  return (
    summary.income === 0 &&
    summary.expense === 0 &&
    Object.values(counts).every((value) => !value)
  )
}

/** Sentinel for the reader control: `as recorded` sends no `currency` at all. */
const AS_RECORDED = '__as_recorded'

export default function FinanceView() {
  const workspace = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const target = params.get('currency') || null
  const summary = useResource<FinanceSummary>(FINANCE_PATHS.summary, {
    currency: target ?? undefined,
  })
  const currencies = useResource<ListResponse<CurrencyInfo>>(FINANCE_PATHS.currencies)
  const currency = summary.data?.currency ?? workspace.data?.currency ?? 'INR'

  /** A query control, not a form field: it decides whether `?currency=` reaches the API. */
  function pickTarget(next: string | null) {
    const q = new URLSearchParams(params ? params.toString() : '')
    if (next) q.set('currency', next)
    else q.delete('currency')
    const query = q.toString()
    router.replace(query ? pathname + '?' + query : pathname, { scroll: false })
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Finance</h1>
          <p className="os-micro mt-2">
            {summary.data
              ? `${monthLabel(summary.data.month)} · ${
                  summary.data.currency ?? 'more than one currency'
                } · ${countLabel(summary.data.counts.expenses ?? 0, 'expense', 'expenses')} · ${countLabel(
                  summary.data.counts.income ?? 0,
                  'income entry'
                )}`
              : 'Derived from your own rows — no paid rate service, no external account links'}
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-2">
          <span className="flex min-w-0 flex-col gap-1">
            <label htmlFor="finance-target" className="os-label">
              Read totals in
            </label>
            <Select
              value={target ?? AS_RECORDED}
              onValueChange={(next) => pickTarget(next === AS_RECORDED ? null : next)}
            >
              <SelectTrigger id="finance-target" size="sm" className="w-[9.5rem] rounded-os">
                <SelectValue placeholder="As recorded" />
              </SelectTrigger>
              <SelectContent>
                <Option value={AS_RECORDED}>As recorded</Option>
                {(currencies.data?.items ?? []).map((row) => (
                  <Option key={row.code} value={row.code}>
                    {row.code} — {row.name}
                  </Option>
                ))}
              </SelectContent>
            </Select>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent"
            onClick={summary.reload}
            disabled={summary.loading}
          >
            <RefreshCw /> Recompute
          </Button>
        </div>
      </header>

      {summary.data && summary.data.currency === null && !target ? (
        <p className="os-micro -mt-1 text-warning">
          These rows are in {summary.data.by_currency.length} currencies, so every headline is
          left untotalled. Choose{' '}
          <span className="os-mono">Read totals in</span> above and the API adds them through the
          rates you stored — the conversion is never guessed and never done on this page.
        </p>
      ) : null}

      {summary.error && summary.data === undefined ? (
        <ErrorBlock error={summary.error} onRetry={summary.reload} />
      ) : summary.loading && summary.data === undefined ? (
        <FinanceSkeleton />
      ) : summary.data ? (
        isEmpty(summary.data) ? (
          <FinanceEmpty currency={currency} />
        ) : (
          <Summary
            s={summary.data}
            currency={currency}
            preferred={workspace.data?.currency ?? null}
            onPick={pickTarget}
          />
        )
      ) : null}

      <ModuleLauncher counts={summary.data?.counts ?? {}} />
    </div>
  )
}

/* ------------------------------------------------------------------ summary -- */

function Summary({
  s,
  currency,
  preferred,
  onPick,
}: {
  s: FinanceSummary
  currency: string
  preferred: string | null
  onPick: (next: string | null) => void
}) {
  /* The change is measured against the overview's own rolling series, one entry back — the
   * server's month, not a sum of this page's rows. */
  const prior = s.income_by_month.length > 1 ? s.income_by_month.at(-2) ?? null : null
  const incomeDelta = moneyDelta(s.income, prior?.income ?? null)
  const spendDelta = moneyDelta(s.expense, prior?.expense ?? null)
  const netDelta: MoneyDelta = moneyDelta(s.net, prior?.net ?? null)
  const priorLabel = prior ? monthLabel(prior.month) : null
  const live = s.by_currency.filter(
    (row) => (row.income ?? 0) !== 0 || (row.expense ?? 0) !== 0
  )
  /* A book with more than one code comes back `currency: null`, and a null currency travels with
   * null money (§2.3): every figure that would need a rate is `null`, so it renders as a dash and
   * this page explains why instead of guessing a code through `Read totals in`. */
  const unnamedCodes = live.map((row) => row.currency)

  return (
    <>
      <section className="os-panel min-w-0 px-4 py-4">
        <div className="grid min-w-0 items-start gap-y-5 sm:grid-cols-[minmax(0,1.1fr)_auto]">
          <MoneyHero
            label={`Net for ${monthLabel(s.month)}`}
            value={s.net}
            currency={s.currency}
            delta={netDelta}
            hint={
              s.currency === null ? (
                <span className="text-warning">
                  this month holds more than one currency, so no single total is named — the split
                  by code is below
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {formatMoney(s.income, s.currency, { compact: true })} in ·{' '}
                  {formatMoney(s.expense, s.currency, { compact: true })} out
                  {priorLabel ? ` · change against ${priorLabel}` : ''}
                </span>
              )
            }
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-line sm:border-l sm:pl-6 md:grid-cols-3">
            <Stat
              label="Runway"
              value={runwayLabel(s.runway_months, {
                named: s.currency !== null,
                burn: s.monthly_burn,
                cash: s.cash_in_90d,
              })}
            />
            <Stat
              label="Monthly burn"
              value={formatMoney(s.monthly_burn, s.currency, { compact: true })}
            />
            <Stat
              label="Avg income · 3mo"
              value={formatMoney(s.monthly_income_avg_3m, s.currency, { compact: true })}
            />
            <Stat label="MRR" value={formatMoney(s.mrr, s.currency, { compact: true })} />
            <Stat
              label="Receivables"
              value={formatMoney(s.receivables, s.currency, { compact: true })}
            />
            <Stat
              label="Overdue income"
              value={formatMoney(s.overdue_income, s.currency, { compact: true })}
              tone={s.overdue_income && s.overdue_income > 0 ? 'danger' : 'default'}
            />
          </div>
        </div>
        {s.currency === null ? (
          <p className="os-micro mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-warning">
            <span>
              {`This month is recorded in ${
                unnamedCodes.join(' and ') || 'no code yet'
              }. Nothing is merged behind your back: every figure that would need a rate is a dash until you name one code, and the split by currency is below.`}
            </span>
            {preferred ? (
              <button
                type="button"
                onClick={() => onPick(preferred)}
                className="os-label shrink-0 rounded-os border border-line px-2 py-1 text-[10px] uppercase tracking-wide text-foreground transition-colors duration-150 hover:border-line-strong hover:bg-canvas-deep"
              >
                {`Read it in ${preferred}`}
              </button>
            ) : (
              <span className="os-mono shrink-0">name a currency above</span>
            )}
          </p>
        ) : null}
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          dense
          title="Cash by month"
          description="Income above the line, spend below it, one scale for both — a bad month is a taller bar, not a different colour."
        >
          {s.income_by_month.length < 2 ? (
            <p className="os-micro">
              Not enough history to draw a curve yet — the bars need two months of rows.
            </p>
          ) : (
            <InOutBars series={s.income_by_month} currency={s.currency} />
          )}
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line-faint pt-3 sm:grid-cols-4">
            <Figure label="Income this month" value={s.income} currency={s.currency} delta={incomeDelta} />
            <Figure
              label="Spend this month"
              value={s.expense}
              currency={s.currency}
              delta={spendDelta}
              goodWhen="down"
            />
            <Figure label="ARR run-rate" value={s.arr} currency={s.currency} />
            <Figure label="Cash waiting" value={s.receivables} currency={s.currency} />
          </div>
        </Panel>

        <Panel
          dense
          title="Where it went"
          description={
            live.length > 1
              ? 'This month holds more than one currency, so the split is stated per code and never merged.'
              : s.currency === null
                ? `Share of ${monthLabel(s.month)} spend — there is nothing to total yet.`
                : `Share of ${monthLabel(s.month)} spend, in ${s.currency}.`
          }
          action={
            <Link
              href="/finance/expenses"
              className="os-label inline-flex items-center gap-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Expenses <ArrowRight className="size-3" />
            </Link>
          }
        >
          <ShareList
            rows={s.expense_by_category.map((row) => ({
              id: row.category_id,
              label: row.name,
              color: row.color,
              value: row.amount,
            }))}
            currency={s.currency}
            total={s.expense}
            emptyLabel="No spend recorded in this month yet."
          />
        </Panel>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel
          dense
          title="Renewing this month"
          description="Commitments the API can see from their own renewal dates."
          action={
            <Link
              href="/finance/subscriptions"
              className="os-label inline-flex items-center gap-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Subscriptions <ArrowRight className="size-3" />
            </Link>
          }
        >
          {s.renewing_this_month.length ? (
            <ul className="min-w-0 divide-y divide-line-faint">
              {s.renewing_this_month.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
                  <span className="min-w-0">
                    <Link
                      href={`/finance/subscriptions?sub=${row.id}`}
                      className="block min-w-0 truncate text-[12.5px] text-foreground underline-offset-2 hover:underline"
                    >
                      {row.label}
                    </Link>
                    <span className="os-micro">
                      {formatDate(row.renews_on)}
                      {row.days_until != null ? ` · ${relativeFuture(row.renews_on)}` : ''}
                    </span>
                  </span>
                  <MoneyCell value={row.amount} currency={row.currency} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-micro">Nothing renews inside this month.</p>
          )}
        </Panel>

        <Panel dense title="Money by currency" description="A total across codes would need a rate, so the codes stay apart.">
          {live.length > 1 ? (
            <table className="w-full min-w-0">
              <thead>
                <tr className="os-label border-b border-line-faint text-left">
                  <th className="pb-1.5 font-medium">Code</th>
                  <th className="pb-1.5 text-right font-medium">In</th>
                  <th className="pb-1.5 text-right font-medium">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {live.map((row) => (
                  <tr key={row.currency}>
                    <td className="os-mono py-1.5 text-[12.5px] text-foreground">{row.currency}</td>
                    <td className="py-1.5 text-right">
                      <MoneyCell value={row.income} currency={row.currency} sign="never" />
                    </td>
                    <td className="py-1.5 text-right">
                      <MoneyCell
                        value={row.expense}
                        currency={row.currency}
                        sign="never"
                        tone="text-muted-foreground"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="os-micro">
              {s.currency
                ? `Everything recorded is in ${s.currency} — no rate is needed to total it.`
                : `Nothing is recorded yet, so there is no currency to total in.`}
            </p>
          )}
          {s.stale_rates.length ? (
            <ul className="mt-3 min-w-0 space-y-1 border-t border-line-faint pt-3">
              {s.stale_rates.map((rate) => (
                <li key={`${rate.base}${rate.quote}`} className="os-micro flex items-baseline justify-between gap-3">
                  <Link
                    href={`/finance/currency?pair=${rate.base}${rate.quote}`}
                    className="min-w-0 truncate text-warning underline underline-offset-2 hover:text-foreground"
                  >
                    {rate.base}→{rate.quote} rate is older than 30 days ({formatDate(rate.as_of)})
                  </Link>
                  <span className="os-mono shrink-0">{rate.age_days}d</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>

      <Panel dense title="Biggest vendors" description="Who the money actually went to, this month.">
        {s.top_vendors.length ? (
          <ul className="grid min-w-0 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {s.top_vendors.map((vendor) => (
              <li
                key={vendor.vendor}
                className="flex items-baseline justify-between gap-3 border-b border-line-faint pb-1.5"
              >
                <Link
                  href={`/finance/expenses?q=${encodeURIComponent(vendor.vendor)}`}
                  className="min-w-0 truncate text-[12.5px] text-foreground underline-offset-2 hover:underline"
                >
                  {vendor.vendor}
                </Link>
                <span className="flex shrink-0 items-baseline gap-2">
                  <MoneyCell value={vendor.amount} currency={currency} />
                  <span className="os-micro">{countLabel(vendor.count, 'entry', 'entries')}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-micro">
            No vendor named yet — the Expenses screen asks for one on every row you log.
          </p>
        )}
      </Panel>
    </>
  )
}

function Figure({
  label,
  value,
  currency,
  delta,
  goodWhen = 'up',
}: {
  label: string
  value: number | null
  currency: string | null
  delta?: MoneyDelta
  goodWhen?: 'up' | 'down'
}) {
  return (
    <div className="min-w-0">
      <p className="os-label">{label}</p>
      <p className="os-mono mt-1 text-[15px] leading-none tabular-nums text-foreground">
        {formatMoney(value, currency, { compact: true })}
      </p>
      {delta ? (
        <span className="os-micro mt-1 flex items-center gap-1">
          <DeltaTag delta={delta} goodWhen={goodWhen} />
        </span>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- extras -- */

/**
 * The six Finance destinations, taken from the sidebar model itself, so this launcher can
 * never list a screen the nav does not already link to.
 */
function ModuleLauncher({ counts }: { counts: FinanceSummary['counts'] }) {
  const items = OS_NAV_GROUPS.find((group) => group.title === 'Finance')?.items ?? []
  return (
    <nav aria-label="Finance modules" className="os-panel min-w-0 px-4 py-3">
      <ul className="grid min-w-0 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const key = item.href ? COUNT_KEY_BY_HREF[item.href] : undefined
          const count = key ? counts[key] : undefined
          const Icon = item.icon
          return (
            <li key={item.label}>
              <Link
                href={item.href ?? '/finance'}
                className="os-tap-none -mx-1 flex items-baseline justify-between gap-3 rounded-os px-1 py-1 transition-colors duration-150 hover:bg-canvas-deep focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-faint" strokeWidth={1.25} />
                  <span className="min-w-0 truncate text-[12.5px] text-foreground">{item.label}</span>
                </span>
                <span className="os-mono shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {count === undefined || count === null ? '' : count}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function FinanceSkeleton() {
  return (
    <div className="min-w-0 space-y-4" aria-busy="true">
      <div className="os-panel px-4 py-5">
        <SkeletonLines rows={2} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="os-panel px-4 py-5">
          <SkeletonLines rows={6} />
        </div>
        <div className="os-panel px-4 py-5">
          <SkeletonLines rows={6} />
        </div>
      </div>
    </div>
  )
}

function FinanceEmpty({ currency }: { currency: string }) {
  return (
    <EmptyBlock
      title="No money recorded yet"
      description={`The overview derives every figure from your own rows: log an expense or an income entry and the curve, the runway and the category split fill in. Nothing is fetched from a paid service, and ${currency} is only the default code for new rows.`}
      icon={<RefreshCw className="size-5" />}
      action={
        <>
          <Link href="/finance/expenses" className={cn(buttonVariants({ size: 'sm' }))}>
            Log an expense
          </Link>
          <Link
            href="/finance/income"
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'bg-transparent')}
          >
            Calculate take-home
          </Link>
          <Link href="/settings" className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }))}>
            Seed demo data
          </Link>
        </>
      }
    />
  )
}
