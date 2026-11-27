/**
 * Phase 2 · Freelance CRM — the mirror of the API contract in `docs/MYOS/API.md` and
 * `docs/MYOS/PHASE2_CAREER_CRM.md`.
 *
 * The money rule carries over from Phase 3 unchanged: a value that spans currencies is returned
 * **per currency** (`TallyEntry[]`) and a single-currency figure only exists when the caller named
 * the code. So `amount` here is `number | null` for the same reason `Money` is in `lib/os/finance.ts`
 * — a null is a missing answer, not zero, and it renders as an em dash.
 */

import type { Company, Contact } from './types'
import type { Subscription } from './finance'
// The scope list is a runtime value, so it is imported the way `node --test` resolves modules.
import { FINANCE_SCOPE } from './finance.ts'

export const CRM_PATHS = {
  leads: '/leads',
  leadSummary: '/crm/summary',
  clients: '/clients',
  meetings: '/meetings',
} as const

/**
 * Cache prefixes every CRM write refreshes. Finance reads are in here because a client
 * row is the anchor for subscriptions, income and meetings: winning a lead changes what
 * the money screens say, not only what the pipeline says.
 */
export const CRM_SCOPE = [
  CRM_PATHS.leads,
  CRM_PATHS.leadSummary,
  CRM_PATHS.clients,
  CRM_PATHS.meetings,
  '/dashboard',
  '/meta',
  '/activity',
  '/search',
  '/notifications',
  ...FINANCE_SCOPE,
] as const

/* --------------------------------------------------------------------- leads -- */

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'dormant'

export interface Lead {
  id: string
  contact_id: string | null
  company_id: string | null
  name: string
  email: string | null
  origin: string | null
  status: LeadStatus
  score: number | null
  estimated_value: number | null
  currency: string | null
  lost_reason: string | null
  /** A timestamp — stamped by `transition` and `promote`, never written by the UI. */
  last_touch_at: string | null
  /** A `YYYY-MM-DD` date, not a timestamp: §12 stores a DATE and the overdue maths is day maths. */
  next_touch_at: string | null
  notes: string | null
  source: string
  created_at: string
  updated_at: string
  /** Source is `coalesce(last_touch_at, updated_at)`, so an untouched lead reads by its last edit. */
  days_since_touch?: number | null
  /** Signed: negative means the planned follow-up has passed. Null when no date is set. */
  days_to_next_touch?: number | null
  /** `next_touch_at < today` on a lead that is not won or lost; `dormant` counts, it is not closed. */
  is_overdue?: boolean
  contact?: Pick<Contact, 'id' | 'name'> | null
  company?: Pick<Company, 'id' | 'name'> | null
}

/**
 * `GET /leads/{id}` — the list row plus the account this lead was promoted into. The lead's diary
 * is a separate read (`GET /meetings?entity_type=lead&entity_id=`), not an embed: the meetings
 * router is shared with every other owner, so it stays the single source of a calendar.
 */
export interface LeadDetail extends Lead {
  client?: { id: string; name: string; stage: ClientStage } | null
}

export interface LeadInput {
  name: string
  contact_id?: string | null
  company_id?: string | null
  email?: string | null
  origin?: string | null
  status?: LeadStatus
  score?: number | null
  estimated_value?: number | null
  currency?: string | null
  lost_reason?: string | null
  /** `YYYY-MM-DD`, or null to clear the plan. */
  next_touch_at?: string | null
  notes?: string | null
}

/**
 * A lead needs only `name`. `origin` has no default (an untagged source stays null), and
 * `last_touch_at` is server-only: `transition` and `promote` stamp it, so the UI never writes it.
 */

/** One per-currency figure from the CRM summary. */
export interface TallyEntry {
  currency: string
  amount: number | null
}

/**
 * `GET /crm/summary` — takes `?today=` and `?currency=`, and is not paged. Every rate is a 0–100
 * percentage (2 dp, null when the denominator is 0), and `pipeline[].value` is a single number
 * that goes null when a bucket mixes currencies and no code was named — `value_by_currency` is
 * then the honest view, per the Phase 3 money rule.
 */
export interface CrmSummary {
  currency: string | null
  pipeline: Array<{ status: LeadStatus; count: number; value: number | null }>
  value_by_currency: TallyEntry[]
  weighted_value: TallyEntry[]
  needs_follow_up: Array<{
    id: string
    name: string
    days_overdue: number
    next_touch_at: string | null
  }>
  won_this_month: number
  lost_this_month: number
  win_rate: number | null
  conversion_rate: number | null
  avg_days_new_to_won: number | null
}

