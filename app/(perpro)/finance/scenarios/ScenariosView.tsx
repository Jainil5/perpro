'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Copy, GitCompareArrows, Pencil, Plus, Power, Trash2 } from 'lucide-react'

import {
  AmountField,
  CategorySelect,
  CumulativeCurve,
  CurrencySelect,
  DirectionTag,
  InOutBars,
  MoneyCell,
  MoneyHero,
  ProfileSelect,
  SortHeader,
  StatusLabel,
} from '@/components/os/finance'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/os/states'
import { FilterBar, FilterChip, InlineSearch } from '@/components/os/filters'
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
import { Textarea } from '@/components/os/ui/textarea'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { Stat } from '@/components/os/ui/stats'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { EnumSelect } from '@/components/os/pickers'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource, useWorkspace } from '@/lib/os/hooks'
import {
  FINANCE_DEFAULT_DIR,
  FINANCE_PATHS,
  FINANCE_SCOPE,
  SCENARIO_RECURRENCES,
  type CostScenario,
  type CostScenarioInput,
  type CostScenarioItem,
  type CostScenarioItemInput,
  type CurrencyInfo,
  type ScenarioComparison,
  type ScenarioDirection,
  type ScenarioKind,
  type ScenarioProjection,
  type ScenarioRecurrence,
  type ScenarioStatus,
  type SortDir,
} from '@/lib/os/finance'
import type { ListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate, todayDate } from '@/lib/os/format'
import { formatMoney, monthLabel, moneyInputError, parseMoney } from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

/**
 * Cost scenarios — a plan for the next N months. A scenario row stores only its shape
 * (name, kind, first month, horizon, currency, status) and its items; the months, the
 * totals, the break-even month and the runway are rebuilt from the items by
 * `GET /cost-scenarios/{id}/projection` on every call, which is why editing a line moves
 * the curve without this page recalculating anything. `?horizon_months=` reshapes the same
 * rows over a different window — a `one_time` figure is divided by the horizon, so the
 * window is part of the answer, not decoration. When the lines do not share one currency
 * and no target is named, every figure comes back `null` and is printed as an em dash: a
 * blended total is the API's decision to make, never this page's.
 */
