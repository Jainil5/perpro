'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Columns3, List, Plus, RefreshCw, Users2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import {
  invalidate,
  readLocal,
  useDebounced,
  useEnums,
  useResource,
  useWorkspace,
  writeLocal,
} from '@/lib/os/hooks'
import {
  allowedLeadTransitions,
  CRM_PATHS,
  CRM_SCOPE,
  isClosedLead,
  LEAD_DEFAULT_DIR,
  leadDot,
  leadPath,
  leadTransitionPath,
  LEAD_SORTS,
  openLeadCount,
  type Client,
  type CrmSummary,
  type Lead,
  type LeadPromoteResult,
  type LeadSort,
  type LeadStatus,
  type LeadTransitionInput,
} from '@/lib/os/crm'
import { formatMoney } from '@/lib/os/currency'
import {
  countLabel,
  dueLabel,
  dueTone,
  enumLabel,
  formatDate,
  formatPercent,
  plural,
} from '@/lib/os/format'
import type { ListResponse, PagedListResponse } from '@/lib/os/types'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
import {
  FilterBar,
  FilterChip,
  InlineSearch,
  LoadMore,
  SortSelect,
  ViewToggle,
} from '@/components/os/filters'
import { FunnelRail, HealthDisc, PipelineBoard, TallyFigures } from '@/components/os/pipeline'
import { HairlineBar, MicroData, StatusDot } from '@/components/os/marks'
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
import { LeadDialog } from './LeadDialog'
import { LeadDetail } from './LeadDetail'
import { PromoteDialog } from './PromoteDialog'

const PAGE = 100
const VIEW_KEY = 'os.crm.view'

/** The columns the board draws. Closed states live in the table, exactly as they do in Career. */
const COLUMNS = [
  { status: 'new', hint: 'Nothing said yet' },
  { status: 'contacted', hint: 'A reply, or the first call' },
  { status: 'qualified', hint: 'Real brief, real budget' },
  { status: 'proposal', hint: 'Numbers sent' },
]

type Mode = 'board' | 'table'
type Dir = 'asc' | 'desc'

/**
 * The freelance pipeline: a board over the lead state machine, the money the pipeline represents,
 * and the follow-ups that are late.
 *
 * Three things are deliberately not kept here. Statuses come from `POST /leads/{id}/transition`, so
 * the board cannot disagree with the API. Won work becomes an account through
 * `POST /leads/{id}/promote`, which is the only path that creates a client — a second promote is
 * refused rather than duplicated. And the totals are the API's: `crm.summary` answers per currency,
 * so a mixed book is shown as two numbers instead of one invented one.
 */
