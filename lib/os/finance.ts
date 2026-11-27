/**
 * TypeScript mirror of `docs/MYOS/PHASE3_FINANCE.md` — the Finance module's wire shapes.
 *
 * Field names follow the contract verbatim, the same way `lib/os/types.ts` follows API.md,
 * because the FastAPI services are written against that document. Derived blocks are marked
 * as optional: they are computed per request and never stored, so a client must not assume
 * they exist on a row it just posted.
 *
 * Nothing in here calculates. Money maths lives in Python; `lib/os/currency.ts` only formats.
 */

/* ------------------------------------------------------------------ enums -- */

export type IncomeProfileKind = 'salary' | 'freelance' | 'contract' | 'business' | 'mixed';

export type TaxRegime = 'none' | 'flat' | 'slab' | 'presumptive';

export type ServiceUnit = 'hour' | 'day' | 'fixed' | 'retainer' | 'seat';

export type PlanInterval = 'monthly' | 'quarterly' | 'yearly' | 'one_time';

export type SubscriptionStatus = 'trialing' | 'active' | 'paused' | 'cancelled' | 'expired';

export type ExpenseCategoryKind = 'fixed' | 'variable' | 'one_off' | 'tax';

export type ExpenseRecurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type IncomeStatus = 'expected' | 'invoiced' | 'paid' | 'overdue' | 'written_off';

export type IncomeMethod = 'bank' | 'card' | 'upi' | 'cash' | 'crypto' | 'other';

export type ScenarioKind = 'personal' | 'business' | 'hybrid';

export type ScenarioStatus = 'draft' | 'active' | 'archived';

export type ScenarioDirection = 'income' | 'cost';

/**
 * The cadence a scenario item may carry (§5): the expense set plus `one_time`, because a
 * lump sum inside a horizon has a monthly figure — the API divides it by the horizon rather
 * than dropping it. `none` and a missing recurrence both mean the line draws no month, so
 * the curve and the item agree without the browser deciding anything.
 */
export type ScenarioRecurrence = ExpenseRecurrence | 'one_time';

/* --------------------------------------------------------------- currencies -- */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  minor_units: number;
  decimal: string;
  group: string;
}

export interface ExchangeRate {
  id: string;
  base: string;
  quote: string;
  rate: number;
  as_of: string;
  provider: string | null;
  created_at: string;
  updated_at: string;
  /** Days between `as_of` and the `today` the request was made against. */
  age_days?: number | null;
  /** `age_days` beyond the server's staleness window. */
  stale?: boolean;
}

/** `GET /convert` — the rate is named, dated and labelled, never implied. */
export interface ConvertResult {
  amount: number;
  base: string;
  quote: string;
  converted: number;
  rate: number;
  /** `null` for an identity conversion, which needs no rate row at all. */
  as_of: string | null;
  /** True when the answer came from the inverse of a stored `quote→base` row. */
  derived: boolean;
  stale: boolean;
  age_days: number | null;
}

/* ----------------------------------------------------------- income profile -- */

export interface TaxSlab {
  /** Upper bound of the slab; `null` means "and everything above it". */
  up_to: number | null;
  rate: number;
}

export interface TaxDeduction {
  label: string;
  amount: number;
  /** Pre-tax deductions reduce the taxable base; post-tax ones only the net. */
  pre_tax?: boolean;
}

export interface IncomeProfile {
  id: string;
  name: string;
  kind: IncomeProfileKind;
  gross_monthly: number | null;
  currency: string;
  tax_regime: TaxRegime;
  tax_rate: number | null;
  slabs: TaxSlab[] | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  monthly_net?: number | null;
  effective_tax_rate?: number | null;
  annual_gross?: number | null;
}

/** `POST /income-profiles/preview` — the calculator's whole answer. */
export interface TakeHomeResult {
  gross: number;
  taxable: number;
  tax: number;
  net: number;
  net_monthly: number;
  net_annual: number;
  effective_tax_rate: number | null;
  currency: string;
  slab_breakdown: Array<{ from: number; to: number | null; rate: number; amount: number }>;
  deductions_total: number;
  warnings: string[];
}