export default function ScenariosView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const defaultCurrency = workspace.data?.currency ?? 'INR'

  const [term, setTerm] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState<ScenarioStatus | null>(null)
  const [kind, setKind] = useState<ScenarioKind | null>(null)
  const [sort, setSort] = useState('updated')
  const [dir, setDir] = useState<SortDir>(FINANCE_DEFAULT_DIR.updated ?? 'desc')
  const [selected, setSelected] = useState<string | null>(params.get('scenario'))
  const [vs, setVs] = useState<string | null>(params.get('vs'))
  const [pane, setPane] = useState<'plan' | 'compare'>(params.get('vs') ? 'compare' : 'plan')
  const [horizon, setHorizon] = useState<number | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [scenarioDialog, setScenarioDialog] = useState<{ row: CostScenario | null } | null>(null)
  const [itemDialog, setItemDialog] = useState<{ row: CostScenarioItem | null } | null>(null)
  const [deleting, setDeleting] = useState<CostScenario | null>(null)
  const [deletingItem, setDeletingItem] = useState<CostScenarioItem | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const search = useDebounced(term)

  const scenarios = useResource<ListResponse<CostScenario>>(FINANCE_PATHS.scenarios, {
    status: status ?? undefined,
    kind: kind ?? undefined,
    q: search || undefined,
    sort,
    dir,
  })
  // One read for the plan and its lines, so the item table and the curve cannot disagree.
  // `null` skips the request entirely: the compare pane does not read either of these.
  const wantPlan = pane === 'plan' && Boolean(selected)
  const detail = useResource<CostScenario>(
    wantPlan ? `${FINANCE_PATHS.scenarios}/${selected}` : null
  )
  const projection = useResource<ScenarioProjection>(
    wantPlan ? `${FINANCE_PATHS.scenarios}/${selected}/projection` : null,
    {
      horizon_months: horizon ?? undefined,
      currency: target ?? undefined,
      today: todayDate(),
    }
  )
  const comparison = useResource<ScenarioComparison>(
    pane === 'compare' && selected && vs ? FINANCE_PATHS.scenarioCompare : null,
    { a: selected, b: vs, currency: target ?? undefined }
  )
  const currencies = useResource<ListResponse<CurrencyInfo>>(FINANCE_PATHS.currencies)

  const rows = scenarios.data?.items ?? []
  const total = scenarios.data?.total ?? 0
  const current = detail.data && detail.data.id === selected ? detail.data : null
  const items = useMemo(() => current?.items ?? [], [current])
  const curve = projection.data && projection.data.scenario.id === selected ? projection.data : null
  const compare =
    comparison.data && comparison.data.a.id === selected && comparison.data.b.id === vs
      ? comparison.data
      : null
  const missing = scenarios.error?.status === 404 || detail.error?.status === 404

  /** The codes the lines are actually written in — the reason a total can come back null. */
  const lineCodes = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) if (item.currency) set.add(item.currency)
    if (current?.currency) set.add(current.currency)
    return Array.from(set)
  }, [items, current])

  // `?scenario=` and `?vs=` are deep links: they select rows even if a filter hides them.
  useEffect(() => {
    const wanted = params.get('scenario')
    if (!wanted) return
    setSelected(wanted)
    setStatus(null)
    setKind(null)
    const other = params.get('vs')
    if (other) {
      setVs(other)
      setPane('compare')
    }
  }, [params])

  function refresh() {
    invalidate(...FINANCE_SCOPE)
    scenarios.reload()
    detail.reload()
    projection.reload()
    comparison.reload()
  }

  function open(row: CostScenario) {
    setSelected(row.id)
    setHorizon(null)
    if (row.id === vs) setVs(null)
  }

  function pickSort(next: string) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(FINANCE_DEFAULT_DIR[next] ?? 'asc')
  }

  function clearFilters() {
    setTerm('')
    setStatus(null)
    setKind(null)
  }

  async function runAction(row: CostScenario, verb: 'duplicate' | 'activate') {
    setBusy(`${row.id}:${verb}`)
    try {
      if (verb === 'duplicate') {
        const copy = await api<{ scenario: CostScenario; copied_items: number }>(
          `${FINANCE_PATHS.scenarios}/${row.id}/duplicate`,
          { method: 'POST' }
        )
        toastSuccess(`Copied as ${copy.scenario.name}`, {
          description: `${countLabel(copy.copied_items, 'line')} came with it — a copy starts as a draft`,
        })
        setSelected(copy.scenario.id)
        setHorizon(null)
      } else {
        const result = await api<{ scenario: CostScenario; archived: { id: string; name: string } | null }>(
          `${FINANCE_PATHS.scenarios}/${row.id}/activate`,
          { method: 'POST' }
        )
        toastSuccess('Plan set active', {
          description: result.archived
            ? `${result.archived.name} was archived — only one plan is active at a time`
            : row.name,
        })
      }
      refresh()
    } catch (e) {
      toastError(verb === 'duplicate' ? 'Could not copy the plan' : 'Could not activate the plan', {
        description: errorMessage(e),
      })
    } finally {
      setBusy(null)
    }
  }

  async function remove(row: CostScenario) {
    try {
      await api(`${FINANCE_PATHS.scenarios}/${row.id}`, { method: 'DELETE' })
      toastSuccess('Plan deleted', { description: `${row.name} and its lines` })
      if (selected === row.id) setSelected(null)
      if (vs === row.id) setVs(null)
      refresh()
    } catch (e) {
      toastError('Could not delete the plan', { description: errorMessage(e) })
    } finally {
      setDeleting(null)
    }
  }

  async function removeItem(item: CostScenarioItem) {
    try {
      await api(`${FINANCE_PATHS.scenarioItems}/${item.id}`, { method: 'DELETE' })
      toastSuccess('Line removed', { description: `${item.label} — the curve was rebuilt without it` })
      refresh()
    } catch (e) {
      toastError('Could not remove the line', { description: errorMessage(e) })
    } finally {
      setDeletingItem(null)
    }
  }

  const statuses = (enums.scenario_status ?? ['draft', 'active', 'archived']) as ScenarioStatus[]
  const kinds = (enums.scenario_kind ?? ['personal', 'business', 'hybrid']) as ScenarioKind[]
  const directions = (enums.scenario_item_direction ?? ['cost', 'income']) as ScenarioDirection[]
  const recurrences = SCENARIO_RECURRENCES
  const storedHorizon = current?.horizon_months ?? null
  const active = rows.find((row) => row.status === 'active') ?? null

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Cost Scenarios</h1>
          <p className="os-micro mt-2">
            A plan is a list of lines and a window of months. The curve, the break-even month
            and the runway are rebuilt from those lines every time you look at them — nothing
            here adds money in the browser.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div role="tablist" aria-label="Scenario view" className="flex items-center gap-4">
            <ModeTab
              label="Plan"
              active={pane === 'plan'}
              onSelect={() => setPane('plan')}
            />
            <ModeTab
              label="Compare"
              active={pane === 'compare'}
              onSelect={() => {
                setPane('compare')
                if (!vs && selected) {
                  const other = rows.find((row) => row.id !== selected) ?? null
                  if (other) setVs(other.id)
                }
              }}
            />
          </div>
          <Button size="sm" onClick={() => setScenarioDialog({ row: null })}>
            <Plus /> New plan
          </Button>
        </div>
      </header>

      {missing ? (
        <ErrorBlock
          error={scenarios.error ?? detail.error}
          onRetry={refresh}
          title="This API has no Finance endpoints yet"
          className="border-line"
        />
      ) : (
        <>
          <FilterBar>
            <InlineSearch
              value={term}
              onChange={setTerm}
              placeholder="Search plan names and notes…"
              className="max-w-xs"
            />
            <FilterChip active={status === null} onClick={() => setStatus(null)} count={total}>
              All plans
            </FilterChip>
            {statuses.map((item) => (
              <FilterChip
                key={item}
                active={status === item}
                onClick={() => setStatus((prev) => (prev === item ? null : item))}
              >
                {enumLabel(item)}
              </FilterChip>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
            {kinds.map((item) => (
              <FilterChip
                key={item}
                active={kind === item}
                onClick={() => setKind((prev) => (prev === item ? null : item))}
              >
                {enumLabel(item)}
              </FilterChip>
            ))}
            {status || kind || term ? (
              <button
                type="button"
                onClick={clearFilters}
                className="os-tap-none text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                clear
              </button>
            ) : null}
            <span className="os-micro ml-auto shrink-0">
              {active
                ? status === 'active'
                  ? `active plan · ${active.name}`
                  : `active in this list · ${active.name}`
                : 'no active plan in this list'}
            </span>
          </FilterBar>

          {/* ------------------------------------------------------------------ index -- */}
          <Panel
            title="Plans"
            description={
              scenarios.data
                ? `${countLabel(total, 'plan')} on record${
                    status || kind || search ? ' — filtered by the API, not here' : ''
                  }`
                : 'Reading /cost-scenarios…'
            }
          >
            {scenarios.loading && rows.length === 0 ? (
              <div className="px-4 py-3">
                <LoadingBlock rows={4} />
              </div>
            ) : scenarios.error ? (
              <div className="px-4 py-3">
                <ErrorBlock error={scenarios.error} onRetry={scenarios.reload} />
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyBlock
                  title={status || kind || search ? 'No plan matches those filters' : 'No plans yet'}
                  description={
                    status || kind || search
                      ? 'The list you see is what the API returned for these filters — clear them and the plans come back.'
                      : 'A plan starts as a name, a first month and a window. Add lines after it exists, and the curve appears on its own.'
                  }
                  icon={<GitCompareArrows className="size-5" />}
                  gridHeight={search || status || kind ? 24 : 48}
                  action={
                    status || kind || search ? (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setScenarioDialog({ row: null })}>
                        <Plus /> New plan
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%]">
                      <SortHeader active={sort === 'name'} dir={dir} onClick={() => pickSort('name')}>
                        Plan
                      </SortHeader>
                    </TableHead>
                    <TableHead>
                      <SortHeader active={sort === 'start'} dir={dir} onClick={() => pickSort('start')}>
                        First month
                      </SortHeader>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">Window</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">Lines</span>
                    </TableHead>
                    <TableHead>
                      <span className="os-label">Status</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <SortHeader active={sort === 'updated'} dir={dir} onClick={() => pickSort('updated')}>
                        Updated
                      </SortHeader>
                    </TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => open(row)}
                      className={cn(
                        'cursor-pointer',
                        selected === row.id ? 'bg-canvas-deep' : null
                      )}
                    >
                      <TableCell className="max-w-0 px-3 py-2">
                        <p className="truncate text-[13px] text-foreground">{row.name}</p>
                        <p className="os-micro mt-0.5 truncate">
                          {enumLabel(row.kind)}
                          {row.currency ? ` · ${row.currency}` : ''}
                          {row.base_income_profile_id ? ' · profile on file' : ''}
                        </p>
                      </TableCell>
                      <TableCell className="os-mono whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                        {monthLabel(row.start_month)}
                      </TableCell>
                      <TableCell className="os-mono px-3 py-2 text-right text-[12px] tabular-nums text-foreground">
                        {row.horizon_months} mo
                      </TableCell>
                      <TableCell className="os-mono px-3 py-2 text-right text-[12px] tabular-nums text-muted-foreground">
                        {row.item_count}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <StatusLabel status={row.status} />
                      </TableCell>
                      <TableCell className="os-mono px-3 py-2 text-right text-[12px] tabular-nums text-muted-foreground">
                        {formatDate(row.updated_at)}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            label={`Duplicate ${row.name} as a draft`}
                            size="icon-sm"
                            variant="ghost"
                            disabled={busy === `${row.id}:duplicate`}
                            onClick={(event) => {
                              event.stopPropagation()
                              runAction(row, 'duplicate')
                            }}
                          >
                            <Copy className="size-3.5" />
                          </IconButton>
                          {row.status === 'active' ? null : (
                            <IconButton
                              label={`Set ${row.name} active — the plan that was active is archived`}
                              size="icon-sm"
                              variant="ghost"
                              disabled={busy === `${row.id}:activate`}
                              onClick={(event) => {
                                event.stopPropagation()
                                runAction(row, 'activate')
                              }}
                            >
                              <Power className="size-3.5" />
                            </IconButton>
                          )}
                          <IconButton
                            label={`Edit ${row.name}`}
                            size="icon-sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              setScenarioDialog({ row })
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${row.name}`}
                            size="icon-sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleting(row)
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          {/* ------------------------------------------------------------------ panes -- */}
          {!selected ? (
            <EmptyBlock
              title="Pick a plan to see its curve"
              description="The projection is recomputed from the plan's lines on every read, so what you see is the answer to the question you just asked — a shorter window, a different currency, one edited line."
              icon={<GitCompareArrows className="size-5" />}
              gridHeight={56}
            />
          ) : pane === 'compare' ? (
            <ComparePane
              rows={rows}
              selected={selected}
              vs={vs}
              compare={compare}
              loading={comparison.loading}
              error={comparison.error}
              onRetry={comparison.reload}
              onPick={(id) => {
                setVs(id)
                if (id === selected) setSelected(null)
              }}
              onPickLeft={(id) => {
                setSelected(id)
                if (id === vs) setVs(null)
              }}
              onBack={() => setPane('plan')}
            />
          ) : detail.loading && !current ? (
            <LoadingBlock rows={6} label="Loading the plan…" />
          ) : detail.error ? (
            <ErrorBlock error={detail.error} onRetry={detail.reload} />
          ) : !current ? (
            <EmptyBlock
              title="That plan is no longer on the API"
              description="The id came from a link, but the row it names is gone — deleted, or in another workspace."
              icon={<Trash2 className="size-5" />}
              gridHeight={40}
            />
          ) : (
            <PlanPane
              current={current}
              items={items}
              curve={curve}
              projectionLoading={projection.loading}
              projectionError={projection.error}
              onRetry={projection.reload}
              lineCodes={lineCodes}
              horizon={horizon}
              storedHorizon={storedHorizon}
              onHorizon={setHorizon}
              target={target}
              codes={(currencies.data?.items ?? []).map((row) => row.code)}
              onTarget={setTarget}
              busy={busy}
              onEdit={() => setScenarioDialog({ row: current })}
              onDuplicate={() => runAction(current, 'duplicate')}
              onActivate={() => runAction(current, 'activate')}
              onAddItem={() => setItemDialog({ row: null })}
              onEditItem={(item) => setItemDialog({ row: item })}
              onDeleteItem={(item) => setDeletingItem(item)}
              onCompare={() => {
                const other = rows.find((row) => row.id !== current.id) ?? null
                if (!other) {
                  toastError('A comparison needs a second plan', {
                    description: 'Create another plan, or duplicate this one and change its lines.',
                  })
                  return
                }
                setVs(other.id)
                setPane('compare')
              }}
            />
          )}
        </>
      )}

      {scenarioDialog ? (
        <ScenarioDialog
          row={scenarioDialog.row}
          defaultCurrency={defaultCurrency}
          kinds={kinds}
          statuses={statuses}
          onOpenChange={(next) => {
            if (!next) setScenarioDialog(null)
          }}
          onSaved={(saved) => {
            setSelected(saved.id)
            setScenarioDialog(null)
            refresh()
          }}
        />
      ) : null}

      {itemDialog && current ? (
        <ItemDialog
          scenario={current}
          row={itemDialog.row}
          defaultCurrency={current.currency ?? defaultCurrency}
          directions={directions}
          recurrences={recurrences}
          onOpenChange={(next) => {
            if (!next) setItemDialog(null)
          }}
          onSaved={() => {
            setItemDialog(null)
            refresh()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title="Delete this plan?"
        description="Its lines go with it — the curve cannot be rebuilt afterwards, and nothing else points at a scenario."
        confirmLabel="Delete plan"
        requireText={deleting?.name}
        onConfirm={() => {
          if (deleting) remove(deleting)
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingItem)}
        onOpenChange={(next) => {
          if (!next) setDeletingItem(null)
        }}
        title="Remove this line?"
        description={
          deletingItem
            ? `${deletingItem.label} leaves the plan, and the projection is rebuilt without it on the next read.`
            : undefined
        }
        confirmLabel="Remove line"
        onConfirm={() => {
          if (deletingItem) removeItem(deletingItem)
        }}
      />
    </div>
  )
}

/* --------------------------------------------------------------------- header --- */

function ModeTab({
  label,
  active,
  onSelect,
}: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'os-tap-none relative pb-1 text-[12.5px] transition-colors duration-150 before:absolute before:inset-x-0 before:bottom-0 before:h-[2px] before:bg-foreground before:opacity-0',
        active
          ? 'font-medium text-foreground before:opacity-100'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}

/* -------------------------------------------------------------------- plan pane -- */

function PlanPane({
  current,
  items,
  curve,
  projectionLoading,
  projectionError,
  onRetry,
  lineCodes,
  horizon,
  storedHorizon,
  onHorizon,
  target,
  codes,
  onTarget,
  busy,
  onEdit,
  onDuplicate,
  onActivate,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onCompare,
}: {
  current: CostScenario
  items: CostScenarioItem[]
  curve: ScenarioProjection | null
  projectionLoading: boolean
  projectionError: OsApiError | null
  onRetry: () => void
  lineCodes: string[]
  horizon: number | null
  storedHorizon: number | null
  onHorizon: (next: number | null) => void
  target: string | null
  codes: string[]
  onTarget: (next: string | null) => void
  busy: string | null
  onEdit: () => void
  onDuplicate: () => void
  onActivate: () => void
  onAddItem: () => void
  onEditItem: (item: CostScenarioItem) => void
  onDeleteItem: (item: CostScenarioItem) => void
  onCompare: () => void
}) {
  const named = curve ? curve.currency : null
  const months = curve?.months ?? []
  const effective = curve ? curve.horizon_months : storedHorizon
  const unlisted = items.filter((item) => !item.recurrence || item.recurrence === 'none')

  return (
    <div className="space-y-4">
      <Panel
        title={current.name}
        description={
          current.notes ||
          `${enumLabel(current.kind)} plan — ${countLabel(items.length, 'line')} recorded`
        }
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onCompare}>
              <GitCompareArrows /> Compare
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === `${current.id}:duplicate`}
              onClick={onDuplicate}
            >
              <Copy /> Duplicate
            </Button>
            {current.status === 'active' ? null : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === `${current.id}:activate`}
                onClick={onActivate}
              >
                <Power /> Set active
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
          </div>
        }
      >
        <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 px-4 pb-1 pt-2 sm:grid-cols-4">
          <MoneyHero
            label="Net across the window"
            value={curve ? curve.totals.net : null}
            currency={named}
            className="col-span-2 sm:col-span-2"
            hint={
              curve === null ? (
                projectionLoading ? (
                  <span>rebuilding the curve…</span>
                ) : (
                  <span className="text-danger">the projection did not load</span>
                )
              ) : named ? (
                <span>
                  {effective} months from {monthLabel(months[0]?.month ?? current.start_month.slice(0, 7))} ·{' '}
                  {named}
                </span>
              ) : (
                <span>
                  these lines are in {lineCodes.length > 1 ? lineCodes.join(' / ') : 'more than one currency'} — no
                  blended total is sent, so name a currency below
                </span>
              )
            }
          />
          <Stat
            label="Break-even"
            value={
              curve === null
                ? '—'
                : curve.break_even_month
                  ? monthLabel(curve.break_even_month)
                  : 'not inside'
            }
          />
          <Stat
            label="Runway"
            value={runwayReading(curve)}
            tone={
              curve && curve.currency !== null && curve.runway_months !== null && curve.runway_months <= 0
                ? 'danger'
                : 'default'
            }
          />
          <Stat label="Lines" value={items.length} />
          <Stat
            label="Window asked"
            value={horizon === null ? `stored (${storedHorizon ?? '—'})` : `${horizon} mo`}
          />
        </div>

        {curve === null && projectionError ? (
          <div className="px-4 pb-4">
            <ErrorBlock error={projectionError} onRetry={onRetry} />
          </div>
        ) : curve ? (
          <div className="space-y-4 px-4 pb-4 pt-4">
            {/* ---------------------------------------------------- window + currency --- */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line pb-3">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <p className="os-label mr-1">Window</p>
                <WindowChip
                  active={horizon === null}
                  onClick={() => onHorizon(null)}
                  label={storedHorizon ? `stored · ${storedHorizon}` : 'stored'}
                />
                {[6, 12, 24, 36].map((months2) => (
                  <WindowChip
                    key={months2}
                    active={horizon === months2}
                    onClick={() => onHorizon(months2)}
                    label={`${months2} mo`}
                  />
                ))}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <p className="os-label">Currency of the curve</p>
                <TargetSelect value={target} codes={codes} onChange={onTarget} />
              </div>
            </div>
            <p className="os-micro -mt-2">
              <span className="os-mono">horizon_months</span> and{' '}
              <span className="os-mono">currency</span> go to the API as query parameters, and
              the window also changes how a <span className="os-mono">one_time</span> line is
              spread — a wider window is not just more months of the same figure.
            </p>

            {/* ------------------------------------------------------------- charts --- */}
            <div className="grid min-w-0 gap-6 lg:grid-cols-2">
              <InOutBars
                series={months.map((row) => ({
                  month: row.month,
                  income: row.income,
                  expense: row.cost,
                  net: row.net,
                }))}
                currency={named}
                height={96}
              />
              <CumulativeCurve
                months={months.map((row) => ({ month: row.month, cumulative: row.cumulative }))}
                currency={named}
                breakEvenMonth={curve.break_even_month}
                height={120}
              />
            </div>

            {/* -------------------------------------------------------- month table --- */}
            <div className="max-h-[320px] min-w-0 overflow-auto rounded-os border border-line">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>
                      <span className="os-label">Month</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">In</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">Out</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">Net</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="os-label">Cumulative</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.map((row) => (
                    <TableRow
                      key={row.month}
                      className={cn(row.month === curve.break_even_month ? 'bg-canvas-deep' : null)}
                    >
                      <TableCell className="os-mono whitespace-nowrap px-3 py-1.5 text-[12px] tabular-nums text-foreground">
                        {monthLabel(row.month)}
                        {row.month === curve.break_even_month ? (
                          <span className="os-label ml-2 text-muted-foreground">break-even</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-right">
                        <MoneyCell value={row.income} currency={named} sign="never" />
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-right">
                        <MoneyCell value={row.cost} currency={named} sign="never" />
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-right">
                        <MoneyCell
                          value={row.net}
                          currency={named}
                          tone={row.net !== null && row.net < 0 ? 'text-danger' : undefined}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-right">
                        <MoneyCell
                          value={row.cumulative}
                          currency={named}
                          tone={
                            row.cumulative !== null && row.cumulative < 0 ? 'text-danger' : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {Object.keys(curve.assumptions).length > 0 || current.base_income_profile_id ? (
              <p className="os-micro">
                Assumptions and an income profile are stored on the plan and echoed back by the
                API, but this curve is built from the lines alone — nothing here applies an
                inflation rate or a tax model to the months.{' '}
                <span className="os-mono text-muted-foreground">
                  {current.base_income_profile_id ? 'profile set · ' : ''}
                  {Object.keys(curve.assumptions)
                    .map((key) => `${key}=${String(curve.assumptions[key])}`)
                    .join(' ') || 'no assumptions'}
                </span>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="px-4 pb-4 pt-4">
            <LoadingBlock rows={4} label="Rebuilding the curve…" />
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------------------- lines -- */}
      <Panel
        title={`Lines (${items.length})`}
        description="Each line is one figure with a cadence and a window. The API turns it into a monthly amount — weekly is ×52/12, yearly is ÷12, one_time divides by the window — and signs it by direction."
        action={
          <Button size="sm" onClick={onAddItem}>
            <Plus /> Add a line
          </Button>
        }
      >
        {items.length === 0 ? (
          <div className="px-4 py-4">
            <EmptyBlock
              title="This plan has no lines yet"
              description="Add rent, a salary, a subscription — anything with a figure and a cadence. The curve above needs at least one."
              icon={<Plus className="size-5" />}
              gridHeight={40}
              action={
                <Button size="sm" onClick={onAddItem}>
                  <Plus /> Add a line
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {unlisted.length > 0 ? (
              <p className="os-micro border-b border-line px-4 py-2 text-warning">
                {countLabel(unlisted.length, 'line')} has no cadence, so{' '}
                {unlisted.length === 1 ? 'it is' : 'they are'} not in the curve at all — set a
                recurrence, or remove{' '}
                {unlisted.length === 1 ? 'it' : 'them'}.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <span className="os-label">Line</span>
                  </TableHead>
                  <TableHead>
                    <span className="os-label">Side</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">Amount</span>
                  </TableHead>
                  <TableHead>
                    <span className="os-label">Cadence</span>
                  </TableHead>
                  <TableHead>
                    <span className="os-label">Covers</span>
                  </TableHead>
                  <TableHead className="w-16 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    id={`scenario-item-${item.id}`}
                    onClick={() => onEditItem(item)}
                    className="cursor-pointer"
                  >
                    <TableCell className="max-w-0 px-3 py-2">
                      <p className="truncate text-[13px] text-foreground">{item.label}</p>
                      {item.notes ? (
                        <p className="os-micro mt-0.5 truncate">{item.notes}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <DirectionTag direction={item.direction} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <MoneyCell value={item.amount} currency={item.currency} sign="never" />
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span className="os-label text-muted-foreground">
                        {item.recurrence && item.recurrence !== 'none'
                          ? enumLabel(item.recurrence)
                          : 'no cadence'}
                      </span>
                    </TableCell>
                    <TableCell className="os-mono px-3 py-2 text-[12px] tabular-nums text-muted-foreground">
                      {windowText(item.starts_on, item.ends_on)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          label={`Edit ${item.label}`}
                          size="icon-sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEditItem(item)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Remove ${item.label} from the plan`}
                          size="icon-sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteItem(item)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Panel>
    </div>
  )
}

/**
 * `runway_months` is the number of months the plan pays for before the cumulative net goes
 * under zero, and it is `null` in two different situations — the curve never goes under, or
 * no month could be named in one currency. They are not the same sentence.
 */
function runwayReading(curve: ScenarioProjection | null): string {
  if (!curve) return '—'
  if (curve.currency === null) return 'unnamed'
  if (curve.runway_months === null) return 'clears the window'
  if (curve.runway_months <= 0) return 'none'
  return `${curve.runway_months} mo`
}

function windowText(starts: string | null, ends: string | null): string {
  if (!starts && !ends) return 'the whole window'
  if (starts && !ends) return `${formatDate(starts)} →`
  if (!starts && ends) return `→ ${formatDate(ends)}`
  return `${formatDate(starts)} → ${formatDate(ends)}`
}

function WindowChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'os-tap-none h-7 whitespace-nowrap rounded-os border px-2.5 text-[11.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground',
        active
          ? 'border-foreground text-foreground'
          : 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground'
      )}
    >
      <span className="os-mono tabular-nums">{label}</span>
    </button>
  )
}

