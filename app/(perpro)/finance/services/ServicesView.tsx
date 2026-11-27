'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Archive, Boxes, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  AmountField,
  CurrencySelect,
  IntervalSuffix,
  MoneyCell,
  SortHeader,
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
import { Checkbox } from '@/components/os/ui/checkbox'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { EnumSelect } from '@/components/os/pickers'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource, useWorkspace } from '@/lib/os/hooks'
import {
  FINANCE_DEFAULT_DIR,
  FINANCE_PATHS,
  FINANCE_SCOPE,
  type PlanInterval,
  type Service,
  type ServiceInput,
  type ServicePlan,
  type ServicePlanInput,
  type ServiceUnit,
  type SortDir,
} from '@/lib/os/finance'
import type { ListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate } from '@/lib/os/format'
import { formatMoney, moneyInputError, parseMoney } from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

type ServiceTab = 'plans' | 'detail'

/**
 * Service catalogue — what can be sold, at what unit, in which plans. A service row stores
 * only what you type; the money in the detail pane (`revenue`) is what `GET /services/{id}`
 * worked out from your income rows, and `monthly_price` / `effective_rate` / subscriber
 * counts are computed by the API on every read. Nothing here adds money in the browser, and
 * a service whose income spans currencies reports `total: null` instead of a blended figure.
 */
