'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Building2, Columns3, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, readLocal, useDebounced, useEnums, useResource, useWorkspace, writeLocal } from '@/lib/os/hooks'
import {
  CLIENT_HEALTH,
  CLIENT_DEFAULT_DIR,
  CLIENT_SORTS,
  CLIENT_STAGES,
  clientPath,
  CRM_PATHS,
  CRM_SCOPE,
  mergeTally,
  renewalBuckets,
  sumMrrByCurrency,
  tagCounts,
  type Client,
  type ClientSort,
  type ClientStage,
  type TallyEntry,
} from '@/lib/os/crm'
import { formatMoney } from '@/lib/os/currency'
import { countLabel, enumLabel, formatDate, plural } from '@/lib/os/format'
import type { PagedListResponse } from '@/lib/os/types'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
import {
  FilterBar,
  FilterChip,
  InlineSearch,
  LoadMore,
  SortSelect,
  ViewToggle,
} from '@/components/os/filters'
import { HealthDisc, PipelineBoard, TallyFigures } from '@/components/os/pipeline'
import { MicroData } from '@/components/os/marks'
import { Panel } from '@/components/os/ui/card'
import { EnumSelect } from '@/components/os/pickers'
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
import { SortHeader } from '@/components/os/finance'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { ClientDialog } from './ClientDialog'
import { ClientDetail } from './ClientDetail'

const PAGE = 100
const VIEW_KEY = 'os.customers.view'

type Mode = 'table' | 'board'
type Dir = 'asc' | 'desc'

/** The board columns are the whole enum: an account has no illegal move, so nothing sits off it. */
const COLUMNS: Array<{ status: ClientStage; hint: string }> = [
  { status: 'onboarding', hint: 'Signed, not running yet' },
  { status: 'active', hint: 'Delivering and billing' },
  { status: 'at_risk', hint: 'Payment or attention slipping' },
  { status: 'churned', hint: 'Stopped, kept for the maths' },
  { status: 'archived', hint: 'Closed and out of the book' },
]

/**
 * The account book: who pays you, how much, and when the contract moves.
 *
 * Two rules shape everything here. Money is only ever read per currency — `sumMrrByCurrency` adds
 * same-code figures and `mergeTally` counts the ones it cannot name instead of guessing at a rate —
 * and an account has no state machine: `stage` and `health` are ordinary fields written by
 * `PATCH /clients/{id}`, so a board move is a field update, not a transition the API can refuse.
 * The revenue itself is never typed in: `mrr` is derived from the account's live subscriptions, so
 * the way to change it is under Money.
 */