const AS_STORED = '__as_stored'

/** A query control, not a form field: it decides whether `?currency=` is sent at all. */
function TargetSelect({
  value,
  codes,
  onChange,
}: {
  value: string | null
  codes: string[]
  onChange: (next: string | null) => void
}) {
  return (
    <Select
      value={value ?? AS_STORED}
      onValueChange={(next) => onChange(next === AS_STORED ? null : next)}
    >
      <SelectTrigger size="sm" aria-label="Currency of the curve" className="w-[10rem] rounded-os">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <Option value={AS_STORED}>As the plan is written</Option>
        {codes.map((code) => (
          <Option key={code} value={code}>
            {code}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ----------------------------------------------------------------- compare pane -- */

function ComparePane({
  rows,
  selected,
  vs,
  compare,
  loading,
  error,
  onRetry,
  onPick,
  onPickLeft,
  onBack,
}: {
  rows: CostScenario[]
  selected: string
  vs: string | null
  compare: ScenarioComparison | null
  loading: boolean
  error: OsApiError | null
  onRetry: () => void
  onPick: (id: string) => void
  onPickLeft: (id: string) => void
  onBack: () => void
}) {
  const named = compare ? compare.currency : null

  return (
    <Panel
      title="Two plans on one month axis"
      description="The axis is the union of both windows, so neither curve is cut or padded. A month outside one plan's horizon is printed as outside — the API does not extend a plan you stopped at month six."
      action={
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back to the plan
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4 px-4 pb-4 pt-3 sm:grid-cols-2">
        <ScenarioChoice label="A" value={selected} rows={rows} onChange={onPickLeft} />
        <ScenarioChoice label="B" value={vs} rows={rows} onChange={onPick} />
      </div>

      {!vs ? (
        <div className="px-4 pb-4">
          <EmptyBlock
            title="A second plan is needed"
            description="Pick what to compare against, or duplicate this plan from its row above and change its lines."
            icon={<GitCompareArrows className="size-5" />}
            gridHeight={40}
          />
        </div>
      ) : error ? (
        <div className="px-4 pb-4">
          <ErrorBlock error={error} onRetry={onRetry} />
        </div>
      ) : compare ? (
        <div className="space-y-5 px-4 pb-5">
          <div className="grid min-w-0 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            {[
              { side: 'A' as const, row: compare.a, totals: compare.totals.a, breakEven: compare.break_even.a },
              { side: 'B' as const, row: compare.b, totals: compare.totals.b, breakEven: compare.break_even.b },
            ].map((entry) => (
              <div key={entry.side} className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="os-mono text-[11px] text-faint">{entry.side}</span>
                  <p className="min-w-0 truncate text-[13px] text-foreground">{entry.row.name}</p>
                </div>
                <p className="os-micro mt-1">
                  {entry.row.horizon_months} months from{' '}
                  {monthLabel(entry.row.start_month.slice(0, 7))} · {entry.row.item_count} lines
                </p>
                <p className="os-mono mt-2 text-[16px] tabular-nums text-foreground">
                  {formatMoney(entry.totals.net, named)}
                  <span className="os-micro ml-2">net over its own window</span>
                </p>
                <p className="os-micro mt-1">
                  break-even: {entry.breakEven ? monthLabel(entry.breakEven) : 'not inside'}
                </p>
              </div>
            ))}
          </div>

          <p className="os-micro">
            {compare.break_even.first === null
              ? 'Neither plan breaks even inside the axis.'
              : compare.break_even.first === 'both'
                ? 'Both plans reach zero in the same month.'
                : compare.break_even.first === 'a'
                  ? `${compare.a.name} breaks even first.`
                  : `${compare.b.name} breaks even first.`}
            {compare.currency
              ? ` Every figure is named in ${compare.currency} by the API.`
              : ' Neither plan could be named in one currency, so every figure below is an em dash rather than a total.'}
          </p>

          <DualCurve compare={compare} />

          <div className="max-h-[320px] min-w-0 overflow-auto rounded-os border border-line">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>
                    <span className="os-label">Month</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">A net</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">A total</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">B net</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">B total</span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="os-label">A − B</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.months.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell className="os-mono whitespace-nowrap px-3 py-1.5 text-[12px] tabular-nums text-foreground">
                      {monthLabel(row.month)}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right">
                      <MoneyCell
                        value={row.a.net}
                        currency={named}
                        tone={row.a.in_horizon ? undefined : 'text-faint'}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right">
                      <MoneyCell
                        value={row.a.cumulative}
                        currency={named}
                        tone={
                          !row.a.in_horizon
                            ? 'text-faint'
                            : row.a.cumulative !== null && row.a.cumulative < 0
                              ? 'text-danger'
                              : undefined
                        }
                      />
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right">
                      <MoneyCell
                        value={row.b.net}
                        currency={named}
                        tone={row.b.in_horizon ? undefined : 'text-faint'}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right">
                      <MoneyCell
                        value={row.b.cumulative}
                        currency={named}
                        tone={
                          !row.b.in_horizon
                            ? 'text-faint'
                            : row.b.cumulative !== null && row.b.cumulative < 0
                              ? 'text-danger'
                              : undefined
                        }
                      />
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right">
                      <MoneyCell value={row.delta} currency={named} sign="always" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-4">
          {loading ? (
            <LoadingBlock rows={4} label="Putting both curves on one axis…" />
          ) : (
            <p className="os-micro text-faint">Nothing to show yet.</p>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * Both cumulative curves on one shared scale. Nothing is interpolated between months and no
 * figure is added here: a month the API could not name is simply not a point on the line.
 */
function DualCurve({ compare }: { compare: ScenarioComparison }) {
  const model = useMemo(() => {
    const axis = compare.months
    const series = (side: 'a' | 'b') =>
      axis.flatMap((row, index) => {
        const curve = row[side]
        return typeof curve.cumulative === 'number' && Number.isFinite(curve.cumulative)
          ? [{ index, month: row.month, value: curve.cumulative, inHorizon: curve.in_horizon }]
          : []
      })
    const a = series('a')
    const b = series('b')
    const values = [...a.map((p) => p.value), ...b.map((p) => p.value)]
    if (values.length === 0) return null
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    const span = max - min || 1
    const last = Math.max(axis.length - 1, 1)
    const x = (index: number) => (index / last) * 100
    const y = (value: number) => 100 - ((value - min) / span) * 100
    return {
      a: a.map((p) => ({ ...p, x: x(p.index), y: y(p.value) })),
      b: b.map((p) => ({ ...p, x: x(p.index), y: y(p.value) })),
      zero: y(0),
      min,
      max,
      months: axis.length,
    }
  }, [compare])

  if (!model) {
    return (
      <p className="os-micro">
        {compare.months.length === 0
          ? 'Neither plan has a month to plot.'
          : 'No month of either plan can be named in one currency, so there is nothing to draw — name a currency above.'}
      </p>
    )
  }

  const line = (points: Array<{ x: number; y: number }>) =>
    points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  return (
    <div className="min-w-0">
      <div className="os-micro flex items-baseline justify-between">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 2" className="h-[2px] w-4" aria-hidden="true">
              <line x1="0" y1="1" x2="16" y2="1" stroke="hsl(var(--os-foreground))" strokeWidth="2" />
            </svg>
            A · {compare.a.name}
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 2" className="h-[2px] w-4" aria-hidden="true">
              <line
                x1="0"
                y1="1"
                x2="16"
                y2="1"
                stroke="hsl(var(--os-line-strong))"
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            </svg>
            B · {compare.b.name}
          </span>
        </span>
        <span className="os-mono tabular-nums">
          {formatMoney(model.max, compare.currency, { compact: true })} /{' '}
          {formatMoney(model.min, compare.currency, { compact: true })}
        </span>
      </div>
      <div className="relative mt-2 h-[140px]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`Cumulative net for ${compare.a.name} and ${compare.b.name} across ${model.months} months`}
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
          {model.a.length > 1 ? (
            <polyline
              points={line(model.a)}
              fill="none"
              stroke="hsl(var(--os-foreground))"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {model.b.length > 1 ? (
            <polyline
              points={line(model.b)}
              fill="none"
              stroke="hsl(var(--os-line-strong))"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>
      <div className="os-micro mt-1 flex justify-between">
        <span>{monthLabel(compare.months[0]?.month)}</span>
        <span>{monthLabel(compare.months[compare.months.length - 1]?.month)}</span>
      </div>
    </div>
  )
}

function ScenarioChoice({
  label,
  value,
  rows,
  onChange,
}: {
  label: string
  value: string | null
  rows: CostScenario[]
  onChange: (next: string) => void
}) {
  return (
    <Field label={`Plan ${label}`} hint="only the plans this list returned can be picked">
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger aria-label={`Plan ${label}`}>
          <SelectValue placeholder="Choose a plan…" />
        </SelectTrigger>
        <SelectContent>
          {rows.map((row) => (
            <Option key={row.id} value={row.id}>
              {row.name} · {enumLabel(row.status)} · {row.horizon_months} mo
            </Option>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/* ---------------------------------------------------------------------- dialogs -- */

interface ScenarioForm {
  name: string
  kind: ScenarioKind
  start_month: string
  horizon_months: string
  currency: string
  base_income_profile_id: string | null
  status: ScenarioStatus
  notes: string
}

function ScenarioDialog({
  row,
  defaultCurrency,
  kinds,
  statuses,
  onOpenChange,
  onSaved,
}: {
  row: CostScenario | null
  defaultCurrency: string
  kinds: ScenarioKind[]
  statuses: ScenarioStatus[]
  onOpenChange: (next: boolean) => void
  onSaved: (saved: CostScenario) => void
}) {
  const editing = Boolean(row)
  const [values, setValues] = useState<ScenarioForm>(() => blankScenario(row, defaultCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const patch = (next: Partial<ScenarioForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.name.trim()) next.name = 'A plan you cannot name is a plan you cannot pick'
    if (!/^\d{4}-\d{2}$/.test(values.start_month)) {
      next.start_month = 'Pick the first month the curve covers'
    }
    const horizon = Number(values.horizon_months)
    if (!values.horizon_months.trim() || !Number.isInteger(horizon)) {
      next.horizon_months = 'Whole months only'
    } else if (horizon < 1 || horizon > 120) {
      next.horizon_months = 'Between 1 and 120 months'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    // The API floors a start date to the month, so a month picker sends the first of it.
    const body: CostScenarioInput = {
      name: values.name.trim(),
      kind: values.kind,
      start_month: `${values.start_month}-01`,
      horizon_months: Number(values.horizon_months),
      status: values.status,
      notes: values.notes.trim() || null,
      base_income_profile_id: values.base_income_profile_id,
    }
    // A currency is only ever added: the API has no way to blank one back out.
    if (values.currency) body.currency = values.currency
    try {
      const saved = await api<CostScenario>(
        editing ? `${FINANCE_PATHS.scenarios}/${row?.id}` : FINANCE_PATHS.scenarios,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Plan saved' : 'Plan created', {
        description: `${saved.name} — ${saved.horizon_months} months from ${monthLabel(saved.start_month)}`,
      })
      onSaved(saved)
    } catch (e) {
      setIssues(issuesFrom(e))
      setFormError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit plan' : 'New plan'}
          description="Only the shape of the plan is stored here — the months come from its lines, so a plan with no lines is a flat line."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Field label="Name" htmlFor="scenario-name" required error={issues.name ?? null}>
            <Input
              id="scenario-name"
              value={values.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="Next 12 months, no raise"
              aria-invalid={Boolean(issues.name) || undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First month" htmlFor="scenario-start" required error={issues.start_month ?? null}>
              <Input
                id="scenario-start"
                type="month"
                className="os-mono"
                value={values.start_month}
                onChange={(event) => patch({ start_month: event.target.value })}
                aria-invalid={Boolean(issues.start_month) || undefined}
              />
            </Field>
            <Field
              label="Window"
              htmlFor="scenario-horizon"
              required
              hint="months, 1–120 — a one_time line is divided by this"
              error={issues.horizon_months ?? null}
            >
              <Input
                id="scenario-horizon"
                inputMode="numeric"
                className="os-mono"
                value={values.horizon_months}
                onChange={(event) => patch({ horizon_months: event.target.value })}
                aria-invalid={Boolean(issues.horizon_months) || undefined}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" htmlFor="scenario-kind">
              <EnumSelect
                id="scenario-kind"
                value={values.kind}
                onChange={(next) => patch({ kind: next as ScenarioKind })}
                options={kinds}
              />
            </Field>
            <Field
              label="Status"
              htmlFor="scenario-status"
              hint="activating here archives the plan that was active"
              error={issues.status ?? null}
            >
              <EnumSelect
                id="scenario-status"
                value={values.status}
                onChange={(next) => patch({ status: next as ScenarioStatus })}
                options={statuses}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <CurrencySelect
              id="scenario-currency"
              label="Plan currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              hint="what the plan is written in — lines can still differ"
              error={issues.currency ?? null}
            />
            <ProfileSelect
              value={values.base_income_profile_id}
              onChange={(next) => patch({ base_income_profile_id: next })}
              hint="kept on the plan; the curve is built from lines"
              error={issues.base_income_profile_id ?? null}
            />
          </div>
          <Field label="Notes" htmlFor="scenario-notes" hint="the assumption you are testing" error={issues.notes ?? null}>
            <Textarea
              id="scenario-notes"
              rows={3}
              value={values.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {editing ? 'Save plan' : 'Create plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankScenario(row: CostScenario | null, defaultCurrency: string): ScenarioForm {
  return row
    ? {
        name: row.name,
        kind: row.kind,
        start_month: row.start_month.slice(0, 7),
        horizon_months: String(row.horizon_months),
        currency: row.currency ?? '',
        base_income_profile_id: row.base_income_profile_id,
        status: row.status,
        notes: row.notes ?? '',
      }
    : {
        name: '',
        kind: 'personal',
        start_month: todayDate().slice(0, 7),
        horizon_months: '12',
        currency: defaultCurrency,
        base_income_profile_id: null,
        status: 'draft',
        notes: '',
      }
}

interface ItemForm {
  label: string
  direction: ScenarioDirection
  amount: string
  currency: string
  recurrence: ScenarioRecurrence
  starts_on: string
  ends_on: string
  category_id: string | null
  notes: string
}

function ItemDialog({
  scenario,
  row,
  defaultCurrency,
  directions,
  recurrences,
  onOpenChange,
  onSaved,
}: {
  scenario: CostScenario
  row: CostScenarioItem | null
  defaultCurrency: string
  directions: ScenarioDirection[]
  recurrences: ScenarioRecurrence[]
  onOpenChange: (next: boolean) => void
  onSaved: () => void
}) {
  const editing = Boolean(row)
  const [values, setValues] = useState<ItemForm>(() => blankItem(row, defaultCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const patch = (next: Partial<ItemForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.label.trim()) next.label = 'The curve legend reads this'
    const amount = moneyInputError(values.amount, { required: true, min: 0 })
    if (amount) next.amount = amount
    if (values.starts_on && values.ends_on && values.ends_on < values.starts_on) {
      next.ends_on = 'The line would end before it starts'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    const amount = parseMoney(values.amount)
    if (amount === null) {
      // validate() already refused it; this keeps an unparseable figure off the wire.
      setIssues({ amount: 'Enter an amount' })
      return
    }
    setPending(true)
    setFormError(null)
    const body: CostScenarioItemInput = {
      label: values.label.trim(),
      direction: values.direction,
      amount,
      recurrence: values.recurrence,
      // A blank date clears the window; an empty string would be a 422.
      starts_on: values.starts_on || null,
      ends_on: values.ends_on || null,
      category_id: values.category_id,
      notes: values.notes.trim() || null,
    }
    // Same rule as a plan: a line keeps its code unless a new one is named.
    if (values.currency) body.currency = values.currency
    try {
      await api<CostScenarioItem>(
        editing
          ? `${FINANCE_PATHS.scenarioItems}/${row?.id}`
          : `${FINANCE_PATHS.scenarios}/${scenario.id}/items`,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Line saved' : 'Line added', {
        description: `${body.label} — the projection was rebuilt`,
      })
      onSaved()
    } catch (e) {
      setIssues(issuesFrom(e))
      setFormError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const spread =
    values.recurrence === 'none'
      ? 'with no cadence this line is not in the curve at all'
      : values.recurrence === 'one_time'
        ? `one_time is divided by the window, so a ${scenario.horizon_months}-month plan spreads it over ${scenario.horizon_months} months`
        : 'the API turns this into a monthly figure — weekly is ×52/12, yearly is ÷12'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit line' : 'Add a line'}
          description={`Into ${scenario.name}. A line is one figure, one side of the ledger, and the months it covers — the monthly amount is the API's calculation, never this form's.`}
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <Field label="Label" htmlFor="item-label" required error={issues.label ?? null}>
              <Input
                id="item-label"
                value={values.label}
                onChange={(event) => patch({ label: event.target.value })}
                placeholder="Rent"
                aria-invalid={Boolean(issues.label) || undefined}
              />
            </Field>
            <Field label="Side" htmlFor="item-direction" hint="cost reduces the net">
              <EnumSelect
                id="item-direction"
                value={values.direction}
                onChange={(next) => patch({ direction: next as ScenarioDirection })}
                options={directions}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField
              label="Amount"
              id="item-amount"
              required
              min={0}
              value={values.amount}
              onChange={(next) => patch({ amount: next })}
              currency={values.currency}
              hint="the figure as you pay or receive it — direction carries the sign"
            />
            <CurrencySelect
              id="item-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              hint="lines in another code make the total unnamed unless you convert"
              error={issues.currency ?? null}
            />
          </div>
          {issues.amount && !values.amount ? (
            <p className="os-micro -mt-2 text-danger">{issues.amount}</p>
          ) : null}
          <Field label="Cadence" htmlFor="item-recurrence" hint={spread} error={issues.recurrence ?? null}>
            <EnumSelect
              id="item-recurrence"
              value={values.recurrence}
              onChange={(next) => patch({ recurrence: next as ScenarioRecurrence })}
              options={recurrences}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Covers from" htmlFor="item-starts" error={issues.starts_on ?? null}>
              <Input
                id="item-starts"
                type="date"
                className="os-mono"
                value={values.starts_on}
                onChange={(event) => patch({ starts_on: event.target.value })}
              />
            </Field>
            <Field
              label="Until"
              htmlFor="item-ends"
              hint="blank means it keeps running"
              error={issues.ends_on ?? null}
            >
              <Input
                id="item-ends"
                type="date"
                className="os-mono"
                value={values.ends_on}
                onChange={(event) => patch({ ends_on: event.target.value })}
                aria-invalid={Boolean(issues.ends_on) || undefined}
              />
            </Field>
          </div>
          <CategorySelect
            value={values.category_id}
            onChange={(next) => patch({ category_id: next })}
            hint="ties the line to a spend category — optional"
            error={issues.category_id ?? null}
          />
          <Field label="Notes" htmlFor="item-notes" error={issues.notes ?? null}>
            <Textarea
              id="item-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {editing ? 'Save line' : 'Add line'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankItem(row: CostScenarioItem | null, defaultCurrency: string): ItemForm {
  return row
    ? {
        label: row.label,
        direction: row.direction,
        amount: String(row.amount),
        currency: row.currency ?? '',
        recurrence: row.recurrence ?? 'none',
        starts_on: row.starts_on ?? '',
        ends_on: row.ends_on ?? '',
        category_id: row.category_id,
        notes: row.notes ?? '',
      }
    : {
        label: '',
        direction: 'cost',
        amount: '',
        currency: defaultCurrency,
        recurrence: 'monthly',
        starts_on: '',
        ends_on: '',
        category_id: null,
        notes: '',
      }
}

/* ----------------------------------------------------------------------- shared -- */

/**
 * A 422 arrives with `details[]` naming the field that failed; the message belongs on the
 * control that caused it rather than in a banner nobody reads.
 */
function issuesFrom(e: unknown): Record<string, string> {
  const err = e as { details?: Array<{ field?: string[] | string; message: string }> }
  const mapped: Record<string, string> = {}
  for (const detail of err.details ?? []) {
    const path = Array.isArray(detail.field) ? detail.field.join('.') : String(detail.field ?? '')
    const key = path.split('.').pop()
    if (key) mapped[key] = detail.message
  }
  return mapped
}