export default function ServicesView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const defaultCurrency = workspace.data?.currency ?? 'INR'

  const [term, setTerm] = useState(params.get('q') ?? '')
  const [archived, setArchived] = useState(false)
  const [unit, setUnit] = useState<ServiceUnit | null>(null)
  const [sort, setSort] = useState('updated')
  const [dir, setDir] = useState<SortDir>(FINANCE_DEFAULT_DIR.updated ?? 'desc')
  const [selected, setSelected] = useState<string | null>(params.get('service'))
  const [tab, setTab] = useState<ServiceTab>('plans')
  const [serviceDialog, setServiceDialog] = useState<{ row: Service | null } | null>(null)
  const [planDialog, setPlanDialog] = useState<{ row: ServicePlan | null; serviceId: string } | null>(
    null
  )
  const [deleting, setDeleting] = useState<Service | null>(null)
  const [deletingPlan, setDeletingPlan] = useState<ServicePlan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const search = useDebounced(term)

  const services = useResource<ListResponse<Service>>(FINANCE_PATHS.services, {
    q: search || undefined,
    active: archived ? 'false' : 'true',
    unit: unit ?? undefined,
    sort,
    dir,
  })
  // The detail, its plans and its revenue come from one call so the panes cannot disagree.
  const detail = useResource<Service>(
    selected ? `${FINANCE_PATHS.services}/${selected}` : null
  )

  const rows = services.data?.items ?? []
  const missing = services.error?.status === 404 || detail.error?.status === 404
  const current = detail.data && detail.data.id === selected ? detail.data : null
  const plans = useMemo(() => current?.plans ?? [], [current])

  // `?service=` is a deep link, not a filter — an archived row must still open when named.
  useEffect(() => {
    const wanted = params.get('service')
    if (!wanted) return
    setSelected(wanted)
    setArchived(false)
  }, [params])

  function refresh() {
    invalidate(...FINANCE_SCOPE)
    services.reload()
    detail.reload()
  }

  function pickSort(next: string) {
    if (next === sort) {
      setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSort(next)
    setDir(FINANCE_DEFAULT_DIR[next] ?? 'asc')
  }

  async function patchService(row: Service, body: ServiceInput, message: string) {
    setBusy(`${row.id}:${Object.keys(body)[0] ?? 'patch'}`)
    try {
      await api<Service>(`${FINANCE_PATHS.services}/${row.id}`, { method: 'PATCH', body })
      toastSuccess(message, { description: row.name })
      refresh()
    } catch (e) {
      toastError('That change did not stick', { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  async function patchPlan(plan: ServicePlan, body: ServicePlanInput, message: string) {
    setBusy(`${plan.id}:active`)
    try {
      await api<ServicePlan>(`${FINANCE_PATHS.plans}/${plan.id}`, { method: 'PATCH', body })
      toastSuccess(message, { description: plan.name })
      refresh()
    } catch (e) {
      toastError('That change did not stick', { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const units = (enums.service_unit ?? ['hour', 'day', 'fixed', 'retainer', 'seat']) as ServiceUnit[]

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Service catalogue</h1>
          <p className="os-micro mt-2">
            What you sell, the unit it is priced in, and the plans that package it. Income rows
            point here, which is how revenue per service and live subscriber counts stay honest.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setServiceDialog({ row: null })}>
            <Plus /> New service
          </Button>
        </div>
      </header>

      {missing ? (
        <ErrorBlock
          error={services.error ?? detail.error}
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
              placeholder="Search name, code, description…"
              className="max-w-xs"
            />
            <FilterChip active={!archived && unit === null} onClick={() => {
              setArchived(false)
              setUnit(null)
            }}>
              Everything live
            </FilterChip>
            {units.map((value) => (
              <FilterChip
                key={value}
                active={unit === value}
                onClick={() => setUnit(unit === value ? null : value)}
              >
                {enumLabel(value)}
              </FilterChip>
            ))}
            <FilterChip active={archived} onClick={() => setArchived(!archived)}>
              {archived ? 'Showing archived' : 'Show archived'}
            </FilterChip>
          </FilterBar>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <Panel
              dense
              title={archived ? 'Archived services' : 'Services'}
              description={
                services.data
                  ? `${countLabel(rows.length, 'service', 'services')} in this view · tap a row to open it`
                  : 'The catalogue income and plans hang from'
              }
              bodyClassName="px-0 py-0"
            >
              {services.error && services.data === undefined ? (
                <div className="px-3 py-3">
                  <ErrorBlock error={services.error} onRetry={services.reload} />
                </div>
              ) : services.loading && services.data === undefined ? (
                <div className="px-3 py-3">
                  <LoadingBlock rows={5} />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-3">
                  <EmptyBlock
                    title={
                      archived
                        ? 'Nothing is archived'
                        : unit
                          ? `No live service is priced per ${enumLabel(unit)}`
                          : 'No services yet'
                    }
                    description="A service is one line: what you sell and the unit it is priced in. Plans then package it at a price and an interval."
                    icon={<Boxes className="size-5" />}
                    action={
                      <Button size="sm" onClick={() => setServiceDialog({ row: null })}>
                        <Plus /> New service
                      </Button>
                    }
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">
                        <SortHeader active={sort === 'name'} dir={dir} onClick={() => pickSort('name')}>
                          Service
                        </SortHeader>
                      </TableHead>
                      <TableHead className="w-[6rem]">Unit</TableHead>
                      <TableHead className="w-[7.5rem] pr-4 text-right">
                        <SortHeader
                          active={sort === 'price'}
                          dir={dir}
                          onClick={() => pickSort('price')}
                          align="right"
                        >
                          Default
                        </SortHeader>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => setSelected(row.id)}
                        aria-selected={row.id === selected}
                        className={cn(
                          'cursor-pointer',
                          row.id === selected ? 'bg-canvas-deep' : null
                        )}
                      >
                        <TableCell className="pl-4">
                          <span className="block truncate text-[13px] text-foreground">
                            {row.name}
                          </span>
                          <span className="os-micro block truncate">
                            {row.code ? `${row.code} · ` : ''}
                            {formatDate(row.updated_at)}
                            {row.source === 'demo' ? ' · demo' : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="os-micro">{enumLabel(row.unit ?? 'hour')}</span>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          {row.default_price === null || row.default_price === undefined ? (
                            <span className="os-micro">not priced</span>
                          ) : (
                            <MoneyCell value={row.default_price} currency={row.currency} sign="never" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="px-4 pb-3 pt-2">
                <p className="os-micro flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => pickSort('updated')}
                    className={cn(
                      'underline underline-offset-2 transition-colors duration-150',
                      sort === 'updated' ? 'text-foreground' : 'hover:text-foreground'
                    )}
                  >
                    sort by last change
                  </button>
                  {unit || archived || search ? (
                    <button
                      type="button"
                      onClick={() => {
                        setUnit(null)
                        setArchived(false)
                        setTerm('')
                      }}
                      className="text-foreground underline underline-offset-2"
                    >
                      clear the filters
                    </button>
                  ) : null}
                </p>
              </div>
            </Panel>

            <Panel
              dense
              title={current ? current.name : 'A service'}
              description={
                current
                  ? current.description ??
                    (current.code ? `Coded ${current.code}` : 'No code recorded')
                  : 'Pick a service on the left to see its plans and what it has earned.'
              }
              action={
                current ? (
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={current.active ? 'Archive this service' : 'Bring it back'}
                      size="icon-sm"
                      disabled={busy === `${current.id}:active`}
                      onClick={() =>
                        void patchService(
                          current,
                          { active: !current.active },
                          current.active ? 'Service archived' : 'Service restored'
                        )
                      }
                    >
                      <Archive className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Edit service"
                      size="icon-sm"
                      onClick={() => setServiceDialog({ row: current })}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Delete service"
                      size="icon-sm"
                      onClick={() => setDeleting(current)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                ) : null
              }
              bodyClassName={current ? undefined : 'px-3 py-3'}
            >
              {!current ? (
                detail.loading && selected ? (
                  <LoadingBlock rows={5} />
                ) : detail.error && selected ? (
                  <ErrorBlock error={detail.error} onRetry={detail.reload} />
                ) : (
                  <EmptyBlock
                    title="No service open"
                    description="The detail pane reads one endpoint — the service, its plans and its revenue together — so what you see is what the API just worked out."
                    icon={<Boxes className="size-5" />}
                    gridHeight={40}
                  />
                )
              ) : (
                <div className="space-y-4">
                  <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 px-4 pb-1 pt-1 sm:grid-cols-4">
                    <Metric
                      label="Unit price"
                      value={
                        current.default_price === null || current.default_price === undefined
                          ? 'not priced'
                          : formatMoney(current.default_price, current.currency, { sign: 'never' })
                      }
                    />
                    <Metric
                      label="Priced per"
                      value={`${enumLabel(current.unit ?? 'hour')}${
                        current.currency ? ` · ${current.currency}` : ''
                      }`}
                    />
                    <Metric
                      label="Earned"
                      value={
                        current.revenue
                          ? current.revenue.total === null
                            ? 'mixed currencies'
                            : formatMoney(current.revenue.total, current.revenue.currency, {
                                compact: true,
                              })
                          : '—'
                      }
                      hint={
                        current.revenue
                          ? `${countLabel(current.revenue.paid_count, 'paid row')} · ${countLabel(
                              current.revenue.row_count ?? 0,
                              'row'
                            )} on file`
                          : 'nothing read yet'
                      }
                    />
                    <Metric
                      label="Still owed"
                      value={
                        current.revenue
                          ? current.revenue.invoiced_amount === null
                            ? 'mixed currencies'
                            : formatMoney(current.revenue.invoiced_amount, current.revenue.currency, {
                                compact: true,
                              })
                          : '—'
                      }
                      hint="invoiced + overdue rows on this service"
                    />
                  </div>

                  <div
                    role="tablist"
                    aria-label="Service detail"
                    className="flex items-center gap-6 border-b border-line px-4"
                  >
                    {(['plans', 'detail'] as ServiceTab[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        className={cn(
                          'os-tap-none -mb-px inline-flex h-7 items-center border-b text-[11px] uppercase tracking-[0.14em] transition-colors duration-150',
                          tab === key
                            ? 'border-foreground text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {key === 'plans' ? `Plans (${plans.length})` : 'Record'}
                      </button>
                    ))}
                    {tab === 'plans' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto bg-transparent"
                        onClick={() => setPlanDialog({ row: null, serviceId: current.id })}
                      >
                        <Plus /> New plan
                      </Button>
                    ) : null}
                  </div>

                  {tab === 'plans' ? (
                    <div className="px-0 pb-1">
                      {plans.length === 0 ? (
                        <div className="px-4 py-3">
                          <EmptyBlock
                            title="No plans packaged from this service"
                            description="A plan is a price and an interval — subscribers renew against it, and the revenue above follows those renewals."
                            icon={<Boxes className="size-5" />}
                            gridHeight={36}
                            action={
                              <Button
                                size="sm"
                                onClick={() => setPlanDialog({ row: null, serviceId: current.id })}
                              >
                                <Plus /> New plan
                              </Button>
                            }
                          />
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-4">Plan</TableHead>
                              <TableHead className="w-[7.5rem] text-right">Price</TableHead>
                              <TableHead className="w-[6.5rem] text-right">Per month</TableHead>
                              <TableHead className="w-[6.5rem] pr-4 text-right">
                                Subscribers
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {plans.map((plan) => (
                              <PlanRow
                                key={plan.id}
                                plan={plan}
                                busy={busy}
                                onEdit={() =>
                                  setPlanDialog({ row: plan, serviceId: plan.service_id })
                                }
                                onDelete={() => setDeletingPlan(plan)}
                                onToggle={() =>
                                  void patchPlan(
                                    plan,
                                    { active: !plan.active },
                                    plan.active ? 'Plan archived' : 'Plan restored'
                                  )
                                }
                              />
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  ) : (
                    <dl className="min-w-0 divide-y divide-line-faint px-4 pb-3">
                      <Line label="Code" value={current.code ?? '—'} mono />
                      <Line label="Unit" value={enumLabel(current.unit ?? 'hour')} />
                      <Line
                        label="Description"
                        value={current.description ?? 'nothing written yet'}
                      />
                      <Line
                        label="State"
                        value={current.active ? 'live' : 'archived — new rows cannot pick it'}
                      />
                      <Line label="Added" value={formatDate(current.created_at)} mono />
                      <Line label="Last change" value={formatDate(current.updated_at)} mono />
                      <Line label="Origin" value={enumLabel(current.source)} />
                      <Line
                        label="Utilisation"
                        value={
                          current.utilisation_hours === null ||
                          current.utilisation_hours === undefined
                            ? 'no time tracking wired to services yet'
                            : `${current.utilisation_hours} h`
                        }
                      />
                    </dl>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <ServiceDialog
        open={serviceDialog !== null}
        row={serviceDialog?.row ?? null}
        defaultCurrency={defaultCurrency}
        units={units}
        onOpenChange={(next) => (next ? undefined : setServiceDialog(null))}
        onSaved={() => {
          refresh()
          setServiceDialog(null)
        }}
      />

      <PlanDialog
        open={planDialog !== null}
        row={planDialog?.row ?? null}
        serviceId={planDialog?.serviceId ?? ''}
        defaultCurrency={defaultCurrency}
        intervals={(enums.plan_interval ?? [
          'monthly',
          'quarterly',
          'yearly',
          'one_time',
        ]) as PlanInterval[]}
        onOpenChange={(next) => (next ? undefined : setPlanDialog(null))}
        onSaved={() => {
          refresh()
          setPlanDialog(null)
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? 'service'}”`}
        description="Its plans go with it. Subscriptions that billed from them stay, but lose the plan link, and income rows already booked are not touched. Archive it instead if the history matters."
        confirmLabel="Delete service"
        onConfirm={() =>
          api(`${FINANCE_PATHS.services}/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Service deleted')
            setSelected(null)
            refresh()
          })
        }
      />

      <ConfirmDialog
        open={!!deletingPlan}
        onOpenChange={(next) => (next ? undefined : setDeletingPlan(null))}
        title={`Delete “${deletingPlan?.name ?? 'plan'}”`}
        description="Subscriptions on it are kept and left unlinked, so a renewal history is never deleted by accident."
        confirmLabel="Delete plan"
        onConfirm={() =>
          api(`${FINANCE_PATHS.plans}/${deletingPlan?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Plan deleted')
            refresh()
          })
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------- pieces -- */

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="os-label">{label}</p>
      <p className="os-mono mt-1 truncate text-[15px] leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint ? <p className="os-micro mt-1 truncate">{hint}</p> : null}
    </div>
  )
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="os-label shrink-0">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[12.5px] text-foreground', mono && 'os-mono')}>
        {value}
      </dd>
    </div>
  )
}

function PlanRow({
  plan,
  busy,
  onEdit,
  onDelete,
  onToggle,
}: {
  plan: ServicePlan
  busy: string | null
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const pending = busy === `${plan.id}:active`
  return (
    <TableRow>
      <TableCell className="pl-4">
        <button
          type="button"
          onClick={onEdit}
          className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className="block truncate text-[13px] text-foreground">{plan.name}</span>
          <span className="os-micro block truncate">
            {enumLabel(plan.interval)}
            {plan.included_units ? ` · ${plan.included_units} included` : ''}
            {plan.overage_rate ? ` · overage ${formatMoney(plan.overage_rate, plan.currency)}` : ''}
            {plan.trial_days ? ` · ${plan.trial_days}d trial` : ''}
            {!plan.active ? ' · archived' : ''}
          </span>
        </button>
      </TableCell>
      <TableCell className="text-right">
        <span className="flex items-baseline justify-end gap-1">
          <MoneyCell value={plan.price} currency={plan.currency} sign="never" />
          <IntervalSuffix interval={plan.interval} />
        </span>
        {plan.monthly_price !== null && plan.monthly_price !== undefined ? (
          <span className="os-micro block">
            {formatMoney(plan.monthly_price, plan.currency, { sign: 'never' })}/mo
            {plan.effective_rate !== null && plan.effective_rate !== undefined
              ? ` · ${formatMoney(plan.effective_rate, plan.currency, { sign: 'never' })}/unit`
              : ''}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <span className="os-mono text-[12.5px] tabular-nums text-muted-foreground">
          {plan.subscriber_count ?? 0}
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            label={plan.active ? 'Archive plan' : 'Restore plan'}
            size="icon-sm"
            disabled={pending}
            onClick={onToggle}
          >
            <Archive className="size-3.5" />
          </IconButton>
          <IconButton label="Edit plan" size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label="Delete plan" size="icon-sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

/* ------------------------------------------------------------------- dialogs -- */

interface ServiceForm {
  name: string
  code: string
  description: string
  unit: ServiceUnit
  default_price: string
  currency: string
  active: boolean
}

function ServiceDialog({
  open,
  row,
  defaultCurrency,
  units,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  row: Service | null
  defaultCurrency: string
  units: ServiceUnit[]
  onOpenChange: (next: boolean) => void
  onSaved: (saved: Service) => void
}) {
  const editing = Boolean(row?.id)
  const [values, setValues] = useState<ServiceForm>(() => blankService(defaultCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues(
      row
        ? {
            name: row.name,
            code: row.code ?? '',
            description: row.description ?? '',
            unit: row.unit ?? 'hour',
            default_price: row.default_price === null ? '' : String(row.default_price),
            currency: row.currency ?? defaultCurrency,
            active: row.active,
          }
        : blankService(defaultCurrency)
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  const patch = (next: Partial<ServiceForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.name.trim()) next.name = 'What is the service called?'
    if (values.code && values.code.length > 32) next.code = 'Codes are up to 32 characters'
    const price = moneyInputError(values.default_price, { min: 0 })
    if (price) next.default_price = price
    if (values.default_price && !values.currency) {
      next.currency = 'A price needs a currency to be stored with it'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const price = parseMoney(values.default_price)
    const body: ServiceInput = {
      name: values.name.trim(),
      code: values.code.trim() || null,
      description: values.description.trim() || null,
      unit: values.unit,
      default_price: price,
      active: values.active,
    }
    // Currency only travels with a price; without one the service is unpriced.
    if (price !== null) body.currency = values.currency
    try {
      const saved = await api<Service>(
        editing ? `${FINANCE_PATHS.services}/${row?.id}` : FINANCE_PATHS.services,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Service saved' : 'Service added', { description: saved.name })
      onSaved(saved)
    } catch (e) {
      applyIssues(e, setIssues, setFormError, {
        field: 'code',
        message: 'Another service already uses that code',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit service' : 'Add a service'}
          description="The unit decides how a plan prices it: per hour, per day, per seat, fixed per project, or a retainer."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Field label="Name" htmlFor="service-name" required error={issues.name ?? null}>
            <Input
              id="service-name"
              value={values.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="Design retainer"
              aria-invalid={Boolean(issues.name) || undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="service-code"
              hint="unique per workspace — optional"
              error={issues.code ?? null}
            >
              <Input
                id="service-code"
                value={values.code}
                onChange={(event) => patch({ code: event.target.value })}
                className="os-mono"
                placeholder="DESIGN"
                aria-invalid={Boolean(issues.code) || undefined}
              />
            </Field>
            <Field label="Priced per" htmlFor="service-unit" required>
              <EnumSelect
                id="service-unit"
                value={values.unit}
                onChange={(next) => patch({ unit: next as ServiceUnit })}
                options={units}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <AmountField
              label="Default price"
              id="service-price"
              value={values.default_price}
              onChange={(next) => patch({ default_price: next })}
              currency={values.currency}
              min={0}
              hint="the unit rate a plan starts from — leave empty for unpriced"
            />
            <CurrencySelect
              id="service-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              hint={values.default_price ? null : 'only stored with a price'}
              error={issues.currency ?? null}
            />
          </div>
          <Field
            label="Description"
            htmlFor="service-description"
            hint="what the buyer gets, in one line"
            error={issues.description ?? null}
          >
            <Textarea
              id="service-description"
              rows={2}
              value={values.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2.5">
            <Checkbox
              checked={values.active}
              onCheckedChange={(next) => patch({ active: next === true })}
            />
            <span>
              <span className="block text-[12.5px] text-foreground">Live</span>
              <span className="os-micro block">
                unchecking it archives the service — it stays on old income rows but cannot be
                picked by new ones
              </span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save service' : 'Add service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PlanForm {
  name: string
  interval: PlanInterval
  price: string
  currency: string
  included_units: string
  overage_rate: string
  trial_days: string
  active: boolean
}

function PlanDialog({
  open,
  row,
  serviceId,
  defaultCurrency,
  intervals,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  row: ServicePlan | null
  serviceId: string
  defaultCurrency: string
  intervals: PlanInterval[]
  onOpenChange: (next: boolean) => void
  onSaved: () => void
}) {
  const editing = Boolean(row?.id)
  const [values, setValues] = useState<PlanForm>(() => blankPlan(defaultCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues(
      row
        ? {
            name: row.name,
            interval: row.interval,
            price: String(row.price),
            currency: row.currency ?? defaultCurrency,
            included_units: row.included_units === null ? '' : String(row.included_units),
            overage_rate: row.overage_rate === null ? '' : String(row.overage_rate),
            trial_days: row.trial_days === null ? '' : String(row.trial_days),
            active: row.active,
          }
        : blankPlan(defaultCurrency)
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  const patch = (next: Partial<PlanForm>) => setValues((prev) => ({ ...prev, ...next }))

  function wholeNumber(text: string, label: string, field: string, next: Record<string, string>) {
    if (!text.trim()) return null
    const value = Number(text)
    if (!Number.isFinite(value)) {
      next[field] = `${label} has to be a number`
      return null
    }
    if (!Number.isInteger(value)) {
      next[field] = `${label} counts whole units — no decimals`
      return null
    }
    return value
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.name.trim()) next.name = 'What is the plan called?'
    const price = moneyInputError(values.price, { required: true, min: 0 })
    if (price) next.price = price
    if (!values.currency) next.currency = 'Pick the currency it bills in'
    if (values.interval !== 'one_time' && !values.currency) {
      next.currency = 'A repeating plan needs a currency to be normalised monthly'
    }
    const units = wholeNumber(values.included_units, 'Included units', 'included_units', next)
    if (units !== null && units <= 0) next.included_units = 'Included units have to be above zero'
    const overage = moneyInputError(values.overage_rate, { min: 0 })
    if (overage) next.overage_rate = overage
    const trial = wholeNumber(values.trial_days, 'Trial days', 'trial_days', next)
    if (trial !== null && trial < 0) next.trial_days = 'A trial cannot be negative'
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: ServicePlanInput = {
      service_id: serviceId,
      name: values.name.trim(),
      interval: values.interval,
      price: parseMoney(values.price) ?? 0,
      currency: values.currency,
      included_units: values.included_units.trim() ? Number(values.included_units) : null,
      overage_rate: parseMoney(values.overage_rate),
      trial_days: values.trial_days.trim() ? Number(values.trial_days) : null,
      active: values.active,
    }
    try {
      const saved = await api<ServicePlan>(
        editing ? `${FINANCE_PATHS.plans}/${row?.id}` : FINANCE_PATHS.plans,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Plan saved' : 'Plan added', { description: saved.name })
      onSaved()
    } catch (e) {
      applyIssues(e, setIssues, setFormError, {
        field: 'name',
        message: 'That plan name is already used on this service',
      })
    } finally {
      setPending(false)
    }
  }

  const price = parseMoney(values.price)
  const units = parseMoney(values.included_units)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit plan' : 'Add a plan'}
          description="Price and interval are stored exactly as you write them. The monthly figure, the per-unit rate and how many subscribers are on it are worked out by the API, never here."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Field label="Name" htmlFor="plan-name" required error={issues.name ?? null}>
            <Input
              id="plan-name"
              value={values.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="Monthly retainer"
              aria-invalid={Boolean(issues.name) || undefined}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <AmountField
              label="Price"
              id="plan-price"
              value={values.price}
              onChange={(next) => patch({ price: next })}
              currency={values.currency}
              required
              min={0}
            />
            <CurrencySelect
              id="plan-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              required
              error={issues.currency ?? null}
              hint={null}
            />
          </div>
          <Field label="Billed" htmlFor="plan-interval" required>
            <EnumSelect
              id="plan-interval"
              value={values.interval}
              onChange={(next) => patch({ interval: next as PlanInterval })}
              options={intervals}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Included units"
              htmlFor="plan-units"
              hint={values.interval === 'one_time' ? 'per project' : 'per period'}
              error={issues.included_units ?? null}
            >
              <Input
                id="plan-units"
                inputMode="numeric"
                value={values.included_units}
                onChange={(event) => patch({ included_units: event.target.value })}
                placeholder="40"
                aria-invalid={Boolean(issues.included_units) || undefined}
              />
            </Field>
            <Field label="Overage rate" htmlFor="plan-overage" error={issues.overage_rate ?? null}>
              <Input
                id="plan-overage"
                inputMode="decimal"
                value={values.overage_rate}
                onChange={(event) => patch({ overage_rate: event.target.value })}
                placeholder="120"
                aria-invalid={Boolean(issues.overage_rate) || undefined}
              />
            </Field>
            <Field label="Trial days" htmlFor="plan-trial" error={issues.trial_days ?? null}>
              <Input
                id="plan-trial"
                inputMode="numeric"
                value={values.trial_days}
                onChange={(event) => patch({ trial_days: event.target.value })}
                placeholder="14"
                aria-invalid={Boolean(issues.trial_days) || undefined}
              />
            </Field>
          </div>
          {price !== null && units !== null && units > 0 ? (
            <p className="os-micro border-t border-line-faint pt-3">
              with {units} units at {formatMoney(price, values.currency, { sign: 'never' })} the API
              reports a per-unit rate and a monthly figure on the row once it is saved — that
              division is its job, so it is not previewed here.
            </p>
          ) : null}
          <label className="flex items-start gap-2.5">
            <Checkbox
              checked={values.active}
              onCheckedChange={(next) => patch({ active: next === true })}
            />
            <span>
              <span className="block text-[12.5px] text-foreground">Offered</span>
              <span className="os-micro block">
                an archived plan stays on the subscriptions using it, but the picker hides it
              </span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save plan' : 'Add plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------------------- shared -- */

/**
 * A bad write comes back as 422 with `details[]` naming the field, or 409 when the value is
 * already taken; either way the message belongs on the control that caused it.
 */
function applyIssues(
  e: unknown,
  setIssues: (next: Record<string, string>) => void,
  setFormError: (next: string) => void,
  conflict: { field: string; message: string }
) {
  const err = e as { status?: number; details?: Array<{ field?: string[] | string; message: string }> }
  const mapped: Record<string, string> = {}
  for (const detail of err.details ?? []) {
    const path = Array.isArray(detail.field) ? detail.field.join('.') : String(detail.field ?? '')
    const key = path.split('.').pop()
    if (key) mapped[key] = detail.message
  }
  if (err.status === 409) mapped[conflict.field] = conflict.message
  setIssues(mapped)
  setFormError(errorMessage(e))
}

function blankService(defaultCurrency: string): ServiceForm {
  return {
    name: '',
    code: '',
    description: '',
    unit: 'hour',
    default_price: '',
    currency: defaultCurrency,
    active: true,
  }
}

function blankPlan(defaultCurrency: string): PlanForm {
  return {
    name: '',
    interval: 'monthly',
    price: '',
    currency: defaultCurrency,
    included_units: '',
    overage_rate: '',
    trial_days: '',
    active: true,
  }
}
