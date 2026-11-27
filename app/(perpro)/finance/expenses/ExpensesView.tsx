'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'

import {
  AmountField,
  CategoryDot,
  CategorySelect,
  CurrencySelect,
  IntervalSuffix,
  MoneyCell,
  MonthBars,
  PeriodNav,
  ShareList,
  SortHeader,
  DeltaTag,
  flattenCategories,
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
import { Checkbox } from '@/components/os/ui/checkbox'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { EnumSelect } from '@/components/os/pickers'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastSuccess } from '@/components/os/ui/toast'
import { api, apiUrl, errorMessage } from '@/lib/os/client'
import {
  invalidate,
  useDebounced,
  useEnums,
  useResource,
  useWorkspace,
} from '@/lib/os/hooks'
import {
  CATEGORY_COLORS,
  FINANCE_DEFAULT_DIR,
  FINANCE_PATHS,
  FINANCE_SCOPE,
  type Expense,
  type ExpenseCategory,
  type ExpenseCategoryInput,
  type ExpenseInput,
  type ExpenseRecurrence,
  type ExpenseSummary,
  type SortDir,
} from '@/lib/os/finance'
import type { ListResponse, PagedListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate, todayDate } from '@/lib/os/format'
import {
  formatMoney,
  monthBounds,
  monthKey,
  moneyInputError,
  moneyDelta,
  parseMoney,
} from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'

const PAGE = 100
const NONE = '__none'

/**
 * Expenses — the money screen the rest of Finance reads from. The list, the totals and the
 * category split are three real endpoints (`/expenses`, `/expenses/summary`,
 * `/expense-categories`); this page adds nothing up in the browser, it only formats.
 */