/* ------------------------------------------------- lead queries and actions -- */

/** The keys `GET /leads` accepts as `sort`: `score|estimated_value|next_touch_at|created`. */
export const LEAD_SORTS = ['next_touch_at', 'score', 'estimated_value', 'created'] as const

export type LeadSort = (typeof LEAD_SORTS)[number]

export const LEAD_DEFAULT_DIR: Record<LeadSort, 'asc' | 'desc'> = {
  next_touch_at: 'asc',
  score: 'desc',
  estimated_value: 'desc',
  created: 'desc',
}

/** The keys `GET /clients` accepts as `sort`: `name|contract_end|mrr|created`. */
export const CLIENT_SORTS = ['name', 'contract_end', 'mrr', 'created'] as const

export type ClientSort = (typeof CLIENT_SORTS)[number]

export const CLIENT_DEFAULT_DIR: Record<ClientSort, 'asc' | 'desc'> = {
  name: 'asc',
  contract_end: 'asc',
  mrr: 'desc',
  created: 'desc',
}

export interface LeadTransitionInput {
  status: LeadStatus
  /** Required by the API when the move is to `lost`; free text. */
  lost_reason?: string | null
}

/** `PATCH /clients/{id}` and `DELETE /clients/{id}` both hang off this. */
export function clientPath(id: string): string {
  return `${CRM_PATHS.clients}/${id}`
}

export function leadPath(id: string): string {
  return `${CRM_PATHS.leads}/${id}`
}

/** `POST /leads/{id}/transition` — the machine runs here; an illegal jump is a 409. */
export function leadTransitionPath(id: string): string {
  return `${leadPath(id)}/transition`
}

/** `POST /leads/{id}/promote` — win the lead and open the account in one transaction. */
export function leadPromotePath(id: string): string {
  return `${leadPath(id)}/promote`
}

/**
 * The only keys `POST /leads/{id}/promote` honours — the body is `extra="forbid"`, so anything
 * else (including `name`, which is derived, and `owner_id`, which no Phase 2 endpoint writes) is a
 * 422. They apply to the NEW client only; an existing account is never mutated by a promote.
 */
export interface LeadPromoteInput {
  stage?: ClientStage
  health?: ClientHealth
  contract_start?: string | null
  contract_end?: string | null
  renewal_reminder_days?: number | null
  tags?: string[] | null
  notes?: string | null
}

export interface LeadPromoteResult {
  lead: Lead
  client: Client
}

/* ------------------------------------------------------------------- clients -- */

export type ClientStage = 'onboarding' | 'active' | 'at_risk' | 'churned' | 'archived'
export type ClientHealth = 'green' | 'amber' | 'red' | 'unknown'

export interface Client {
  id: string
  contact_id: string | null
  company_id: string | null
  /** The name the API resolves for display: company, else contact. */
  name: string
  stage: ClientStage
  health: ClientHealth
  /** Derived from live subscriptions; null when the book mixes currencies and the caller did
   *  not name one — `mrr_by_currency` is the honest view then. Never writable. */
  mrr: number | null
  mrr_by_currency?: TallyEntry[]
  /** The stored §12 column, echoed only. No Phase 2 endpoint writes it, which is why the derived
   *  figure is what the screen uses. */
  mrr_recorded?: number | null
  currency: string | null
  contract_start: string | null
  contract_end: string | null
  renewal_reminder_days: number | null
  owner_id: string | null
  tags: string[] | null
  notes: string | null
  source: string
  created_at: string
  updated_at: string
  days_to_contract_end?: number | null
  renewal_in_days?: number | null
  lifetime_value?: TallyEntry[]
  open_receivables?: TallyEntry[]
  contact?: Pick<Contact, 'id' | 'name' | 'email'> | null
  company?: Pick<Company, 'id' | 'name' | 'website'> | null
}

/** `GET /clients/{id}` — the account with the money and the calendar already attached. */
export interface ClientDetail extends Client {
  /** Every subscription live as of today, ordered `renews_on, price, id`. */
  subscriptions?: Subscription[] | null
  /** The 12 most recent rows, any status — lifetime value covers the whole ledger. */
  income?: ClientIncome[] | null
  /** The next 10 upcoming meetings, no far-future cap. */
  meetings?: Meeting[] | null
}