export default function CustomersView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const currency = workspace.data?.currency ?? 'INR'

  const [mode, setMode] = useState<Mode>(() => readLocal<Mode>(VIEW_KEY, 'table'))
  const [stage, setStage] = useState<string>(() => params.get('stage') ?? 'all')
  const [health, setHealth] = useState<string>(() => params.get('health') ?? 'all')
  const [tag, setTag] = useState<string>(() => params.get('tag') ?? 'all')
  const [term, setTerm] = useState(() => params.get('q') ?? '')
  const [sort, setSort] = useState<ClientSort>('mrr')
  const [dir, setDir] = useState<Dir>('desc')
  const [pages, setPages] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(() => params.get('client'))
  const [dialog, setDialog] = useState<{ open: boolean; row: Client | null }>({
    open: false,
    row: null,
  })
  const [deleting, setDeleting] = useState<Client | null>(null)

  const urlString = params.toString()
  // A link from a notification, ⌘K or the CRM rail has to move the filters, not just the first render.
  useEffect(() => {
    const next = new URLSearchParams(urlString)
    const rawQ = next.get('q')
    if (rawQ !== null) setTerm(rawQ)
    for (const [key, apply] of [
      ['stage', setStage],
      ['health', setHealth],
      ['tag', setTag],
    ] as const) {
      const raw = next.get(key)
      if (raw !== null) apply(raw || 'all')
    }
    const client = next.get('client')
    if (client !== null) setDetailId(client || null)
  }, [urlString])

  const q = useDebounced(term.trim(), 300)

  // Naming the workspace currency is what lets a mixed book still answer with one monthly figure;
  // the per-currency rail below is what the single number is made of.
  const clients = useResource<PagedListResponse<Client>>(CRM_PATHS.clients, {
    stage: stage === 'all' ? undefined : stage,
    health: health === 'all' ? undefined : health,
    tag: tag === 'all' ? undefined : tag,
    q: q || undefined,
    currency,
    sort,
    dir,
    limit: PAGE * pages,
    offset: 0,
  })

  const rows = clients.data?.items ?? []
  const total = clients.data?.total ?? 0
  const missing = clients.error?.status === 404
  const filtersOn = stage !== 'all' || health !== 'all' || tag !== 'all' || q.length > 0

  const renewals = useMemo(() => renewalBuckets(rows), [rows])
  const monthly = useMemo(() => sumMrrByCurrency(rows), [rows])
  const monthlyUnnamed = useMemo(
    () =>
      rows.filter(
        (row) => row.mrr !== null && row.mrr !== undefined && !row.currency
      ).length,
    [rows]
  )
  const monthlyMissing = useMemo(
    () => rows.filter((row) => row.mrr === null || row.mrr === undefined).length,
    [rows]
  )
  const lifetime = useMemo(() => mergeTally(rows.map((row) => row.lifetime_value)), [rows])
  const owed = useMemo(() => mergeTally(rows.map((row) => row.open_receivables)), [rows])
  const tags = useMemo(() => tagCounts(rows), [rows])
  const atRisk = useMemo(() => rows.filter((row) => row.stage === 'at_risk').length, [rows])

  const setModeAndRemember = useCallback((next: string) => {
    setMode(next as Mode)
    writeLocal(VIEW_KEY, next)
  }, [])

  function pickSort(next: ClientSort) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(CLIENT_DEFAULT_DIR[next] ?? 'asc')
    setPages(1)
  }

  /** A stage is a field, so every column is a legal target and the API simply writes it. */
  async function setStageOf(row: Client, next: string) {
    setBusyId(row.id)
    try {
      await api<Client>(clientPath(row.id), { method: 'PATCH', body: { stage: next as ClientStage } })
      invalidate(...CRM_SCOPE)
      toastSuccess(`${row.name || 'Account'} → ${enumLabel(next)}`)
      clients.reload()
    } catch (error) {
      toastError('The API refused that stage', { description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  function refresh() {
    clients.reload()
  }

  function clearFilters() {
    setStage('all')
    setHealth('all')
    setTag('all')
    setTerm('')
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Customers</p>
          <h1 className="os-title mt-0.5">Account book</h1>
          <p className="os-micro mt-2">
            {clients.loading && !clients.data
              ? 'Loading…'
              : `${countLabel(rows.length, 'account')} shown of ${total} · money is read per currency and never added across codes`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Reload the accounts" onClick={refresh}>
            <RefreshCw className={cn('size-3.5', clients.loading ? 'animate-spin' : null)} />
          </IconButton>
          <Button onClick={() => setDialog({ open: true, row: null })}>
            <Plus /> New account
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------ the book at a glance */}
      <section className="os-panel min-w-0 px-4 py-3">
        <ResourceState
          resource={clients}
          skeleton={
            <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-3 sm:grid-cols-4">
              <LoadingBlock rows={2} />
            </div>
          }
        >
          {() => (
            <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-4 sm:grid-cols-4">
              <Stat label="Accounts" value={total} />
              <Stat
                label="At risk"
                value={atRisk}
                tone={atRisk ? 'warning' : 'default'}
              />
              <Stat
                label="Renewals due"
                value={renewals.reminding.length}
                tone={renewals.reminding.length ? 'warning' : 'default'}
              />
              <Stat
                label="Contracts run out"
                value={renewals.expired.length}
                tone={renewals.expired.length ? 'danger' : 'default'}
              />
            </div>
          )}
        </ResourceState>
        <p className="os-micro mt-3 text-faint">
          renewal counts are of the rows on this page ({plural(rows.length, 'account')}); the money
          totals below are the same rows, so widen the filters before reading them as the whole book
        </p>
      </section>

      <FilterBar>
        <FilterChip active={stage === 'all'} onClick={() => setStage('all')}>
          All
        </FilterChip>
        {(enums.client_stage ?? CLIENT_STAGES).map((value) => (
          <FilterChip key={value} active={stage === value} onClick={() => setStage(value)}>
            {enumLabel(value)}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line lg:block" />
        <span className="os-label shrink-0">Health</span>
        <EnumSelect
          id="customers-health"
          value={health}
          onChange={setHealth}
          options={['all', ...(enums.client_health ?? CLIENT_HEALTH)]}
          className="w-[8.5rem] shrink-0"
        />
        {tags.length ? (
          <>
            <span className="os-label shrink-0">Tag</span>
            <EnumSelect
              id="customers-tag"
              value={tag}
              onChange={setTag}
              options={['all', ...tags.map((item) => item.tag)]}
              className="w-[9.5rem] shrink-0"
            />
          </>
        ) : null}
        <InlineSearch
          value={term}
          onChange={(next) => {
            setTerm(next)
            setPages(1)
          }}
          placeholder="Search accounts, notes and tags…"
          className="min-w-[10rem] flex-1"
        />
        <SortSelect
          value={sort}
          onChange={(next) => pickSort(next as ClientSort)}
          options={CLIENT_SORTS}
          label="Sort accounts"
        />
        <ViewToggle
          value={mode}
          onChange={setModeAndRemember}
          options={[
            { value: 'table', label: 'Table', icon: <Building2 /> },
            { value: 'board', label: 'Stages', icon: <Columns3 /> },
          ]}
        />
      </FilterBar>

      {missing ? (
        <ErrorBlock
          error={clients.error}
          onRetry={refresh}
          title="This API has no customer endpoints yet"
          className="border-line"
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <SoftError error={clients.error} />
            {clients.loading && clients.data === undefined ? (
              <LoadingBlock rows={6} label="Loading the accounts…" />
            ) : rows.length === 0 ? (
              <EmptyBlock
                title={filtersOn ? 'Nothing matches this filter' : 'No accounts yet'}
                description={
                  filtersOn
                    ? 'Filters run on the API, so this is the real result set — clear them and the rows are there.'
                    : 'An account is created by winning a lead, or by hand from a person or a company. Its monthly revenue comes from its own live subscriptions, so nothing here is typed twice.'
                }
                icon={<Building2 />}
                action={
                  <>
                    <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
                      <Plus /> New account
                    </Button>
                    {filtersOn ? (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : null}
                    <Link href="/crm" className="os-micro underline underline-offset-2">
                      win a lead instead
                    </Link>
                  </>
                }
              />
            ) : mode === 'board' ? (
              <Panel
                dense
                title="Accounts by stage"
                description="Drag a card, or use the arrows on it — a stage is a field, so the API writes it and refuses nothing"
                bodyClassName="px-2 py-2"
              >
                <PipelineBoard
                  columns={COLUMNS}
                  rows={rows}
                  idOf={(row) => row.id}
                  statusOf={(row) => row.stage}
                  busyId={busyId}
                  loading={clients.loading}
                  onMove={(row, next) => void setStageOf(row, next)}
                  onOpen={(row) => setDetailId(row.id)}
                  card={(row) => <ClientCard row={row} currency={currency} />}
                />
              </Panel>
            ) : (
              <Panel
                dense
                title="Every account"
                description="Click an account for its contract, receivables and diary. Sorting and filtering happen on the API."
                bodyClassName="px-0 py-0"
              >
                <ClientTable
                  rows={rows}
                  currency={currency}
                  sort={sort}
                  dir={dir}
                  onSort={pickSort}
                  onOpen={(row) => setDetailId(row.id)}
                />
                <div className="px-4 pb-3 pt-2">
                  <LoadMore
                    loaded={rows.length}
                    total={total}
                    loading={clients.loading}
                    size={PAGE}
                    onMore={() => setPages((n) => n + 1)}
                    onReset={() => setPages(1)}
                  />
                </div>
              </Panel>
            )}
          </div>

          {/* ------------------------------------------------------------- right rail */}
          <div className="min-w-0 space-y-4">
            <Panel
              dense
              title="What the book is worth"
              description={`Derived from live subscriptions · single figure converted to ${currency} where needed`}
            >
              <div className="min-w-0 space-y-3">
                <MoneyBlock
                  label="Monthly recurring"
                  entries={monthly}
                  unnamed={monthlyUnnamed}
                  note={
                    monthlyMissing
                      ? `${monthlyMissing} of these accounts have no live subscription, so they add nothing to a monthly figure`
                      : null
                  }
                />
                <div className="border-t border-line-faint pt-2">
                  <MoneyBlock label="Lifetime received" entries={lifetime.entries} unnamed={lifetime.unnamed} />
                </div>
                <div className="border-t border-line-faint pt-2">
                  <MoneyBlock label="Open receivables" entries={owed.entries} unnamed={owed.unnamed} />
                </div>
                <p className="os-micro text-faint">
                  nothing here is an average or a rate guess: {plural(rows.length, 'account')} on
                  this page, each code summed on its own
                </p>
              </div>
            </Panel>

            <Panel
              dense
              title="Contract clock"
              description="Sorted by whichever date is nearest"
            >
              {renewals.expired.length || renewals.reminding.length ? (
                <ul className="min-w-0 divide-y divide-line">
                  {renewals.expired.map((row) => (
                    <RenewalLine key={row.id} row={row} tone="danger" onOpen={() => setDetailId(row.id)} />
                  ))}
                  {renewals.reminding.map((row) => (
                    <RenewalLine
                      key={row.id}
                      row={row}
                      tone="warning"
                      onOpen={() => setDetailId(row.id)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="os-micro">
                  Nothing is due. An account without an end date never appears here, so undated
                  contracts are the one way to miss a renewal.
                </p>
              )}
            </Panel>

            <Panel
              dense
              title="Where the money comes from"
              description="Ranked here over the rows loaded — the API sorts an MRR page, not a whole book"
            >
              {rows.length ? (
                <TopAccounts rows={rows} currency={currency} onOpen={(row) => setDetailId(row.id)} />
              ) : (
                <p className="os-micro">No accounts to rank yet.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      <ClientDialog
        open={dialog.open}
        onOpenChange={(next) => setDialog((prev) => ({ ...prev, open: next }))}
        row={dialog.row}
        tagSuggestions={tags.map((item) => item.tag)}
        onSaved={(saved, created) => {
          refresh()
          if (created) setDetailId(saved.id)
        }}
      />

      <ClientDetail
        id={detailId}
        currency={currency}
        open={Boolean(detailId)}
        onOpenChange={(next) => {
          if (next) return
          setDetailId(null)
          refresh()
        }}
        onEdit={(row) => {
          setDetailId(null)
          setDialog({ open: true, row })
        }}
        onRequestDelete={(row) => {
          setDetailId(null)
          setDeleting(row)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name || 'account'}”`}
        description="The account row goes, and with it its contract window and diary. Subscriptions and income keep their own rows — their account link simply becomes empty — so this is not the same as churning a client."
        confirmLabel="Delete account"
        onConfirm={() =>
          api(clientPath(deleting?.id ?? ''), { method: 'DELETE' }).then(() => {
            invalidate(...CRM_SCOPE)
            toastSuccess('Account deleted', { description: deleting?.name })
            refresh()
          })
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------- pieces -- */

/**
 * One figure block: the per-currency list the API answered, plus the count the money rules would
 * not let me add up. A null amount is a missing answer, not zero, and it is reported instead of
 * being quietly folded into another code.
 */
function MoneyBlock({
  label,
  entries,
  unnamed,
  note,
}: {
  label: string
  entries: TallyEntry[]
  unnamed: number
  note?: string | null
}) {
  return (
    <div className="min-w-0">
      <p className="os-label">{label}</p>
      <TallyFigures entries={entries} emptyLabel="Nothing in this book yet." />
      {unnamed ? (
        <p className="os-micro mt-1 text-warning">
          {unnamed} figures arrived with no currency code — left out of the total rather than
          converted at a guess
        </p>
      ) : null}
      {note ? <p className="os-micro mt-1 text-faint">{note}</p> : null}
    </div>
  )
}

function RenewalLine({
  row,
  tone,
  onOpen,
}: {
  row: Client
  tone: 'danger' | 'warning'
  onOpen: () => void
}) {
  const days = row.days_to_contract_end ?? 0
  return (
    <li className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="os-tap-none min-w-0 flex-1 truncate text-left text-[13px] text-foreground underline-offset-2 hover:underline"
        >
          {row.name || 'Untitled account'}
        </button>
        <span className={cn('os-mono shrink-0 text-[11px] tabular-nums', tone === 'danger' ? 'text-danger' : 'text-warning')}>
          {days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
        </span>
      </div>
      <MicroData
        items={[
          row.contract_end ? `ends ${formatDate(row.contract_end)}` : null,
          row.renewal_reminder_days === null || row.renewal_reminder_days === undefined
            ? 'no reminder set'
            : `warns ${row.renewal_reminder_days}d ahead`,
          enumLabel(row.stage),
        ]}
      />
    </li>
  )
}

/** The book ranked by what it pays, with the health disc doing the talking. */
function TopAccounts({
  rows,
  currency,
  onOpen,
}: {
  rows: Client[]
  currency: string
  onOpen: (row: Client) => void
}) {
  const ranked = rows
    .filter((row) => row.mrr !== null && row.mrr !== undefined)
    .slice()
    .sort((a, b) => (b.mrr ?? 0) - (a.mrr ?? 0))
    .slice(0, 6)
  if (!ranked.length) {
    return (
      <p className="os-micro">
        No account has a live subscription, so nothing has a monthly figure yet.
      </p>
    )
  }
  const widest = Math.max(1, ...ranked.map((row) => row.mrr ?? 0))
  return (
    <ul className="min-w-0 space-y-1.5">
      {ranked.map((row) => (
        <li key={row.id} className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="os-tap-none min-w-0 flex-1 truncate text-left text-[12.5px] text-foreground underline-offset-2 hover:underline"
          >
            {row.name || 'Untitled account'}
          </button>
          <span
            className="h-[3px] shrink-0 rounded-none bg-foreground/70"
            style={{ width: `${Math.max(6, ((row.mrr ?? 0) / widest) * 100)}%` }}
            aria-hidden
          />
          <span className="os-mono shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatMoney(row.mrr ?? 0, row.currency ?? currency, { compact: true })}
          </span>
          <HealthDisc health={row.health} />
        </li>
      ))}
    </ul>
  )
}

function ClientCard({ row, currency }: { row: Client; currency: string }) {
  const days = row.days_to_contract_end
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground">
          {row.name || 'Untitled account'}
        </p>
        <HealthDisc health={row.health} className="mt-0.5" />
      </div>
      <p className="os-micro truncate">
        {row.company?.name ?? row.contact?.name ?? 'not linked to a person yet'}
      </p>
      <p className="os-mono truncate text-[11px] tabular-nums text-muted-foreground">
        {row.mrr === null || row.mrr === undefined
          ? 'no live subscription'
          : `${formatMoney(row.mrr, row.currency ?? currency, { compact: true })}/mo`}
      </p>
      {row.contract_end ? (
        <p
          className={cn(
            'os-micro truncate',
            days !== null && days !== undefined && days <= 0
              ? 'text-danger'
              : days !== null && days !== undefined && days <= 30
                ? 'text-warning'
                : 'text-faint'
          )}
        >
          {days !== null && days !== undefined && days <= 0
            ? `contract ran out ${Math.abs(days)}d ago`
            : `renews ${formatDate(row.contract_end)}`}
        </p>
      ) : (
        <p className="os-micro text-faint">no contract dates</p>
      )}
    </div>
  )
}

function ClientTable({
  rows,
  currency,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  rows: Client[]
  currency: string
  sort: ClientSort
  dir: Dir
  onSort: (next: ClientSort) => void
  onOpen: (row: Client) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[15rem] pl-4">
            <SortHeader active={sort === 'name'} dir={dir} onClick={() => onSort('name')}>
              Account
            </SortHeader>
          </TableHead>
          <TableHead className="w-[8rem]">
            <span className="os-label">Stage</span>
          </TableHead>
          <TableHead className="w-[8.5rem] text-right">
            <SortHeader active={sort === 'mrr'} dir={dir} onClick={() => onSort('mrr')} align="right">
              Monthly
            </SortHeader>
          </TableHead>
          <TableHead className="w-[11rem]">
            <SortHeader active={sort === 'contract_end'} dir={dir} onClick={() => onSort('contract_end')}>
              Contract
            </SortHeader>
          </TableHead>
          <TableHead className="w-[7rem]">
            <SortHeader active={sort === 'created'} dir={dir} onClick={() => onSort('created')}>
              Added
            </SortHeader>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const days = row.days_to_contract_end
          return (
            <TableRow key={row.id} id={`client-${row.id}`}>
              <TableCell className="min-w-0 pl-4">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
                >
                  <span className="block truncate text-[13px] text-foreground">
                    {row.name || 'Untitled account'}
                  </span>
                  <span className="os-micro block truncate">
                    {row.contact?.name ? `${row.contact.name} · ` : ''}
                    {row.source === 'demo' ? 'demo' : enumLabel(row.source)}
                    {row.tags?.length ? ` · ${row.tags.join(', ')}` : ''}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <HealthDisc health={row.health} />
                  <span className="text-[12.5px] text-muted-foreground">{enumLabel(row.stage)}</span>
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="os-mono block truncate text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {row.mrr === null || row.mrr === undefined
                    ? '—'
                    : formatMoney(row.mrr, row.currency ?? currency, { compact: true })}
                </span>
                {row.mrr === null || row.mrr === undefined ? (
                  <span className="os-micro block text-right">no live subscription</span>
                ) : null}
              </TableCell>
              <TableCell className="min-w-0">
                {row.contract_end ? (
                  <>
                    <span
                      className={cn(
                        'block truncate text-[12.5px]',
                        days !== null && days !== undefined && days <= 0
                          ? 'text-danger'
                          : days !== null && days !== undefined && days <= 30
                            ? 'text-warning'
                            : 'text-muted-foreground'
                      )}
                    >
                      {days === null || days === undefined
                        ? formatDate(row.contract_end)
                        : days <= 0
                          ? `ran out ${Math.abs(days)}d ago`
                          : `${days}d to ${formatDate(row.contract_end)}`}
                    </span>
                    <span className="os-micro block">
                      {row.renewal_reminder_days === null || row.renewal_reminder_days === undefined
                        ? 'no reminder set'
                        : `warns ${row.renewal_reminder_days}d ahead`}
                    </span>
                  </>
                ) : (
                  <span className="os-micro block text-faint">undated — never renews, never warns</span>
                )}
              </TableCell>
              <TableCell>
                <span className="os-mono text-[12px] tabular-nums text-faint">
                  {formatDate(row.created_at)}
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
