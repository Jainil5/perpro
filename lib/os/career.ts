/**
 * Phase 2 · Career — the mirror of the API contract in `docs/MYOS/API.md` and
 * `docs/MYOS/PHASE2_CAREER_CRM.md`. Types only, plus the state machine the board draws its
 * affordances from. Nothing here is authoritative: the server owns legality and answers 409 on an
 * illegal jump, and this module exists so the UI can grey out what it already knows will fail.
 *
 * No money is calculated in this file. Salary bands are stored and returned in the workspace
 * currency; the API states that currency and the UI formats it (`lib/os/currency.ts`).
 */

import type { Company, Contact } from './types'

/* ------------------------------------------------------------------ paths -- */

export const CAREER_PATHS = {
  applications: '/job-applications',
  interviews: '/job-interviews',
  summary: '/career/summary',
} as const

/**
 * Cache prefixes every Career write has to refresh. `/dashboard`, `/meta` and `/activity`
 * are in it because a transition writes an activity row and moves the `/meta` counts.
 */
export const CAREER_SCOPE = [
  CAREER_PATHS.applications,
  CAREER_PATHS.interviews,
  CAREER_PATHS.summary,
  '/dashboard',
  '/meta',
  '/activity',
  '/search',
  '/notifications',
] as const

/* ------------------------------------------------------------------- types -- */

export type JobApplicationStatus =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn'

export type JobInterviewType = 'phone' | 'video' | 'onsite' | 'technical' | 'hr' | 'other'
export type JobInterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'
export type JobInterviewOutcome = 'positive' | 'neutral' | 'negative' | 'pending'

/** The `next_interview` pointer the list rows carry. */
export interface NextInterview {
  id: string
  round: string
  type: JobInterviewType | null
  scheduled_at: string
}

export interface JobApplication {
  id: string
  company_id: string | null
  role_title: string
  channel: string | null
  url: string | null
  status: JobApplicationStatus
  salary_min: number | null
  salary_max: number | null
  location: string | null
  remote: boolean
  applied_at: string | null
  /**
   * An outcome stamp, not an "inactive" stamp: the server writes it the first time a row reaches
   * `rejected | withdrawn | hired | offer` and never again. `offer` is still an open state — it is
   * the date the pipeline produced something, which is what `time_to_offer_days` measures.
   */
  closed_at: string | null
  contact_id: string | null
  notes: string | null
  next_action: string | null
  next_action_date: string | null
  source: string
  created_at: string
  updated_at: string
  /** Newest of `updated_at` / `applied_at`, unclamped — a future date reads as negative age. */
  days_since_touch?: number | null
  /** Open status, nothing scheduled in the future, and `days_since_touch >= STALE_AFTER_DAYS`. */
  is_stale?: boolean
  interview_count?: number
  next_interview?: NextInterview | null
  company?: Pick<Company, 'id' | 'name'> | null
  contact?: Pick<Contact, 'id' | 'name'> | null
}

/** `GET /job-applications/{id}` embeds the interviews, newest first. */
export interface JobApplicationDetail extends JobApplication {
  interviews?: JobInterview[]
}

export interface JobInterview {
  id: string
  application_id: string
  round: string
  type: JobInterviewType | null
  scheduled_at: string
  duration_minutes: number | null
  status: JobInterviewStatus
  interviewer_ids: string[] | null
  outcome: JobInterviewOutcome | null
  notes: string | null
  created_at: string
  updated_at: string
  application?: { id: string; role_title: string; company: string | null } | null
}

export interface JobInterviewInput {
  application_id: string
  round: string
  type?: JobInterviewType | null
  scheduled_at: string
  duration_minutes?: number | null
  status?: JobInterviewStatus
  interviewer_ids?: string[] | null
  outcome?: JobInterviewOutcome | null
  notes?: string | null
}

export interface JobApplicationInput {
  role_title: string
  company_id?: string | null
  contact_id?: string | null
  channel?: string | null
  url?: string | null
  status?: JobApplicationStatus
  salary_min?: number | null
  salary_max?: number | null
  location?: string | null
  remote?: boolean
  applied_at?: string | null
  next_action?: string | null
  next_action_date?: string | null
  notes?: string | null
}

export interface InterviewUpcoming {
  id: string
  application_id: string
  role_title: string
  company: string | null
  round: string
  type: JobInterviewType | null
  scheduled_at: string
  days_until: number
}

export interface StaleApplication {
  id: string
  role_title: string
  days_since_touch: number
}

/** `POST /job-applications/{id}/transition` — the canonical move, with an optional note. */
export interface ApplicationTransitionInput {
  status: JobApplicationStatus
  note?: string | null
}

/** The action endpoint, not a PATCH: only it carries the `note` onto the activity row. */
export function applicationTransitionPath(id: string): string {
  return `${CAREER_PATHS.applications}/${id}/transition`
}

export function applicationPath(id: string): string {
  return `${CAREER_PATHS.applications}/${id}`
}

export function interviewPath(id: string): string {
  return `${CAREER_PATHS.interviews}/${id}`
}