export interface TakeHomeInput {
  name?: string;
  gross_monthly?: number | null;
  gross_annual?: number | null;
  period?: 'monthly' | 'annual';
  currency: string;
  tax_regime: TaxRegime;
  tax_rate?: number | null;
  slabs?: TaxSlab[] | null;
  deductions?: TaxDeduction[];
  other_income?: number | null;
}

/* ---------------------------------------------------------------- catalogue -- */

export interface ServiceRevenue {
  /** `null` when the rows span currencies and no target was named (§2.3). */
  total: number | null;
  currency: string | null;
  paid_count: number;
  /** Paid + still-owed rows on this service; absent on older responses. */
  row_count?: number;
  invoiced_amount: number | null;
}

export interface Service {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  unit: ServiceUnit;
  default_price: number | null;
  currency: string | null;
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  plans?: ServicePlan[];
  revenue?: ServiceRevenue | null;
  /** Always null in Phase 3 — no time tracking is wired to services yet. */
  utilisation_hours?: number | null;
}

export interface ServicePlan {
  id: string;
  service_id: string;
  name: string;
  interval: PlanInterval;
  price: number;
  currency: string | null;
  included_units: number | null;
  overage_rate: number | null;
  trial_days: number | null;
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  /** The service this plan sells, joined in so a plan list needs no second call. */
  service?: { id: string; name: string; unit: ServiceUnit } | null;
  monthly_price?: number | null;
  /** `price ÷ included_units`, only when the plan normalises to a monthly figure. */
  effective_rate?: number | null;
  subscriber_count?: number;
}

/* ------------------------------------------------------------- subscriptions -- */

export interface Subscription {
  id: string;
  plan_id: string | null;
  company_id: string | null;
  status: SubscriptionStatus;
  started_on: string;
  renews_on: string | null;
  cancelled_on: string | null;
  price: number;
  currency: string | null;
  interval: PlanInterval | null;
  invoice_number: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  /** Label of the plan or company it belongs to, when the row links to one. */
  plan?: { id: string; name: string; interval: PlanInterval } | null;
  /** What the row is called: the plan name, the company, or the invoice number. */
  label?: string;
  monthly_cost?: number | null;
  annual_cost?: number | null;
  renews_in_days?: number | null;
  is_running?: boolean;
  warnings?: string[];
}

/* ------------------------------------------------------------------ expenses -- */

export interface ExpenseCategory {
  id: string;
  name: string;
  parent_id: string | null;
  kind: ExpenseCategoryKind;
  system_key: string | null;
  color: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  children?: ExpenseCategory[];
  depth?: number;
  amount_this_month?: number | null;
  monthly_norm?: number | null;
}

export interface Expense {
  id: string;
  category_id: string | null;
  label: string;
  amount: number;
  currency: string;
  paid_on: string;
  recurring: boolean;
  recurrence: ExpenseRecurrence | null;
  vendor: string | null;
  invoice_number: string | null;
  receipt_path: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  category?: { id: string; name: string; color: string | null } | null;
  monthly_norm?: number | null;
}

export interface ExpenseSummary {
  month: string;
  currency: string | null;
  total: Money;
  count: number;
  recurring_monthly: Money;
  by_category: Array<{
    category_id: string | null;
    name: string;
    color: string | null;
    amount: Money;
    count: number;
  }>;
  by_vendor: Array<{ vendor: string; amount: Money; count: number }>;
  by_currency: Array<{ currency: string; amount: Money }>;
  /** Trailing months, oldest first — the last entry is the viewed month. */
  series: Array<{ month: string; total: Money }>;
  top_expenses: Array<{
    id: string;
    label: string;
    vendor: string | null;
    amount: Money;
    currency: string | null;
    paid_on: string;
  }>;
}

/* -------------------------------------------------------------- income rows -- */

export interface IncomeTransaction {
  id: string;
  subscription_id: string | null;
  service_id: string | null;
  label: string;
  amount: number;
  currency: string;
  received_on: string;
  status: IncomeStatus;
  invoice_number: string | null;
  method: IncomeMethod | null;
  converted_amount: number | null;
  converted_currency: string | null;
  converted_at: string | null;
  notes: string | null;
  /** Present on list rows; the summary's overdue list is a slimmer payload. */
  source?: string;
  created_at: string;
  updated_at: string;
  service?: { id: string; name: string } | null;
  subscription?: { id: string; price: number; currency: string | null } | null;
}