/** What the client detail embeds from `income` — the ledger row trimmed to what an account needs. */
export interface ClientIncome {
  id: string
  label: string
  amount: number
  currency: string
  received_on: string
  status: string
}

/**
 * `GET /clients` filters: `stage`, `health`, `tag`, `company_id`, `q`, `currency`, plus the usual
 * `limit/offset/sort/dir`. There is deliberately no `contact_id` filter.
 */
export interface ClientInput {
  contact_id?: string | null
  company_id?: string | null
  stage?: ClientStage
  health?: ClientHealth
  contract_start?: string | null
  contract_end?: string | null
  renewal_reminder_days?: number | null
  tags?: string[] | null
  notes?: string | null
}

/* ------------------------------------------------------------------ meetings -- */

export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

/**
 * The polymorphic pair `reminders` already uses, widened with the Phase 2 records. A meeting
 * names its entity by `entity_type` + `entity_id` — both or neither, and an id from another
 * workspace is a 422 on `entity_id` rather than a silent orphan.
 */
export type MeetingEntityType =
  | 'task'
  | 'note'
  | 'project'
  | 'milestone'
  | 'contact'
  | 'company'
  | 'goal'
  | 'job_application'
  | 'lead'
  | 'client'

/** Sort keys `GET /meetings` accepts. */
export const MEETING_SORTS = ['starts_at', 'created', 'title'] as const

export type MeetingSort = (typeof MEETING_SORTS)[number]

export const MEETING_DEFAULT_DIR: Record<MeetingSort, 'asc' | 'desc'> = {
  starts_at: 'asc',
  created: 'desc',
  title: 'asc',
}

export function meetingPath(id: string): string {
  return `${CRM_PATHS.meetings}/${id}`
}

export interface Meeting {
  id: string
  title: string
  starts_at: string
  /** NOT NULL on the server, and it must be after `starts_at`. */
  ends_at: string
  location: string | null
  video_url: string | null
  status: MeetingStatus
  agenda: string | null
  notes: string | null
  entity_type: MeetingEntityType | null
  entity_id: string | null
  /** Echoed, always null until Phase 4 owns calendar events. */
  calendar_event_id?: string | null
  /** `user`, `demo` or `import` — present on every row, and what `/demo/reset` keys on. */
  source?: string
  created_at: string
  updated_at: string
}

export interface MeetingInput {
  title: string
  starts_at: string
  ends_at: string
  location?: string | null
  video_url?: string | null
  status?: MeetingStatus
  agenda?: string | null
  notes?: string | null
  entity_type?: MeetingEntityType | null
  entity_id?: string | null
}

/* ------------------------------------------------------------ state machines -- */

export const LEAD_BOARD = ['new', 'contacted', 'qualified', 'proposal'] as const
export const CLOSED_LEAD_STATUSES = ['won', 'lost'] as const

/** The graph the server enforces; the board only uses it to decide what to offer. */
/**
 * `new → contacted → qualified → proposal → won` is the ladder; the server allows any strictly
 * forward hop on it plus any close from a non-terminal state, so skipping a stage is legal.
 * `lost` and `dormant` come back only through `contacted`, and `won` is terminal.
 */
const LEAD_FORWARD: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'qualified', 'proposal', 'won', 'lost', 'dormant'],
  contacted: ['qualified', 'proposal', 'won', 'lost', 'dormant'],
  qualified: ['proposal', 'won', 'lost', 'dormant'],
  proposal: ['won', 'lost', 'dormant'],
  won: [],
  lost: ['contacted'],
  dormant: ['contacted', 'lost'],
}

export function allowedLeadTransitions(status: LeadStatus | string | null | undefined): LeadStatus[] {
  return LEAD_FORWARD[status as LeadStatus] ?? []
}

export function isClosedLead(status: string | null | undefined): boolean {
  return (CLOSED_LEAD_STATUSES as readonly string[]).includes(String(status))
}

/**
 * Which hairline dot a lead is drawn with — the same five states the rest of the OS uses, so the
 * CRM board and the task list mean the same thing at a glance.
 */
export type LeadDot = 'open' | 'in_progress' | 'done' | 'abandoned' | 'archived'