export default function CrmView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const currency = workspace.data?.currency ?? 'INR'

  const [mode, setMode] = useState<Mode>(() => readLocal<Mode>(VIEW_KEY, 'board'))
  const [status, setStatus] = useState<string>(() => params.get('status') ?? 'all')
  const [origin, setOrigin] = useState<string>(() => params.get('origin') ?? 'all')
  const [term, setTerm] = useState(() => params.get('q') ?? '')
  const [sort, setSort] = useState<LeadSort>('next_touch_at')
  const [dir, setDir] = useState<Dir>('asc')
  const [pages, setPages] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(() => params.get('lead'))
  const [dialog, setDialog] = useState<{ open: boolean; row: Lead | null }>({
    open: false,
    row: null,
  })
  const [promoting, setPromoting] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState<Lead | null>(null)

  const urlString = params.toString()
  // A link arriving while the page is mounted (⌘K, a notification, the dashboard) has to move the
  // filters, not only the first render's state.
  useEffect(() => {
    const next = new URLSearchParams(urlString)
    const rawQ = next.get('q')
    if (rawQ !== null) setTerm(rawQ)
    const rawStatus = next.get('status')
    if (rawStatus !== null) setStatus(rawStatus || 'all')
    const rawOrigin = next.get('origin')
    if (rawOrigin !== null) setOrigin(rawOrigin || 'all')
    const lead = next.get('lead')
    if (lead !== null) setDetailId(lead || null)
  }, [urlString])

  const q = useDebounced(term.trim(), 300)

  const leads = useResource<PagedListResponse<Lead>>(CRM_PATHS.leads, {
    status: status === 'all' ? undefined : status,
    origin: origin === 'all' ? undefined : origin,
    q: q || undefined,
    sort,
    dir,
    limit: PAGE * pages,
    offset: 0,
  })
  const summary = useResource<CrmSummary>(CRM_PATHS.leadSummary)

  const rows = leads.data?.items ?? []
  const total = leads.data?.total ?? 0
  const missing = leads.error?.status === 404
  const filtersOn = status !== 'all' || origin !== 'all' || q.length > 0

  const boardRows = useMemo(
    () => rows.filter((row) => !(status === 'all' && isClosedLead(row.status))),
    [rows, status]
  )
  const closedShown = rows.length - boardRows.length

  const setModeAndRemember = useCallback((next: string) => {
    setMode(next as Mode)
    writeLocal(VIEW_KEY, next)
  }, [])

  function pickSort(next: LeadSort) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(LEAD_DEFAULT_DIR[next] ?? 'asc')
    setPages(1)
  }

  /** Legal for this row: the graph answers first, the server keeps the final word. */
  const canMove = useCallback(
    (row: Lead, next: string) => allowedLeadTransitions(row.status).includes(next as LeadStatus),
    []
  )

  async function move(row: Lead, next: string) {
    setBusyId(row.id)
    try {
      await api<Lead>(leadTransitionPath(row.id), {
        method: 'POST',
        // `canMove` already proved this hop is on the graph; the API keeps the final word.
        body: { status: next as LeadStatus } satisfies LeadTransitionInput,
      })
      invalidate(...CRM_SCOPE)
      toastSuccess(`“${row.name}” → ${enumLabel(next)}`, {
        description: 'The touch clock restarted, because moving a lead is a touch',
      })
    } catch (error) {
      toastError('The API refused that move', { description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  function refresh() {
    leads.reload()
    summary.reload()
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Freelance CRM</p>
          <h1 className="os-title mt-0.5">Lead pipeline</h1>
          <p className="os-micro mt-2">
            {leads.loading && !leads.data
              ? 'Loading…'
              : `${countLabel(rows.length, 'lead')} shown of ${total} · winning one opens the account it belongs to`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Reload the pipeline" onClick={refresh}>
            <RefreshCw className={cn('size-3.5', leads.loading ? 'animate-spin' : null)} />
          </IconButton>
          <Button onClick={() => setDialog({ open: true, row: null })}>
            <Plus /> New lead
          </Button>
        </div>
      </div>

      <section className="os-panel min-w-0 px-4 py-3">
        <ResourceState
          resource={summary}
          skeleton={
            <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-3 sm:grid-cols-5">
              <LoadingBlock rows={2} />
            </div>
          }
        >
          {(s) => (
            <div className="grid min-w-0 grid-cols-2 items-end gap-x-8 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
              <Stat label="Leads in play" value={openLeadCount(s.pipeline)} />
              <Stat
                label="Won this month"
                value={s.won_this_month}
                tone={s.won_this_month ? 'success' : 'default'}
              />
              <Stat label="Lost this month" value={s.lost_this_month} tone={s.lost_this_month ? 'warning' : 'default'} />
              <Stat label="Win rate" value={formatPercent(s.win_rate)} />
              <Stat
                label="Days to a yes"
                value={s.avg_days_new_to_won === null ? '—' : s.avg_days_new_to_won}
              />
            </div>
          )}
        </ResourceState>
      </section>

      <FilterBar>
        <FilterChip active={status === 'all'} onClick={() => setStatus('all')}>
          All
        </FilterChip>
        {(enums.lead_status ?? [
          'new',
          'contacted',
          'qualified',
          'proposal',
          'won',
          'lost',
          'dormant',
        ]).map((value) => (
          <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
            {enumLabel(value)}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line lg:block" />
        <span className="os-label shrink-0">Source</span>
        <EnumSelect
          id="crm-origin"
          value={origin}
          onChange={setOrigin}
          options={['all', ...(enums.lead_origin ?? DEFAULT_ORIGINS)]}
          className="w-[9.5rem] shrink-0"
        />
        <InlineSearch
          value={term}
          onChange={(next) => {
            setTerm(next)
            setPages(1)
          }}
          placeholder="Search name, email, notes…"
          className="min-w-[10rem] flex-1"
        />
        <SortSelect
          value={sort}
          onChange={(next) => pickSort(next as LeadSort)}
          options={LEAD_SORTS}
          label="Sort leads"
        />
        <ViewToggle
          value={mode}
          onChange={setModeAndRemember}
          options={[
            { value: 'board', label: 'Board', icon: <Columns3 /> },
            { value: 'table', label: 'Table', icon: <List /> },
          ]}
        />
      </FilterBar>

      {missing ? (
        <ErrorBlock
          error={leads.error}
          onRetry={refresh}
          title="This API has no CRM endpoints yet"
          className="border-line"
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <SoftError error={leads.error} />
            {leads.loading && leads.data === undefined ? (
              <LoadingBlock rows={6} label="Loading the pipeline…" />
            ) : rows.length === 0 ? (
              <EmptyBlock
                title={filtersOn ? 'Nothing matches this filter' : 'No leads yet'}
                description={
                  filtersOn
                    ? 'Filters run on the API, so this is the real result set — clear them and the rows are there.'
                    : 'A lead is anybody you have not closed: a reply, a referral, a brief that went quiet. Win one and the account, its contract window and its follow-ups appear under Customers.'
                }
                icon={<Users2 />}
                action={
                  <>
                    <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
                      <Plus /> New lead
                    </Button>
                    {filtersOn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setStatus('all')
                          setOrigin('all')
                          setTerm('')
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                    <Link href="/customers" className="os-micro underline underline-offset-2">
                      see the accounts
                    </Link>
                  </>
                }
              />
            ) : mode === 'board' ? (
              <Panel
                dense
                title="Pipeline board"
                description={`${COLUMNS.length} open stages · drag a card, or use the arrows on it`}
                bodyClassName="px-2 py-2"
                action={
                  closedShown ? (
                    <span className="os-micro text-faint">{closedShown} closed in the table</span>
                  ) : undefined
                }
              >
                <PipelineBoard
                  columns={COLUMNS}
                  rows={boardRows}
                  idOf={(row) => row.id}
                  statusOf={(row) => row.status}
                  canMove={canMove}
                  busyId={busyId}
                  loading={leads.loading}
                  onMove={(row, next) => void move(row, next)}
                  onOpen={(row) => setDetailId(row.id)}
                  card={(row) => <LeadCard row={row} currency={currency} />}
                />
                {closedShown ? (
                  <p className="os-micro px-1 pb-1 pt-2">
                    {plural(closedShown, 'closed lead')} stays out of the board — switch to the table
                    or filter by won / lost / dormant. Winning is done from a lead, not by dragging
                    it into a column that does not exist.
                  </p>
                ) : null}
              </Panel>
            ) : (
              <Panel
                dense
                title="Every lead"
                description="Click a lead to open it. Sorting and filtering happen on the API."
                bodyClassName="px-0 py-0"
              >
                <LeadTable
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
                    loading={leads.loading}
                    size={PAGE}
                    onMore={() => setPages((n) => n + 1)}
                    onReset={() => setPages(1)}
                  />
                </div>
              </Panel>
            )}

            <p className="os-micro text-faint">
              estimated values are what you guessed when the lead arrived, in the currency named on
              the row — this screen never converts one, and weighted figures use the lead's own score
            </p>
          </div>

          {/* ---------------------------------------------------------- right rail */}
          <div className="min-w-0 space-y-4">
            <Panel
              dense
              title="Pipeline value"
              description="Per currency, exactly as the API answers"
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Adding up…</p>}
                empty={<p className="os-micro">Nothing to total yet.</p>}
              >
                {(s) => (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="os-label">Estimated, by currency</p>
                      <TallyFigures
                        entries={s.value_by_currency}
                        emptyLabel="No lead has a value on it yet."
                      />
                    </div>
                    <div className="space-y-1 border-t border-line pt-2">
                      <p className="os-label">Weighted by score</p>
                      <TallyFigures
                        entries={s.weighted_value}
                        emptyLabel="Nothing weighted yet — scores turn this into a forecast."
                      />
                    </div>
                    {s.conversion_rate !== null ? (
                      <p className="os-micro">
                        {formatPercent(s.conversion_rate)} of everything captured has been closed one
                        way or the other
                      </p>
                    ) : null}
                  </div>
                )}
              </ResourceState>
            </Panel>

            <Panel dense title="Funnel" description="Counts as the API sees them, closed rows included">
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Counting…</p>}
              >
                {(s) => (
                  <FunnelRail steps={s.pipeline} emptyLabel="No leads counted yet." />
                )}
              </ResourceState>
            </Panel>

            <Panel
              dense
              title="Needs a follow-up"
              description="Past the date you said you would touch them"
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Looking for late ones…</p>}
              >
                {(s) =>
                  s.needs_follow_up.length ? (
                    <ul className="min-w-0 divide-y divide-line">
                      {s.needs_follow_up.map((item) => (
                        <FollowUpLine
                          key={item.id}
                          item={item}
                          onOpen={() => setDetailId(item.id)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="os-micro">
                      Nothing is late. A move, a meeting or a booked follow-up all clear this list.
                    </p>
                  )
                }
              </ResourceState>
            </Panel>

            <Panel dense title="Accounts" description="Clients this pipeline has already produced">
              <ClientPeek currency={currency} />
            </Panel>
          </div>
        </div>
      )}

      <LeadDialog
        open={dialog.open}
        onOpenChange={(next) => setDialog((prev) => ({ ...prev, open: next }))}
        row={dialog.row}
        workspaceCurrency={currency}
        onSaved={(saved, created) => {
          refresh()
          if (created) setDetailId(saved.id)
        }}
      />

      <LeadDetail
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
        onPromote={(row) => {
          setDetailId(null)
          setPromoting(row)
        }}
      />

      <PromoteDialog
        open={Boolean(promoting)}
        onOpenChange={(next) => (next ? undefined : setPromoting(null))}
        lead={promoting}
        workspaceCurrency={currency}
        onDone={(result: LeadPromoteResult) => {
          refresh()
          toastSuccess(`${result.lead.name} is now ${result.client.name}`, {
            description: 'The account, its contract window and its follow-ups are on the Customers screen',
          })
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? 'lead'}”`}
        description="Losing a lead is recorded and keeps the win/loss maths; deleting it removes the row and the history with it. A lead that became an account can be deleted only after the account is gone."
        confirmLabel="Delete lead"
        onConfirm={() =>
          api(leadPath(deleting?.id ?? ''), { method: 'DELETE' }).then(() => {
            invalidate(...CRM_SCOPE)
            toastSuccess('Lead deleted', { description: deleting?.name })
            refresh()
          })
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------- pieces -- */

/** Until `/meta` answers, the source filter still needs the documented values. */
const DEFAULT_ORIGINS = [
  'website',
  'referral',
  'inbound',
  'outbound',
  'event',
  'social',
  'other',
]

function LeadCard({ row, currency }: { row: Lead; currency: string }) {
  const tone = dueTone(row.next_touch_at)
  return (
    <div className="min-w-0 space-y-1">
      <p className="line-clamp-2 text-[13px] leading-snug text-foreground">{row.name}</p>
      <p className="os-micro truncate">
        {row.company?.name ?? row.contact?.name ?? (row.origin ? enumLabel(row.origin) : 'no source yet')}
      </p>
      {row.estimated_value !== null && row.estimated_value !== undefined ? (
        <p className="os-mono truncate text-[11px] tabular-nums text-muted-foreground">
          {formatMoney(row.estimated_value, row.currency ?? currency, { compact: true })}
        </p>
      ) : null}
      {row.next_touch_at ? (
        <p
          className={cn(
            'os-micro truncate',
            tone === 'overdue'
              ? 'text-danger'
              : tone === 'today' || tone === 'soon'
                ? 'text-warning'
                : 'text-faint'
          )}
        >
          follow up {dueLabel(row.next_touch_at)}
        </p>
      ) : null}
      <div className="flex items-center gap-2 pt-0.5">
        <StatusDot state={leadDot(row.status)} title={enumLabel(row.status)} />
        {row.score !== null && row.score !== undefined ? (
          <span className="os-mono text-[11px] tabular-nums text-faint">{row.score}/100</span>
        ) : (
          <span className="os-micro">unscored</span>
        )}
        {row.is_overdue ? (
          <span className="os-micro text-danger">late</span>
        ) : null}
      </div>
    </div>
  )
}

function FollowUpLine({
  item,
  onOpen,
}: {
  item: CrmSummary['needs_follow_up'][number]
  onOpen: () => void
}) {
  return (
    <li className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground underline-offset-2 hover:underline"
        >
          {item.name}
        </button>
        <span className="os-mono shrink-0 text-[11px] tabular-nums text-danger">
          {item.days_overdue}d late
        </span>
      </div>
      <HairlineBar
        value={Math.min(100, (item.days_overdue / 30) * 100)}
        label={`${item.name} overdue`}
        title={`${item.days_overdue} days past the follow-up date`}
        className="mt-1"
      />
      {item.next_touch_at ? (
        <MicroData items={[`planned ${formatDate(item.next_touch_at)}`]} />
      ) : null}
    </li>
  )
}

function LeadTable({
  rows,
  currency,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  rows: Lead[]
  currency: string
  sort: LeadSort
  dir: Dir
  onSort: (next: LeadSort) => void
  onOpen: (row: Lead) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[15rem] pl-4">
            <span className="os-label">Lead</span>
          </TableHead>
          <TableHead className="w-[7.5rem]">
            <span className="os-label">Stage</span>
          </TableHead>
          <TableHead className="w-[6rem]">
            <SortHeader active={sort === 'score'} dir={dir} onClick={() => onSort('score')}>
              Score
            </SortHeader>
          </TableHead>
          <TableHead className="w-[8.5rem] text-right">
            <SortHeader
              active={sort === 'estimated_value'}
              dir={dir}
              onClick={() => onSort('estimated_value')}
              align="right"
            >
              Value
            </SortHeader>
          </TableHead>
          <TableHead className="w-[11rem]">
            <SortHeader
              active={sort === 'next_touch_at'}
              dir={dir}
              onClick={() => onSort('next_touch_at')}
            >
              Follow up
            </SortHeader>
          </TableHead>
          <TableHead className="w-[6rem]">
            <SortHeader active={sort === 'created'} dir={dir} onClick={() => onSort('created')}>
              Added
            </SortHeader>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const tone = dueTone(row.next_touch_at)
          return (
            <TableRow key={row.id} id={`lead-${row.id}`}>
              <TableCell className="min-w-0 pl-4">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
                >
                  <span className="block truncate text-[13px] text-foreground">{row.name}</span>
                  <span className="os-micro block truncate">
                    {row.origin ? enumLabel(row.origin) : 'no source'}
                    {row.company?.name ? ` · ${row.company.name}` : ''}
                    {row.email ? ` · ${row.email}` : ''}
                    {row.source === 'demo' ? ' · demo' : ''}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <StatusDot state={leadDot(row.status)} title={enumLabel(row.status)} />
                  <span className="text-[12.5px] text-muted-foreground">{enumLabel(row.status)}</span>
                </span>
              </TableCell>
              <TableCell>
                <span className="os-mono text-[12.5px] tabular-nums text-muted-foreground">
                  {row.score ?? '—'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="os-mono block truncate text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {row.estimated_value === null || row.estimated_value === undefined
                    ? '—'
                    : formatMoney(row.estimated_value, row.currency ?? currency, { compact: true })}
                </span>
              </TableCell>
              <TableCell className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-[12.5px]',
                    tone === 'overdue' ? 'text-danger' : tone === 'today' || tone === 'soon' ? 'text-warning' : 'text-muted-foreground'
                  )}
                >
                  {row.next_touch_at ? dueLabel(row.next_touch_at) : 'nothing planned'}
                </span>
                {row.next_touch_at ? (
                  <span className="os-micro block">{formatDate(row.next_touch_at)}</span>
                ) : row.lost_reason ? (
                  <span className="os-micro block truncate">lost: {row.lost_reason}</span>
                ) : null}
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

/** Biggest monthly figure first; a null `mrr` is no answer, so it sorts to the bottom. */
function ranked(items: Client[]): Client[] {
  const figure = (row: Client) => (row.mrr === null || row.mrr === undefined ? null : row.mrr)
  return items
    .slice()
    .sort((a, b) => {
      const left = figure(a)
      const right = figure(b)
      if (left === null && right === null) return a.name.localeCompare(b.name)
      if (left === null) return 1
      if (right === null) return -1
      return right - left || a.name.localeCompare(b.name)
    })
    .slice(0, 5)
}

/**
 * The accounts this pipeline has already produced, read from the same screen's own endpoint. It is
 * a peek with a link, not a second CRM: the money, the contract window and the diary live on
 * `/customers`.
 */
function ClientPeek({ currency }: { currency: string }) {
  // `sort=mrr` orders the page the API returns, not the book, so the read asks for a wide page
  // and ranks the five out of that. A `limit: 5` here would print the five biggest of five rows.
  const clients = useResource<ListResponse<Client>>(CRM_PATHS.clients, {
    sort: 'mrr',
    dir: 'desc',
    limit: 100,
  })
  return (
    <ResourceState
      resource={clients}
      skeleton={<p className="os-micro">Reading the accounts…</p>}
      empty={
        <p className="os-micro">
          No accounts yet. Win a lead and the client record is created in the same call.{' '}
          <Link href="/customers" className="underline underline-offset-2">
            Customers
          </Link>
        </p>
      }
    >
      {(data) => (
        <div className="min-w-0 space-y-2">
          <ul className="min-w-0 divide-y divide-line">
            {ranked(data.items).map((client) => (
              <li key={client.id} className="min-w-0 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/customers?client=${client.id}`}
                    className="min-w-0 flex-1 truncate text-[13px] text-foreground underline-offset-2 hover:underline"
                  >
                    {client.name || 'Untitled account'}
                  </Link>
                  <span className="os-mono shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {client.mrr === null || client.mrr === undefined
                      ? '—'
                      : `${formatMoney(client.mrr, client.currency ?? currency, { compact: true })}/mo`}
                  </span>
                  <HealthDisc health={client.health} className="ml-1" />
                </div>
              </li>
            ))}
          </ul>
          <p className="os-micro">
            <Link href="/customers" className="underline underline-offset-2">
              all accounts, contracts and receivables
            </Link>{' '}
            · biggest five of the {data.items.length} read, ranked here because the API sorts an
            MRR page, not a whole book
          </p>
        </div>
      )}
    </ResourceState>
  )
}