export interface IncomeSummary {
  month: string;
  /** `null` when the month's rows span currencies and no target was asked for. */
  currency: string | null;
  /** Billed but not collected in the month — the invoiced column, not paid + open. */
  invoiced: Money;
  received: Money;
  /** All open receivables, whatever month they belong to. */
  receivables: Money;
  count: number;
  /** Overdue rows in the month, as full income rows. */
  overdue: Array<IncomeTransaction>;
  /** Money per status in the month — a total, not a count, and `null` with no target. */
  by_status: Partial<Record<IncomeStatus, Money>>;
  by_service: Array<{ service_id: string | null; name: string; amount: Money; count: number }>;
  /** Trailing months, oldest first, so the last entry is the month being viewed. */
  series: Array<{ month: string; invoiced: Money; received: Money }>;
  by_currency: Array<{ currency: string; amount: Money }>;
}

/* ----------------------------------------------------------------- scenarios -- */

export interface ScenarioAssumptions {
  inflation?: number;
  tax_rate?: number;
  growth?: number;
  [key: string]: number | undefined;
}

export interface CostScenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  horizon_months: number;
  start_month: string;
  currency: string | null;
  base_income_profile_id: string | null;
  assumptions: ScenarioAssumptions;
  status: ScenarioStatus;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  item_count: number;
  /** Only on `GET /cost-scenarios/{id}`, which returns the scenario with its items. */
  items?: CostScenarioItem[];
}