export function leadDot(status: LeadStatus | string | null | undefined): LeadDot {
  switch (status) {
    case 'new':
      return 'open'
    case 'contacted':
    case 'qualified':
    case 'proposal':
      return 'in_progress'
    case 'won':
      return 'done'
    case 'lost':
      return 'abandoned'
    case 'dormant':
      return 'archived'
    default:
      return 'open'
  }
}

/**
 * Leads still in play, summed from `crm.summary.pipeline`. The API hands out per-status counts and
 * no total, so the one thing a pipeline screen always wants is derived here — closed states
 * included in the payload do not count as open.
 */
export function openLeadCount(
  pipeline: ReadonlyArray<{ status: LeadStatus | string; count: number }> | null | undefined
): number {
  return (pipeline ?? [])
    .filter((step) => !isClosedLead(step.status) && step.status !== 'dormant')
    .reduce((sum, step) => sum + (step.count || 0), 0)
}

/* ------------------------------------------------------------ derived views -- */

/**
 * Sum a per-client `TallyEntry[]` across accounts, one code at a time.
 *
 * This is the only addition the money rule permits: same-currency amounts may be totalled, a null
 * is a missing answer rather than zero, and nothing is ever converted to make two codes fit in one
 * column. A client whose figure mixes currencies without a named code contributes a null entry, so
 * it lands in `unnamed` and the screen says so instead of guessing.
 */
export function mergeTally(
  groups: ReadonlyArray<TallyEntry[] | null | undefined>
): { entries: TallyEntry[]; unnamed: number } {
  const totals: Record<string, number> = {}
  let unnamed = 0
  for (const group of groups) {
    for (const entry of group ?? []) {
      if (entry.amount === null || entry.amount === undefined || !entry.currency) {
        unnamed += 1
        continue
      }
      totals[entry.currency] = (totals[entry.currency] ?? 0) + entry.amount
    }
  }
  return {
    entries: sortTotals(totals),
    unnamed,
  }
}

/**
 * Monthly recurring revenue across a page of accounts, per currency.
 *
 * A null `mrr` means the book mixes codes without one being named (or the account has no live
 * subscription), and both of those are "no answer", so neither is added to anything.
 */
export function sumMrrByCurrency(rows: ReadonlyArray<Client>): TallyEntry[] {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    if (row.mrr === null || row.mrr === undefined || !row.currency) continue
    totals[row.currency] = (totals[row.currency] ?? 0) + row.mrr
  }
  return sortTotals(totals)
}

/** Biggest first, then alphabetical — the order a money column is read in. */
function sortTotals(totals: Record<string, number>): TallyEntry[] {
  return Object.entries(totals)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.currency.localeCompare(b.currency))
}

/** The two things a renewal countdown has to distinguish: due for a nudge, already past. */
export interface RenewalBuckets {
  /** Signed `days_to_contract_end` of 0 or less: the contract has run out. */
  expired: Client[]
  /** Still running, but inside the reminder window the account itself named. */
  reminding: Client[]
}

/**
 * Split accounts by their contract clock. `renewal_in_days` is the server's own arithmetic
 * (`contract_end - renewal_reminder_days - today`), so a row reaching 0 means the reminder fired —
 * there is no second copy of that maths here.
 */
export function renewalBuckets(rows: ReadonlyArray<Client>): RenewalBuckets {
  const expired: Client[] = []
  const reminding: Client[] = []
  for (const row of rows) {
    const days = row.days_to_contract_end
    if (days === null || days === undefined) continue
    if (days <= 0) {
      expired.push(row)
      continue
    }
    const reminder = row.renewal_in_days
    if (reminder !== null && reminder !== undefined && reminder <= 0) reminding.push(row)
  }
  const bySoonest = (a: Client, b: Client) =>
    (a.days_to_contract_end ?? 0) - (b.days_to_contract_end ?? 0)
  return { expired: expired.sort(bySoonest), reminding: reminding.sort(bySoonest) }
}

/** Tags across a page of accounts, most used first — the `?tag=` filter is built from this. */
export function tagCounts(rows: ReadonlyArray<Client>): Array<{ tag: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      const key = tag.trim()
      if (!key) continue
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** `at_risk` and `churned` are account states, not a funnel — PATCH is the transition. */
export const CLIENT_STAGES: ClientStage[] = ['onboarding', 'active', 'at_risk', 'churned', 'archived']

export const CLIENT_HEALTH: ClientHealth[] = ['green', 'amber', 'red', 'unknown']
