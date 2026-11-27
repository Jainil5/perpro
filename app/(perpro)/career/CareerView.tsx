'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Briefcase, Columns3, List, Plus, RefreshCw } from 'lucide-react'
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
  allowedTransitions,
  applicationDot,
  APPLICATION_DEFAULT_DIR,
  applicationPath,
  applicationTransitionPath,
  CAREER_PATHS,
  CAREER_SCOPE,
  isClosedApplication,
  salaryBand,
  STALE_AFTER_DAYS,
} from '@/lib/os/career'
import type {
  ApplicationSort,
  CareerSummary,
  InterviewUpcoming,
  JobApplication,
  JobApplicationStatus,
  JobInterview,
  StaleApplication,
} from '@/lib/os/career'
import { formatMoney } from '@/lib/os/currency'
import {
  countLabel,
  dueLabel,
  dueTone,
  enumLabel,
  formatDate,
  formatDateTime,
  formatPercent,
  plural,
} from '@/lib/os/format'
import type { PagedListResponse } from '@/lib/os/types'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
import {
  FilterBar,
  FilterChip,
  InlineSearch,
  LoadMore,
  ViewToggle,
} from '@/components/os/filters'
import { FunnelRail, PipelineBoard } from '@/components/os/pipeline'
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
import { ApplicationDialog } from './ApplicationDialog'
import { ApplicationDetail } from './ApplicationDetail'

const PAGE = 100
const VIEW_KEY = 'os.career.view'

/** Until `/meta` answers, the route filter still needs the documented values. */
const DEFAULT_CHANNELS = ['referral', 'job_board', 'recruiter', 'website', 'event', 'other']

/** The columns the board draws, in funnel order — closed states live in the table. */
const BOARD = [
  { status: 'saved', hint: 'Spotted, not sent yet' },
  { status: 'applied', hint: 'Nothing heard' },
  { status: 'screening', hint: 'Recruiter call done' },
  { status: 'interview', hint: 'Rounds scheduled' },
  { status: 'offer', hint: 'Numbers on the table' },
]

type Mode = 'board' | 'table'
type Dir = 'asc' | 'desc'

/**
 * The Career pipeline: a board over the API's state machine, the interview diary beside it, and a
 * table for everything the board deliberately does not show (closed rows).
 *
 * Nothing here keeps its own copy of a status. Dragging a card POSTs `/{id}/transition`, the lists
 * re-read, and a jump the machine does not allow is never offered — the same graph the server runs
 * is in `lib/os/career.ts`, so the affordance and the answer agree.
 */