export interface CostScenarioItem {
  id: string;
  scenario_id: string;
  label: string;
  direction: ScenarioDirection;
  amount: number;
  currency: string | null;
  recurrence: ScenarioRecurrence | null;
  starts_on: string | null;
  ends_on: string | null;
  category_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectionMonth {
  month: string;
  income: Money;
  cost: Money;
  net: Money;
  cumulative: Money;
}

export interface ScenarioTotals {
  income: Money;
  cost: Money;
  net: Money;
}

export interface ScenarioProjection {
  scenario: CostScenario;
  /** `null` when the items span currencies and no `?currency=` target was named. */
  currency: string | null;
  horizon_months: number;
  months: ProjectionMonth[];
  totals: ScenarioTotals;
  break_even_month: string | null;
  runway_months: number | null;
  assumptions: ScenarioAssumptions;
}

/** One month of one curve; `in_horizon: false` is the axis saying "this plan stops here". */
export interface ComparisonCurve {
  income: Money;
  cost: Money;
  net: Money;
  cumulative: Money;
  in_horizon: boolean;
}

export interface ComparisonMonth {
  month: string;
  a: ComparisonCurve;
  b: ComparisonCurve;
  delta: Money;
}

export interface ScenarioComparison {
  currency: string | null;
  a: CostScenario;
  b: CostScenario;
  months: ComparisonMonth[];
  totals: { a: ScenarioTotals; b: ScenarioTotals };
  break_even: { a: string | null; b: string | null; first: 'a' | 'b' | 'both' | null };
}

/* ------------------------------------------------------------------ overview -- */

/**
 * A money figure that can be `null`: §2.3 says the totals are only named when every row
 * shares one currency or the caller asked for a target, so "no single currency" arrives as
 * `null` rather than as a blended number.
 */
export type Money = number | null

export interface FinanceSummary {
  /** `null` when the month's rows span currencies with no target and no stored path. */
  currency: string | null;
  month: string;
  income: Money;
  expense: Money;
  net: Money;
  monthly_income_avg_3m: Money;
  monthly_burn: Money;
  /** `null` when the burn is 0, or when the burn or the cash could not be named (rule 3). */
  runway_months: number | null;
  /** Projected balance 90 days out, the number the runway above divides into. */
  cash_in_90d?: Money;
  mrr: Money;
  arr: Money;
  receivables: Money;
  overdue_income: Money;
  income_by_month: Array<{ month: string; income: Money; expense: Money; net: Money }>;
  expense_by_category: Array<{
    category_id: string | null;
    name: string;
    color: string | null;
    amount: Money;
    share: number | null;
  }>;
  top_vendors: Array<{ vendor: string; amount: Money; count: number }>;
  renewing_this_month: Array<{
    id: string;
    label: string;
    amount: Money;
    currency: string | null;
    renews_on: string;
    days_until: number;
  }>;
  by_currency: Array<{ currency: string; income: Money; expense: Money }>;
  stale_rates: Array<{ base: string; quote: string; as_of: string; age_days: number }>;
  counts: Partial<Record<'expenses' | 'income' | 'subscriptions' | 'services' | 'scenarios', number>>;
}

/* ------------------------------------------------------------------ plumbing -- */

/** The endpoint paths of the module, in one place, so a screen never re-types one. */
export const FINANCE_PATHS = {
  summary: '/finance/summary',
  currencies: '/currencies',
  rates: '/exchange-rates',
  convert: '/convert',
  profiles: '/income-profiles',
  profilePreview: '/income-profiles/preview',
  services: '/services',
  plans: '/service-plans',
  subscriptions: '/subscriptions',
  categories: '/expense-categories',
  expenses: '/expenses',
  expenseSummary: '/expenses/summary',
  expenseExport: '/expenses/export.csv',
  income: '/income',
  incomeSummary: '/income/summary',
  incomeExport: '/income/export.csv',
  scenarios: '/cost-scenarios',
  scenarioCompare: '/cost-scenarios/compare',
  /** Items are patched by their own id, not through the scenario path. */
  scenarioItems: '/cost-scenario-items',
} as const;

/**
 * Cache prefixes every Finance write invalidates: the overview, each list, the shared
 * selects, and the system surfaces that show money (`/meta` counts, search, activity,
 * notifications). A prefix passed to `invalidate()` also clears its detail sub-paths.
 */
export const FINANCE_SCOPE = [
  FINANCE_PATHS.summary,
  FINANCE_PATHS.expenses,
  FINANCE_PATHS.expenseSummary,
  FINANCE_PATHS.income,
  FINANCE_PATHS.incomeSummary,
  FINANCE_PATHS.subscriptions,
  FINANCE_PATHS.services,
  FINANCE_PATHS.plans,
  FINANCE_PATHS.profiles,
  FINANCE_PATHS.scenarios,
  FINANCE_PATHS.rates,
  FINANCE_PATHS.categories,
  '/meta',
  '/search',
  '/activity',
  '/notifications',
];

/**
 * What each list's `sort=` accepts, exactly as §4 of the contract writes it. A screen must
 * not invent a key: the API answers 422 for anything outside its own list. `dir=asc|desc`
 * is accepted on these endpoints (`/exchange-rates` has no sort — it is always newest first)
 * and on `/cost-scenarios`; where it is absent the server uses the default recorded below,
 * so an arrow in the UI always states the order that actually came back.
 */
export const FINANCE_SORTS = {
  expenses: ['paid_on', 'amount', 'created'],
  income: ['received_on', 'amount'],
  subscriptions: ['renews', 'price', 'created', 'cost'],
  services: ['updated', 'name', 'price'],
  scenarios: ['updated', 'name', 'start', 'created'],
} as const;

export type FinanceSortKey = keyof typeof FINANCE_SORTS;
export type SortDir = 'asc' | 'desc';

/** The direction the API applies to a key when the caller says nothing. */
export const FINANCE_DEFAULT_DIR: Record<string, SortDir> = {
  paid_on: 'desc',
  amount: 'desc',
  created: 'desc',
  updated: 'desc',
  received_on: 'desc',
  price: 'desc',
  cost: 'desc',
  renews: 'asc',
  name: 'asc',
  start: 'asc',
};

/**
 * The cadences `POST /cost-scenarios/{id}/items` accepts — the expense set plus `one_time`,
 * which the projection divides by the horizon. Kept here rather than in the screen so the
 * order matches the API's own tuple and a fallback list cannot invent a value.
 */
export const SCENARIO_RECURRENCES: ScenarioRecurrence[] = [
  'monthly',
  'weekly',
  'quarterly',
  'yearly',
  'one_time',
  'none',
];

/** Recurrence/interval → the label used in a money column header. */
export const INTERVAL_LABELS: Record<PlanInterval | ExpenseRecurrence, string> = {
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
  weekly: '/wk',
  one_time: 'once',
  none: '',
};

/** Category dot colours, in the order the seed hands them out. */
export const CATEGORY_COLORS = [
  '#B9BBBE',
  '#7C8A9B',
  '#9BB0C4',
  '#C4A98A',
  '#8FA37F',
  '#B08F8F',
  '#6B6D72',
  '#A6859E',
];

/**
 * The write shapes. Every field is optional except the ones §4 marks required, because a
 * PATCH sends only what changed; the server answers 422 with per-field `details` for the
 * rest. Amounts are plain JSON numbers the browser has parsed, never pre-rounded.
 */
export interface ExpenseInput {
  label?: string
  amount?: number
  currency?: string
  paid_on?: string
  category_id?: string | null
  recurring?: boolean
  recurrence?: ExpenseRecurrence | null
  vendor?: string | null
  invoice_number?: string | null
  notes?: string | null
}

export interface ExpenseCategoryInput {
  name?: string
  parent_id?: string | null
  kind?: ExpenseCategoryKind
  color?: string | null
  archived?: boolean
}

export interface IncomeTransactionInput {
  label?: string
  amount?: number
  currency?: string
  received_on?: string
  status?: IncomeStatus
  service_id?: string | null
  subscription_id?: string | null
  invoice_number?: string | null
  method?: IncomeMethod | null
  notes?: string | null
}

export interface IncomeProfileInput {
  name?: string
  kind?: IncomeProfileKind
  gross_monthly?: number | null
  currency?: string
  tax_regime?: TaxRegime
  tax_rate?: number | null
  slabs?: TaxSlab[] | null
  deductions?: TaxDeduction[] | null
  notes?: string | null
}

export interface ServiceInput {
  name?: string
  code?: string | null
  description?: string | null
  unit?: ServiceUnit
  default_price?: number | null
  currency?: string | null
  active?: boolean
}

export interface ServicePlanInput {
  service_id?: string
  name?: string
  interval?: PlanInterval
  price?: number
  currency?: string | null
  included_units?: number | null
  overage_rate?: number | null
  trial_days?: number | null
  active?: boolean
}

export interface SubscriptionInput {
  plan_id?: string | null
  company_id?: string | null
  status?: SubscriptionStatus
  started_on?: string
  renews_on?: string | null
  cancelled_on?: string | null
  price?: number
  currency?: string
  interval?: PlanInterval | null
  invoice_number?: string | null
  notes?: string | null
}

export interface ExchangeRateInput {
  base?: string
  quote?: string
  rate?: number
  as_of?: string
  provider?: string | null
}

export interface CostScenarioInput {
  name?: string
  kind?: ScenarioKind
  horizon_months?: number
  start_month?: string
  currency?: string | null
  base_income_profile_id?: string | null
  assumptions?: ScenarioAssumptions | null
  status?: ScenarioStatus
  notes?: string | null
}

export interface CostScenarioItemInput {
  scenario_id?: string
  label?: string
  direction?: ScenarioDirection
  amount?: number
  currency?: string | null
  recurrence?: ScenarioRecurrence | null
  starts_on?: string | null
  ends_on?: string | null
  category_id?: string | null
  notes?: string | null
}

/** The one place the app decides what a direction looks like: income is ink, cost is muted,
 * and colour is reserved for a *state* (an overdue invoice), never for a category of money. */
export function directionClass(direction: ScenarioDirection | 'income' | 'cost'): string {
  return direction === 'income' ? 'text-foreground' : 'text-muted-foreground';
}

export function statusTone(status: IncomeStatus | SubscriptionStatus | ScenarioStatus): string {
  switch (status) {
    case 'overdue':
    case 'cancelled':
    case 'expired':
    case 'written_off':
      return 'text-danger';
    case 'paid':
    case 'active':
      return 'text-success';
    case 'invoiced':
    case 'expected':
    case 'trialing':
    case 'paused':
    case 'draft':
      return 'text-warning';
    default:
      return 'text-muted-foreground';
  }
}