export interface CareerSummary {
  /** The workspace currency the salary bands are denominated in. */
  currency: string
  funnel: Array<{ status: JobApplicationStatus; count: number }>
  open: number
  interviews_upcoming: InterviewUpcoming[]
  offers: number
  stale: StaleApplication[]
  rates: { applied_to_interview: number | null; interview_to_offer: number | null }
  time_to_interview_days: number | null
  time_to_offer_days: number | null
  /**
   * The spread across the open funnel, computed by the server rather than by whichever page
   * happens to be loaded. `count` is how many rows carry a band at all, so a null `min`/`max`
   * with `count: 0` means "nobody has written a number down", not "the roles are unpaid".
   */
  totals?: { by_salary: { currency: string | null; min: number | null; max: number | null; count: number } }
}

/* ------------------------------------------------------------ state machine -- */

/** Board columns, in order. Closed states are list views, never columns. */
export const APPLICATION_BOARD = ['saved', 'applied', 'screening', 'interview', 'offer'] as const

export const CLOSED_APPLICATION_STATUSES = ['hired', 'rejected', 'withdrawn'] as const

/**
 * The keys `GET /job-applications` accepts as `sort` — the whole list is
 * `applied_at|next_action_date|status|salary|created`. `next_action_date` is what the screen
 * opens on, because a pipeline you cannot act on is just a list.
 */
export const APPLICATION_SORTS = [
  'next_action_date',
  'applied_at',
  'status',
  'salary',
  'created',
] as const

export type ApplicationSort = (typeof APPLICATION_SORTS)[number]

/** The direction a column starts in, so the first click is the useful one. */
export const APPLICATION_DEFAULT_DIR: Record<ApplicationSort, 'asc' | 'desc'> = {
  next_action_date: 'asc',
  applied_at: 'desc',
  status: 'asc',
  salary: 'desc',
  created: 'desc',
}

/** Sort keys for `GET /job-interviews` — the diary reads them by when they happen. */
export const INTERVIEW_SORTS = ['scheduled_at', 'created'] as const

export type InterviewSort = (typeof INTERVIEW_SORTS)[number]

export const INTERVIEW_DEFAULT_DIR: Record<InterviewSort, 'asc' | 'desc'> = {
  scheduled_at: 'desc',
  created: 'desc',
}

/** How many days without a touch makes an open application worth listing as stale. */
export const STALE_AFTER_DAYS = 14

/**
 * Which hairline dot a status is drawn with. The five `marks.tsx` states map onto the
 * funnel one-to-one, so the board never invents a colour language of its own.
 */
export type ApplicationDot = 'open' | 'in_progress' | 'done' | 'abandoned' | 'archived'

export function applicationDot(
  status: JobApplicationStatus | string | null | undefined
): ApplicationDot {
  switch (status) {
    case 'saved':
      return 'open'
    case 'applied':
    case 'screening':
    case 'interview':
    case 'offer':
      return 'in_progress'
    case 'hired':
      return 'done'
    case 'rejected':
      return 'abandoned'
    case 'withdrawn':
      return 'archived'
    default:
      return 'open'
  }
}

/**
 * One honest line for a salary band: a range, an open-ended "from"/"up to", or nothing at
 * all when neither end was recorded. Amounts are formatted by the caller in the workspace
 * currency (`/career/summary` states it), so this only decides the shape.
 */
export function salaryBand(
  min: number | null | undefined,
  max: number | null | undefined,
  format: (value: number) => string
): string | null {
  const hasMin = min !== null && min !== undefined && Number.isFinite(min)
  const hasMax = max !== null && max !== undefined && Number.isFinite(max)
  if (hasMin && hasMax) return min === max ? format(min) : `${format(min)} – ${format(max)}`
  if (hasMin) return `from ${format(min)}`
  if (hasMax) return `up to ${format(max)}`
  return null
}

/** True when a band is stored backwards (max below min) — the server says so with a 422. */
export function salaryBandError(
  min: number | null,
  max: number | null
): string | null {
  if (min !== null && max !== null && min > max) {
    return 'The top of the band is below the bottom of it'
  }
  if (min !== null && min < 0) return 'A salary band cannot start below zero'
  if (max !== null && max < 0) return 'A salary band cannot end below zero'
  return null
}

/**
 * The same graph the server enforces (PHASE2 contract §rules.3): one step forward along the
 * funnel, any open status may close, and the only way back out of a closed status is a reopen to
 * `applied`. Kept in sync by `lib/os/career.test.ts`, which pins it against the documented set.
 */
const FORWARD: Record<JobApplicationStatus, JobApplicationStatus[]> = {
  saved: ['applied', 'rejected', 'withdrawn'],
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: ['applied'],
  withdrawn: ['applied'],
}

export function allowedTransitions(
  status: JobApplicationStatus | string | null | undefined
): JobApplicationStatus[] {
  return FORWARD[status as JobApplicationStatus] ?? []
}

export function isClosedApplication(status: string | null | undefined): boolean {
  return (CLOSED_APPLICATION_STATUSES as readonly string[]).includes(String(status))
}

/** Interview quick-picks: the durations people actually schedule, in minutes. */
export const INTERVIEW_DURATIONS = [30, 45, 60, 90] as const