export default function ExpensesView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const workspace = useWorkspace()
  const defaultCurrency = workspace.data?.currency ?? 'INR'

  const [month, setMonth] = useState(() => monthKey(todayDate()) ?? todayDate().slice(0, 7))
  const [categoryId, setCategoryId] = useState<string | null>(params.get('category'))
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [recurring, setRecurring] = useState<'all' | 'yes' | 'no'>('all')
  const [sort, setSort] = useState<string>('paid_on')
  const [dir, setDir] = useState<SortDir>(FINANCE_DEFAULT_DIR.paid_on ?? 'desc')
  const [pages, setPages] = useState(1)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [categoryDialog, setCategoryDialog] = useState(false)
  const search = useDebounced(term)

  const thisMonth = monthKey(todayDate()) ?? todayDate().slice(0, 7)
  const bounds = useMemo(() => monthBounds(month), [month])
  const highlighted = params.get('expense')

  const summary = useResource<ExpenseSummary>(FINANCE_PATHS.expenseSummary, {
    month: bounds.from,
  })
  const categories = useResource<ListResponse<ExpenseCategory>>(FINANCE_PATHS.categories, {
    archived: 'false',
  })
  const expenses = useResource<PagedListResponse<Expense>>(FINANCE_PATHS.expenses, {
    from: bounds.from,
    to: bounds.to,
    category_id: categoryId ?? undefined,
    q: search || undefined,
    // `buildQuery` omits a `false` boolean, so the filter is sent as text.
    recurring: recurring === 'all' ? undefined : recurring === 'yes' ? 'true' : 'false',
    sort,
    dir,
    limit: PAGE * pages,
    offset: 0,
  })

  const rows = expenses.data?.items ?? []
  const total = expenses.data?.total ?? 0
  const missing = summary.error?.status === 404 || expenses.error?.status === 404

  useEffect(() => {
    if (!highlighted) return
    const node = document.getElementById(`expense-${highlighted}`)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted, rows.length])

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
    invalidate(...FINANCE_SCOPE)
    summary.reload()
    expenses.reload()
    categories.reload()
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Expenses</h1>
          <p className="os-micro mt-2">
            {expenses.data
              ? `${countLabel(total, 'expense', 'expenses')} in this window · ${countLabel(
                  categories.data?.total ?? 0,
                  'category'
                )} · the server does every total`
              : 'Spend you logged yourself, by month, category and vendor'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'bg-transparent')}
            href={apiUrl(FINANCE_PATHS.expenseExport, {
              from: bounds.from,
              to: bounds.to,
              category_id: categoryId ?? undefined,
            })}
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
            <Plus /> New expense
          </Button>
        </div>
      </header>

      {missing ? (
        <ErrorBlock
          error={summary.error ?? expenses.error}
          onRetry={refresh}
          title="This API has no Finance endpoints yet"
          className="border-line"
        />
      ) : (
        <>
          <FilterBar>
            <PeriodNav month={month} onChange={setMonth} thisMonth={thisMonth} />
            <InlineSearch
              value={term}
              onChange={(next) => {
                setTerm(next)
                setPages(1)
              }}
              placeholder="Search label, vendor, notes…"
              className="max-w-xs"
            />
            <FilterChip
              active={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              All categories
            </FilterChip>
            <FilterChip
              active={recurring === 'yes'}
              onClick={() => setRecurring(recurring === 'yes' ? 'all' : 'yes')}
            >
              Recurring
            </FilterChip>
            <FilterChip
              active={recurring === 'no'}
              onClick={() => setRecurring(recurring === 'no' ? 'all' : 'no')}
            >
              One-off
            </FilterChip>
            <button
              type="button"
              onClick={() => setCategoryDialog(true)}
              className="os-tap-none h-7 rounded-os border border-dashed border-line px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
            >
              New category
            </button>
          </FilterBar>

          {categoryId ? (
            <div className="os-micro -mt-1.5 flex items-center gap-2">
              <CategoryDot
                color={
                  (categories.data?.items ?? []).find((c) => c.id === categoryId)?.color ?? null
                }
              />
              <span>filtered to one category</span>
              <button
                type="button"
                onClick={() => setCategoryId(null)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                clear
              </button>
            </div>
          ) : null}

          <section className="os-panel min-w-0 px-4 py-3.5">
            {summary.error && summary.data === undefined ? (
              <ErrorBlock error={summary.error} onRetry={summary.reload} />
            ) : summary.loading && summary.data === undefined ? (
              <LoadingBlock rows={2} />
            ) : summary.data ? (
              <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
                <div className="col-span-2 sm:col-span-1">
                  <Stat
                    label={`Total · ${month}`}
                    value={formatMoney(summary.data.total, summary.data.currency, {
                      compact: true,
                    })}
                  />
                </div>
                <Stat
                  label="Entries"
                  value={summary.data.count}
                />
                <Stat
                  label="Recurring / month"
                  value={formatMoney(summary.data.recurring_monthly, summary.data.currency, {
                    compact: true,
                  })}
                />
                <div className="min-w-0">
                  <p className="os-label">vs previous month</p>
                  <p className="os-micro mt-1.5">
                    <DeltaTag
                      delta={moneyDelta(
                        summary.data.total,
                        summary.data.series.at(-2)?.total ?? null
                      )}
                      goodWhen="down"
                      currency={summary.data.currency}
                    />
                  </p>
                </div>
                <Stat
                  label="Currencies"
                  value={summary.data.by_currency.filter((row) => (row.amount ?? 0) !== 0).length || 1}
                />
              </div>
            ) : null}
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Panel
              dense
              title="Where it went"
              description="Tap a category to filter the table below by it."
            >
              <ResourceState
                resource={summary}
                skeleton={<p className="os-micro">Calculating the split for this month…</p>}
              >
                {(s) => (
                  <div className="space-y-4">
                    <ShareList
                      rows={s.by_category.map((row) => ({
                        id: row.category_id,
                        label: row.name,
                        color: row.color,
                        value: row.amount,
                      }))}
                      currency={s.currency}
                      total={s.total}
                      emptyLabel="Nothing in this month yet."
                      onSelect={(id) => {
                        setCategoryId(id)
                        setPages(1)
                      }}
                    />
                    <div className="border-t border-line-faint pt-3">
                      <p className="os-label mb-2">Twelve months</p>
                      <MonthBars series={s.series} currency={s.currency} />
                    </div>
                    {s.by_vendor.length ? (
                      <div className="border-t border-line-faint pt-3">
                        <p className="os-label mb-2">Vendors</p>
                        <ul className="min-w-0 space-y-1">
                          {s.by_vendor.slice(0, 6).map((vendor) => (
                            <li
                              key={vendor.vendor}
                              className="flex items-baseline justify-between gap-3"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setTerm(vendor.vendor)
                                  setPages(1)
                                }}
                                className="min-w-0 truncate text-[12.5px] text-foreground underline-offset-2 hover:underline"
                              >
                                {vendor.vendor}
                              </button>
                              <span className="flex shrink-0 items-baseline gap-2">
                                <MoneyCell value={vendor.amount} currency={s.currency} />
                                <span className="os-micro">{vendor.count}</span>
                              </span>
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
              title="The rows"
              description={
                expenses.data
                  ? `${countLabel(rows.length, 'entry', 'entries')} shown of ${total} · click a row to edit`
                  : 'Every expense inside the month above'
              }
              bodyClassName="px-0 py-0"
            >
              {expenses.error && expenses.data === undefined ? (
                <div className="px-3 py-3">
                  <ErrorBlock error={expenses.error} onRetry={expenses.reload} />
                </div>
              ) : expenses.loading && expenses.data === undefined ? (
                <div className="px-3 py-3">
                  <LoadingBlock rows={6} />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-3">
                  <EmptyBlock
                    title="Nothing logged in this window"
                    description="Change the month, clear the filters, or add the first expense. Recurring rows are normalised to a monthly figure by the server, never by this page."
                    icon={<Receipt className="size-5" />}
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(null)
                          setDialog(true)
                        }}
                      >
                        <Plus /> New expense
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
                            active={sort === 'paid_on'}
                            dir={dir}
                            onClick={() => pickSort('paid_on')}
                          >
                            Paid
                          </SortHeader>
                        </TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead className="w-[9rem]">Category</TableHead>
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
                        <TableHead className="w-16 pr-3" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((expense) => (
                        <ExpenseRow
                          key={expense.id}
                          expense={expense}
                          focused={expense.id === highlighted}
                          onEdit={() => {
                            setEditing(expense)
                            setDialog(true)
                          }}
                          onDelete={() => setDeleting(expense)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                  <div className="px-4 pb-3 pt-2">
                    <LoadMore
                      loaded={rows.length}
                      total={total}
                      loading={expenses.loading}
                      size={PAGE}
                      onMore={() => setPages((n) => n + 1)}
                      onReset={() => setPages(1)}
                    />
                    <p className="os-micro mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => pickSort('created')}
                        className={cn(
                          'underline underline-offset-2 transition-colors duration-150',
                          sort === 'created' ? 'text-foreground' : 'hover:text-foreground'
                        )}
                      >
                        sort by when it was entered
                      </button>
                      <span className="text-faint">
                        totals in {summary.data?.currency ?? defaultCurrency} only when every row shares it
                      </span>
                    </p>
                  </div>
                </>
              )}
            </Panel>
          </div>

          <Panel dense title="Categories" description="The tree the split above is built from.">
            <CategoryTree
              currency={summary.data?.currency ?? defaultCurrency}
              nodes={categories.data?.items ?? []}
              loading={categories.loading && categories.data === undefined}
              onSelect={(id) => {
                setCategoryId(id)
                setPages(1)
              }}
              activeId={categoryId}
            />
          </Panel>
        </>
      )}

      <ExpenseDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) setEditing(null)
        }}
        expense={editing}
        defaultCurrency={defaultCurrency}
        defaultPaidOn={monthKey(todayDate()) === month ? todayDate() : bounds.to}
        recurrences={enums.expense_recurrence ?? ['weekly', 'monthly', 'quarterly', 'yearly']}
        onSaved={refresh}
      />

      <CategoryDialog
        open={categoryDialog}
        onOpenChange={setCategoryDialog}
        categories={categories.data?.items ?? []}
        kinds={enums.expense_category_kind ?? ['fixed', 'variable', 'one_off', 'tax']}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.label ?? 'expense'}”`}
        description="The row goes and every total on this page is recomputed without it. Nothing else is touched."
        confirmLabel="Delete expense"
        onConfirm={() =>
          api(FINANCE_PATHS.expenses + `/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Expense deleted')
            refresh()
          })
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------- pieces -- */

function ExpenseRow({
  expense,
  focused,
  onEdit,
  onDelete,
}: {
  expense: Expense
  focused: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <TableRow id={`expense-${expense.id}`} className={cn(focused ? 'bg-canvas-deep' : null)}>
      <TableCell className="pl-4">
        <span className="os-mono whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
          {formatDate(expense.paid_on)}
        </span>
      </TableCell>
      <TableCell className="min-w-0">
        <button
          type="button"
          onClick={onEdit}
          className="os-tap-none -mx-1 block max-w-full rounded-os px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
        >
          <span className="block truncate text-[13px] text-foreground">{expense.label}</span>
          <span className="os-micro block truncate">
            {expense.vendor || 'no vendor'}
            {expense.invoice_number ? ` · ${expense.invoice_number}` : ''}
            {expense.recurring ? ' · recurring' : ''}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-1.5">
          <CategoryDot color={expense.category?.color ?? null} label={expense.category?.name} />
          <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
            {expense.category?.name ?? 'uncategorised'}
          </span>
        </span>
      </TableCell>
      <TableCell className="pr-4">
        <span className="flex items-baseline justify-end gap-1">
          <MoneyCell value={-Math.abs(expense.amount)} currency={expense.currency} />
          <IntervalSuffix interval={expense.recurrence} />
        </span>
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label={`Edit ${expense.label}`} size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`Delete ${expense.label}`} size="icon-sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

function CategoryTree({
  nodes,
  currency,
  loading,
  activeId,
  onSelect,
}: {
  nodes: ExpenseCategory[]
  currency: string
  loading: boolean
  activeId: string | null
  onSelect: (id: string | null) => void
}) {
  if (loading) return <LoadingBlock rows={4} />
  if (nodes.length === 0)
    return (
      <p className="os-micro">
        No categories yet. The demo seed creates rent, software, insurance, tax, food, travel and
        other; otherwise create one above and the split fills in.
      </p>
    )
  return (
    <ul className="min-w-0 space-y-0.5">
      {nodes.map((node) => (
        <CategoryLeaf
          key={node.id}
          node={node}
          currency={currency}
          activeId={activeId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function CategoryLeaf({
  node,
  currency,
  activeId,
  onSelect,
}: {
  node: ExpenseCategory
  currency: string
  activeId: string | null
  onSelect: (id: string | null) => void
}) {
  const active = activeId === node.id
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(active ? null : node.id)}
        className={cn(
          'os-tap-none -mx-1 flex w-full items-baseline justify-between gap-3 rounded-os px-1 py-1 text-left transition-colors duration-150 hover:bg-canvas-deep focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground',
          active ? 'bg-canvas-deep' : null
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CategoryDot color={node.color} label={node.name} />
          <span className="min-w-0 truncate text-[12.5px] text-foreground">{node.name}</span>
          <span className="os-micro shrink-0">{enumLabel(node.kind)}</span>
        </span>
        <span className="os-mono shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {formatMoney(node.amount_this_month ?? 0, currency)}
        </span>
      </button>
      {node.children?.length ? (
        <ul className="ml-4 border-l border-line-faint pl-2">
          {node.children.map((child) => (
            <CategoryLeaf
              key={child.id}
              node={child}
              currency={currency}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------- dialogs -- */

interface ExpenseForm {
  label: string
  amount: string
  currency: string
  paid_on: string
  category_id: string | null
  recurring: boolean
  recurrence: ExpenseRecurrence | null
  vendor: string
  invoice_number: string
  notes: string
}

function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  defaultCurrency,
  defaultPaidOn,
  recurrences,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  expense: Expense | null
  defaultCurrency: string
  defaultPaidOn: string
  recurrences: string[]
  onSaved: () => void
}) {
  const editing = Boolean(expense?.id)
  const [values, setValues] = useState<ExpenseForm>(() => blank(defaultCurrency, defaultPaidOn))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(
      expense
        ? {
            label: expense.label,
            amount: String(expense.amount),
            currency: expense.currency || defaultCurrency,
            paid_on: expense.paid_on,
            category_id: expense.category_id,
            recurring: expense.recurring,
            recurrence: expense.recurrence,
            vendor: expense.vendor ?? '',
            invoice_number: expense.invoice_number ?? '',
            notes: expense.notes ?? '',
          }
        : blank(defaultCurrency, defaultPaidOn)
    )
    setIssues({})
    setFormError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id])

  const patch = (next: Partial<ExpenseForm>) => setValues((prev) => ({ ...prev, ...next }))

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.label.trim()) next.label = 'A label is required — “Rent”, “Figma”, “Doctor”'
    const amount = moneyInputError(values.amount, { required: true, min: 0 })
    if (amount) next.amount = amount
    if (!values.currency) next.currency = 'Pick the currency the money actually left in'
    if (!values.paid_on) next.paid_on = 'Pick the date it was paid'
    if (values.recurring && (!values.recurrence || values.recurrence === 'none')) {
      next.recurrence = 'A recurring expense needs an interval'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: ExpenseInput = {
      label: values.label.trim(),
      amount: parseMoney(values.amount) ?? 0,
      currency: values.currency,
      paid_on: values.paid_on,
      category_id: values.category_id,
      recurring: values.recurring,
      recurrence: values.recurring ? values.recurrence ?? 'monthly' : 'none',
      vendor: values.vendor.trim() || null,
      invoice_number: values.invoice_number.trim() || null,
      notes: values.notes.trim() || null,
    }
    try {
      await api<Expense>(
        editing ? `${FINANCE_PATHS.expenses}/${expense?.id}` : FINANCE_PATHS.expenses,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      toastSuccess(editing ? 'Expense saved' : 'Expense logged', { description: body.label })
      onOpenChange(false)
      onSaved()
    } catch (e) {
      const message = errorMessage(e)
      setFormError(message)
      // The API's own 422 `details` win over the local copy, field by field.
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
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={editing ? 'Edit expense' : 'Log an expense'}
          description="The amount is stored as you write it. Recurring rows are counted once, at their monthly figure, in every burn and runway number."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}
          <Field label="Label" htmlFor="expense-label" required error={issues.label ?? null}>
            <Input
              id="expense-label"
              autoFocus
              value={values.label}
              placeholder="Monthly rent"
              onChange={(event) => patch({ label: event.target.value })}
              aria-invalid={Boolean(issues.label) || undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <AmountField
              label="Amount"
              id="expense-amount"
              value={values.amount}
              onChange={(next) => patch({ amount: next })}
              currency={values.currency}
              required
              min={0}
            />
            <CurrencySelect
              id="expense-currency"
              label="Currency"
              value={values.currency}
              onChange={(next) => patch({ currency: next })}
              required
              error={issues.currency ?? null}
              hint={null}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid on" htmlFor="expense-paid" required error={issues.paid_on ?? null}>
              <Input
                id="expense-paid"
                type="date"
                value={values.paid_on}
                onChange={(event) => patch({ paid_on: event.target.value })}
              />
            </Field>
            <CategorySelect
              value={values.category_id}
              onChange={(category_id) => patch({ category_id })}
              hint="Optional — uncategorised spend still counts in every total"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor" htmlFor="expense-vendor">
              <Input
                id="expense-vendor"
                value={values.vendor}
                placeholder="Landlord, Adobe, Tesco…"
                onChange={(event) => patch({ vendor: event.target.value })}
              />
            </Field>
            <Field label="Invoice number" htmlFor="expense-invoice">
              <Input
                id="expense-invoice"
                value={values.invoice_number}
                onChange={(event) => patch({ invoice_number: event.target.value })}
                className="os-mono"
              />
            </Field>
          </div>

          <div className="border-t border-line-faint pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Checkbox
                checked={values.recurring}
                onCheckedChange={(next) =>
                  patch({ recurring: next === true, recurrence: next === true ? 'monthly' : 'none' })
                }
              />
              This repeats
            </label>
            {values.recurring ? (
              <div className="mt-3">
                <Field label="Every" error={issues.recurrence ?? null}>
                  <EnumSelect
                    value={values.recurrence ?? 'monthly'}
                    onChange={(recurrence) => patch({ recurrence: recurrence as ExpenseRecurrence })}
                    options={recurrences.filter((value) => value !== 'none')}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <Field label="Notes" htmlFor="expense-notes">
            <Textarea
              id="expense-notes"
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
            {editing ? 'Save expense' : 'Log expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blank(currency: string, paidOn: string): ExpenseForm {
  return {
    label: '',
    amount: '',
    currency,
    paid_on: paidOn > todayDate() ? todayDate() : paidOn,
    category_id: null,
    recurring: false,
    recurrence: null,
    vendor: '',
    invoice_number: '',
    notes: '',
  }
}

function CategoryDialog({
  open,
  onOpenChange,
  categories,
  kinds,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  categories: ExpenseCategory[]
  kinds: string[]
  onSaved: () => void
}) {
  const [values, setValues] = useState<ExpenseCategoryInput>({
    name: '',
    parent_id: null,
    kind: 'variable',
    color: CATEGORY_COLORS[0],
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const flat = useMemo(() => flattenCategories(categories), [categories])

  useEffect(() => {
    if (!open) return
    setValues({ name: '', parent_id: null, kind: 'variable', color: CATEGORY_COLORS[0] })
    setError(null)
  }, [open])

  async function submit() {
    if (!values.name?.trim()) {
      setError('Give the category a name')
      return
    }
    setPending(true)
    setError(null)
    try {
      await api<ExpenseCategory>(FINANCE_PATHS.categories, { method: 'POST', body: values })
      toastSuccess('Category created', { description: values.name })
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title="New expense category"
          description="Categories group spend and carry one colour you chose. The colour never enters a calculation."
        />
        <DialogBody className="space-y-4">
          {error ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <Field label="Name" htmlFor="category-name" required error={error && !values.name?.trim() ? error : null}>
            <Input
              id="category-name"
              autoFocus
              value={values.name ?? ''}
              placeholder="Hosting"
              onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" hint="fixed, variable, one-off or tax">
              <EnumSelect
                value={values.kind ?? 'variable'}
                onChange={(kind) =>
                  setValues((prev) => ({ ...prev, kind: kind as ExpenseCategoryInput['kind'] }))
                }
                options={kinds}
              />
            </Field>
            <Field label="Parent" hint="nest it under an existing category">
              <Select
                value={values.parent_id ?? NONE}
                onValueChange={(next) =>
                  setValues((prev) => ({ ...prev, parent_id: next === NONE ? null : next }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <Option value={NONE}>None (top level)</Option>
                  {flat.map((row) => (
                    <Option key={row.id} value={row.id}>
                      {'\u00A0'.repeat(row.depth * 2)}
                      {row.name}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Colour" hint="only for the dot and the bar">
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setValues((prev) => ({ ...prev, color }))}
                  aria-label={`Use ${color}`}
                  aria-pressed={values.color === color}
                  className={cn(
                    'os-tap-none size-6 rounded-os border transition-colors duration-150',
                    values.color === color ? 'border-foreground' : 'border-line hover:border-line-strong'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
              <span className="os-mono ml-1 text-[11px] text-muted-foreground">
                {values.color ?? CATEGORY_COLORS[0]}
              </span>
            </div>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            Create category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