export default function CareerView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const currency = workspace.data?.currency ?? 'INR'

  const [mode, setMode] = useState<Mode>(() => readLocal<Mode>(VIEW_KEY, 'board'))
  const [status, setStatus] = useState<string>(() => params.get('status') ?? 'all')
  const [channel, setChannel] = useState<string>(() => params.get('channel') ?? 'all')
  const [term, setTerm] = useState(() => params.get('q') ?? '')
  const [sort, setSort] = useState<ApplicationSort>('next_action_date')
  const [dir, setDir] = useState<Dir>('asc')
  const [pages, setPages] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; row: JobApplication | null }>({
    open: false,
    row: null,
  })
  const [detailId, setDetailId] = useState<string | null>(() => params.get('app'))
  const [deleting, setDeleting] = useState<JobApplication | null>(null)
  const focusInterview = params.get('interview')

  const urlString = params.toString()
  // A link arriving while the page is mounted (⌘K, a notification, the dashboard) has to move the
  // filters, not only the first render's state.
  useEffect(() => {
    const next = new URLSearchParams(urlString)
    const rawQ = next.get('q')
    if (rawQ !== null) setTerm(rawQ)
    const rawStatus = next.get('status')
    if (rawStatus !== null) setStatus(rawStatus || 'all')
    const rawChannel = next.get('channel')
    if (rawChannel !== null) setChannel(rawChannel || 'all')
    const app = next.get('app')
    if (app !== null) setDetailId(app || null)
  }, [urlString])

  // `?interview=` names a round, not an application — open the application it belongs to.
  const interviewFocus = useResource<JobInterview>(focusInterview ? `/job-interviews/${focusInterview}` : null)
  useEffect(() => {
    const applicationId = interviewFocus.data?.application_id
    if (applicationId) setDetailId(applicationId)
  }, [interviewFocus.data])

  const q = useDebounced(term.trim(), 300)

  const applications = useResource<PagedListResponse<JobApplication>>(CAREER_PATHS.applications, {
    status: status === 'all' ? undefined : status,
    channel: channel === 'all' ? undefined : channel,
    q: q || undefined,
    sort,
    dir,
    limit: PAGE * pages,
    offset: 0,
  })
  const summary = useResource<CareerSummary>(CAREER_PATHS.summary)

  const rows = applications.data?.items ?? []
  const total = applications.data?.total ?? 0
  const missing = applications.error?.status === 404
  const filtersOn = status !== 'all' || channel !== 'all' || q.length > 0

  const boardRows = useMemo(
    () => rows.filter((row) => !(status === 'all' && isClosedApplication(row.status))),
    [rows, status]
  )
  const closedShown = rows.length - boardRows.length

  const setModeAndRemember = useCallback((next: string) => {
    setMode(next as Mode)
    writeLocal(VIEW_KEY, next)
  }, [])

  function pickSort(next: ApplicationSort) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(APPLICATION_DEFAULT_DIR[next] ?? 'asc')
    setPages(1)
  }

  /** Legal for this row: the graph answers, then the server gets the final word. */
  const canMove = useCallback(
    (row: JobApplication, next: string) => allowedTransitions(row.status).includes(next as JobApplicationStatus),
    []
  )

  async function move(row: JobApplication, next: string) {
    setBusyId(row.id)
    try {
      await api(applicationTransitionPath(row.id), { method: 'POST', body: { status: next } })
      invalidate(...CAREER_SCOPE)
      toastSuccess(`“${row.role_title}” → ${enumLabel(next)}`)
    } catch (error) {
      toastError('The API refused that move', { description: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  function refresh() {
    applications.reload()
    summary.reload()
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Career</p>
          <h1 className="os-title mt-0.5">Interview pipeline</h1>
          <p className="os-micro mt-2">
            {applications.loading && !applications.data
              ? 'Loading…'
              : `${countLabel(rows.length, 'role')} shown of ${total} · salary bands in ${currency} · the funnel is a state machine, not a mood`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Reload the pipeline" onClick={refresh}>
            <RefreshCw className={cn('size-3.5', applications.loading ? 'animate-spin' : null)} />
          </IconButton>
          <Button
            onClick={() => setDialog({ open: true, row: null })}
          >
            <Plus /> New application
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
              <Stat label="Open roles" value={s.open} />
              <Stat
                label="Interviews ahead"
                value={s.interviews_upcoming.length}
                tone={s.interviews_upcoming.length ? 'primary' : 'default'}
              />
              <Stat label="Offers" value={s.offers} tone={s.offers ? 'success' : 'default'} />
              <Stat label="Applied → interview" value={formatPercent(s.rates.applied_to_interview)} />
              <Stat
                label="Days to first interview"
                value={s.time_to_interview_days === null ? '—' : s.time_to_interview_days}
              />
            </div>
          )}
        </ResourceState>
      </section>

      <FilterBar>
        <FilterChip active={status === 'all'} onClick={() => setStatus('all')}>
          All
        </FilterChip>
        {(enums.job_application_status ?? [
          'saved',
          'applied',
          'screening',
          'interview',
          'offer',
          'hired',
          'rejected',
          'withdrawn',
        ]).map((value) => (
          <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
            {enumLabel(value)}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line lg:block" />
        <span className="os-label shrink-0">Route</span>
        <EnumSelect
          value={channel}
          onChange={setChannel}
          options={['all', ...(enums.job_application_channel ?? DEFAULT_CHANNELS)]}
          className="w-[9.5rem] shrink-0"
          id="career-channel"
        />
        <InlineSearch
          value={term}
          onChange={(next) => {
            setTerm(next)
            setPages(1)
          }}
          placeholder="Search role, company, notes…"
          className="min-w-[10rem] flex-1"
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
          error={applications.error}
          onRetry={refresh}
          title="This API has no Career endpoints yet"
          className="border-line"
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <SoftError error={applications.error} />
            {applications.loading && applications.data === undefined ? (
              <LoadingBlock rows={6} label="Loading the funnel…" />
            ) : rows.length === 0 ? (
              <EmptyBlock
                title={filtersOn ? 'Nothing matches this filter' : 'No applications yet'}
                description={
                  filtersOn
                    ? 'Filters run on the API, so this is the real result set — clear them and the rows are there.'
                    : 'Add the role you applied to, then move the card across the board as it progresses. The funnel, the interview diary and the stale list are all derived from these rows.'
                }
                icon={<Briefcase />}
                action={
                  <>
                    <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
                      <Plus /> New application
                    </Button>
                    {filtersOn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setStatus('all')
                          setChannel('all')
                          setTerm('')
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </>
                }
              />
            ) : mode === 'board' ? (
              <Panel
                dense
                title="Funnel board"
                description={`${BOARD.length} open stages · drag a card, or use the arrows on it`}
                bodyClassName="px-2 py-2"
                action={
                  closedShown ? (
                    <span className="os-micro text-faint">{closedShown} closed in the table</span>
                  ) : undefined
                }
              >
                <PipelineBoard
                  columns={BOARD}
                  rows={boardRows}
                  idOf={(row) => row.id}
                  statusOf={(row) => row.status}
                  canMove={canMove}
                  busyId={busyId}
                  loading={applications.loading}
                  onMove={(row, next) => void move(row, next)}
                  onOpen={(row) => setDetailId(row.id)}
                  card={(row) => <ApplicationCard row={row} currency={currency} />}
                />
                {closedShown ? (
                  <p className="os-micro px-1 pb-1 pt-2">
                    {plural(closedShown, 'closed row')} stays out of the board — switch to the table,
                    or filter by hired / rejected / withdrawn to see only those.
                  </p>
                ) : null}
              </Panel>
            ) : (
              <Panel
                dense
                title="Every row"
                description="Click a role to open it. Sorting and filtering happen on the API."
                bodyClassName="px-0 py-0"
              >
                <ApplicationTable
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
                    loading={applications.loading}
                    size={PAGE}
                    onMore={() => setPages((n) => n + 1)}
                    onReset={() => setPages(1)}
                  />
                </div>
              </Panel>
            )}

            <BandNote currency={currency} />
          </div>

          {/* ---------------------------------------------------------- right rail */}
          <div className="min-w-0 space-y-4">
            <Panel dense title="Funnel" description="Counts as the API sees them, including closed rows">
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Counting…</p>}
              >
                {(s) => (
                  <div className="space-y-3">
                    <FunnelRail
                      steps={s.funnel}
                      emptyLabel="No applications counted yet."
                    />
                    <div className="border-t border-line-faint pt-2">
                      <MicroData
                        items={[
                          `interview → offer ${formatPercent(s.rates.interview_to_offer)}`,
                          s.time_to_offer_days === null
                            ? 'no offer timed yet'
                            : `${s.time_to_offer_days} days to an offer`,
                        ]}
                      />
                    </div>
                  </div>
                )}
              </ResourceState>
            </Panel>

            <Panel
              dense
              title="Interviews ahead"
              description="Scheduled rounds, soonest first"
              action={
                <Link href="/meetings" className="os-micro underline underline-offset-2">
                  meetings tab
                </Link>
              }
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Reading the diary…</p>}
                empty={<p className="os-micro">Nothing scheduled.</p>}
              >
                {(s) =>
                  s.interviews_upcoming.length ? (
                    <ul className="min-w-0 divide-y divide-line">
                      {s.interviews_upcoming.map((item) => (
                        <UpcomingLine
                          key={item.id}
                          item={item}
                          onOpen={() => setDetailId(item.application_id)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="os-micro">
                      Nothing scheduled. Open a role and press Schedule — the slot opens on today’s
                      next clean half hour.
                    </p>
                  )
                }
              </ResourceState>
            </Panel>

            <Panel
              dense
              title="Needs a nudge"
              description={`Open roles untouched for ${STALE_AFTER_DAYS} days or more`}
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Looking for silence…</p>}
              >
                {(s) =>
                  s.stale.length ? (
                    <ul className="min-w-0 divide-y divide-line">
                      {s.stale.map((item) => (
                        <StaleLine key={item.id} item={item} onOpen={() => setDetailId(item.id)} />
                      ))}
                    </ul>
                  ) : (
                    <p className="os-micro">
                      Nothing has gone quiet. A touch on any row — a note, a date, a move — resets
                      its clock.
                    </p>
                  )
                }
              </ResourceState>
            </Panel>
          </div>
        </div>
      )}

      <ApplicationDialog
        open={dialog.open}
        onOpenChange={(next) => setDialog((prev) => ({ ...prev, open: next }))}
        row={dialog.row}
        currency={currency}
        onSaved={(saved, created) => {
          refresh()
          if (created) setDetailId(saved.id)
        }}
      />

      <ApplicationDetail
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
        title={`Delete “${deleting?.role_title ?? 'application'}”`}
        description="Its interview rounds go with it, and the funnel recount happens on the API. Deleting a row nobody answered is not the same as rejecting it — rejection keeps the history."
        confirmLabel="Delete application"
        onConfirm={() =>
          api(applicationPath(deleting?.id ?? ''), { method: 'DELETE' }).then(() => {
            invalidate(...CAREER_SCOPE)
            toastSuccess('Application deleted', { description: deleting?.role_title })
            refresh()
          })
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------- pieces -- */

function ApplicationCard({ row, currency }: { row: JobApplication; currency: string }) {
  const band = salaryBand(row.salary_min, row.salary_max, (value) =>
    formatMoney(value, currency, { compact: true })
  )
  const tone = dueTone(row.next_action_date)
  return (
    <div className="min-w-0 space-y-1">
      <p className="os-micro truncate">{row.company?.name ?? 'No company linked'}</p>
      <p className="line-clamp-2 text-[13px] leading-snug text-foreground">{row.role_title}</p>
      {band || row.location || row.remote ? (
        <p className="os-mono truncate text-[11px] text-muted-foreground">
          {band ?? (row.remote ? 'remote' : row.location ?? '')}
        </p>
      ) : null}
      {row.next_action ? (
        <p
          className={cn(
            'os-micro truncate',
            tone === 'overdue' ? 'text-danger' : tone === 'today' || tone === 'soon' ? 'text-warning' : 'text-faint'
          )}
        >
          {row.next_action}
          {row.next_action_date ? ` · ${dueLabel(row.next_action_date)}` : ''}
        </p>
      ) : null}
      <div className="flex items-center gap-2 pt-0.5">
        <StatusDot
          state={applicationDot(row.status)}
          tone={row.is_stale ? 'warning' : undefined}
          title={
            row.is_stale
              ? `${row.days_since_touch ?? STALE_AFTER_DAYS} days without a touch`
              : enumLabel(row.status)
          }
        />
        <span className="os-micro truncate">
          {row.interview_count ? `${row.interview_count} ${plural(row.interview_count, 'round')}` : 'no rounds'}
          {row.next_interview
            ? ` · next ${formatDateTime(row.next_interview.scheduled_at)}`
            : row.days_since_touch !== null && row.days_since_touch !== undefined
              ? ` · ${row.days_since_touch}d since anything changed`
              : ''}
        </span>
      </div>
    </div>
  )
}

function UpcomingLine({ item, onOpen }: { item: InterviewUpcoming; onOpen: () => void }) {
  const soon = item.days_until <= 1
  return (
    <li className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground underline-offset-2 hover:underline"
        >
          {item.round}
          <span className="os-micro ml-2">{item.role_title}</span>
        </button>
        <span className={cn('os-mono shrink-0 text-[11px] tabular-nums', soon ? 'text-warning' : 'text-faint')}>
          {item.days_until === 0 ? 'today' : item.days_until === 1 ? 'tomorrow' : `in ${item.days_until}d`}
        </span>
      </div>
      <MicroData
        items={[
          item.company ?? null,
          item.type ? enumLabel(item.type) : null,
          formatDateTime(item.scheduled_at),
        ]}
      />
    </li>
  )
}

function StaleLine({ item, onOpen }: { item: StaleApplication; onOpen: () => void }) {
  return (
    <li className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground underline-offset-2 hover:underline"
        >
          {item.role_title}
        </button>
        <span className="os-mono shrink-0 text-[11px] tabular-nums text-danger">
          {item.days_since_touch}d
        </span>
      </div>
      <HairlineBar
        value={Math.min(100, (item.days_since_touch / (STALE_AFTER_DAYS * 3)) * 100)}
        label={`${item.role_title} waiting`}
        title={`${item.days_since_touch} days since anything changed`}
        className="mt-1"
      />
    </li>
  )
}

function ApplicationTable({
  rows,
  currency,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  rows: JobApplication[]
  currency: string
  sort: ApplicationSort
  dir: Dir
  onSort: (next: ApplicationSort) => void
  onOpen: (row: JobApplication) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[16rem] pl-4">
            <span className="os-label">Role</span>
          </TableHead>
          <TableHead className="w-[7.5rem]">
            <SortHeader active={sort === 'status'} dir={dir} onClick={() => onSort('status')}>
              Status
            </SortHeader>
          </TableHead>
          <TableHead className="w-[8.5rem] pr-4 text-right">
            <SortHeader active={sort === 'salary'} dir={dir} onClick={() => onSort('salary')} align="right">
              Band
            </SortHeader>
          </TableHead>
          <TableHead className="w-[11rem]">
            <SortHeader active={sort === 'next_action_date'} dir={dir} onClick={() => onSort('next_action_date')}>
              Next action
            </SortHeader>
          </TableHead>
          <TableHead className="w-[6.5rem]">
            <SortHeader active={sort === 'applied_at'} dir={dir} onClick={() => onSort('applied_at')}>
              Applied
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
          const band = salaryBand(row.salary_min, row.salary_max, (value) =>
            formatMoney(value, currency, { compact: true })
          )
          const tone = dueTone(row.next_action_date)
          return (
            <TableRow key={row.id} id={`application-${row.id}`}>
              <TableCell className="min-w-0 pl-4">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
                >
                  <span className="block truncate text-[13px] text-foreground">{row.role_title}</span>
                  <span className="os-micro block truncate">
                    {row.company?.name ?? 'No company'}
                    {row.channel ? ` · ${enumLabel(row.channel)}` : ''}
                    {row.remote ? ' · remote' : row.location ? ` · ${row.location}` : ''}
                    {row.source === 'demo' ? ' · demo' : ''}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <StatusDot
                    state={applicationDot(row.status)}
                    tone={row.is_stale ? 'warning' : undefined}
                    title={
                      row.is_stale
                        ? `untouched for ${row.days_since_touch ?? STALE_AFTER_DAYS} days`
                        : enumLabel(row.status)
                    }
                  />
                  <span className="text-[12.5px] text-muted-foreground">{enumLabel(row.status)}</span>
                </span>
              </TableCell>
              <TableCell className="pr-4">
                <span className="os-mono block truncate text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {band ?? '—'}
                </span>
              </TableCell>
              <TableCell className="min-w-0">
                <span className="block truncate text-[12.5px] text-foreground">
                  {row.next_action ?? '—'}
                </span>
                {row.next_action_date ? (
                  <span
                    className={cn(
                      'os-micro block',
                      tone === 'overdue' ? 'text-danger' : tone === 'today' || tone === 'soon' ? 'text-warning' : 'text-faint'
                    )}
                  >
                    {dueLabel(row.next_action_date)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="os-mono text-[12px] tabular-nums text-muted-foreground">
                  {row.applied_at ? formatDate(row.applied_at) : '—'}
                </span>
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

/**
 * One honest line under the pipeline: the bands are annual and in the workspace currency, because
 * the API says so and Career converts nothing — a number you have to divide by 12 in your head is
 * still a number nobody argued about.
 */
function BandNote({ currency }: { currency: string }) {
  return (
    <p className="os-micro text-faint">
      salary bands are annual, in {currency}, exactly as advertised — this screen never converts one
    </p>
  )
}
