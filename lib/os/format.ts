/**
 * Formatting helpers shared by every MyOS screen. Dates come back as
 * `YYYY-MM-DD` (calendar dates, no zone) or UTC ISO timestamps; the API never
 * sends localised strings, so all display logic lives here.
 */

import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  parseISO,
} from 'date-fns'

export type DueTone = 'none' | 'overdue' | 'today' | 'soon' | 'later'

/** Local calendar date, `YYYY-MM-DD` — matches the API's date format. */
export function todayDate(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

export function safeDate(value?: string | null): Date | null {
  if (!value) return null
  try {
    const d = parseISO(value.length === 10 ? `${value}T00:00:00` : value)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function formatDate(value?: string | null, pattern = 'd MMM yyyy'): string {
  const d = safeDate(value)
  return d ? format(d, pattern) : '—'
}

export function formatDateTime(value?: string | null): string {
  const d = safeDate(value)
  return d ? format(d, 'd MMM yyyy · HH:mm') : '—'
}

export function formatTime(value?: string | null): string {
  const d = safeDate(value)
  return d ? format(d, 'HH:mm') : '—'
}

export function relativeTime(value?: string | null): string {
  const d = safeDate(value)
  if (!d) return '—'
  if (Math.abs(Date.now() - d.getTime()) < 45_000) return 'just now'
  return `${formatDistanceToNowStrict(d, { roundingMethod: 'floor' })} ago`
}

export function relativeFuture(value?: string | null): string {
  const d = safeDate(value)
  if (!d) return 'no date'
  const dist = formatDistanceToNowStrict(d, { roundingMethod: 'floor' })
  return differenceInCalendarDays(d, new Date()) < 0 ? `${dist} ago` : `in ${dist}`
}

export function daysUntil(value?: string | null, from: string = todayDate()): number | null {
  const d = safeDate(value)
  if (!d) return null
  return differenceInCalendarDays(d, safeDate(from) ?? new Date())
}

/** Tone for a due date, used for colour everywhere a date is shown. */
export function dueTone(value?: string | null, from: string = todayDate()): DueTone {
  if (!value) return 'none'
  const days = daysUntil(value, from)
  if (days === null) return 'none'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 7) return 'soon'
  return 'later'
}

export const DUE_TONE_TEXT: Record<DueTone, string> = {
  none: 'text-muted-foreground',
  overdue: 'text-destructive',
  today: 'text-warning',
  soon: 'text-foreground',
  later: 'text-muted-foreground',
}

/** "Today" / "Tomorrow" / "Mon 24 Nov" / "3 days late". */
export function dueLabel(value?: string | null, from: string = todayDate()): string {
  if (!value) return 'No due date'
  const d = safeDate(value)
  if (!d) return value
  const days = daysUntil(value, from) ?? 0
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return '1 day late'
  if (days < 0) return `${-days} days late`
  if (days <= 7) return format(d, 'EEE d MMM')
  return format(d, 'd MMM yyyy')
}

export function isSameDay(value: string | null | undefined, day: string): boolean {
  if (!value) return false
  return value.slice(0, 10) === day.slice(0, 10)
}

export function dayKey(value?: string | null): string {
  const d = safeDate(value)
  return d ? format(d, 'yyyy-MM-dd') : todayDate()
}

/** "Today", "Yesterday", "Mon 17 Nov" — for grouping timelines. */
export function dayHeading(key: string): string {
  const d = safeDate(key)
  if (!d) return key
  if (isToday(d)) return 'Today'
  const days = differenceInCalendarDays(safeDate(todayDate()) ?? new Date(), d)
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return format(d, 'EEEE')
  return format(d, 'EEE d MMM yyyy')
}

/* ----------------------------------------------------------------- numbers -- */

export function formatCurrency(value: number | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat().format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${Math.round(value)}%`
}

/** 90 → "1h 30m", 45 → "45m". */
export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const h = Math.floor(value / 60)
  const m = Math.round(value % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/* -------------------------------------------------------------------- text -- */

/** `in_progress` → `In progress`; unknown values pass through untouched. */
export function enumLabel(value?: string | null): string {
  if (!value) return '—'
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function initials(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function plural(count: number, one: string, many?: string): string {
  return count === 1 ? one : (many ?? `${one}s`)
}

export function countLabel(count: number, one: string, many?: string): string {
  return `${count} ${plural(count, one, many)}`
}

export function wordCount(text?: string | null): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Trims long titles for narrow slots without breaking the layout. */
export function truncate(value: string, max = 60): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

/** Record pages that address one row with a query param instead of a path segment. */
const OS_RECORD_PARAMS: Record<string, { page: string; param: string }> = {
  tasks: { page: '/os/tasks', param: 'task' },
  notes: { page: '/os/notes', param: 'note' },
  contacts: { page: '/os/contacts', param: 'contact' },
}

/**
 * The app has exactly one link scheme (see docs/MYOS/API.md: notification and
 * activity rows carry `href`s like `/os/tasks?filter=overdue`). The API has so
 * far emitted three other shapes, so every href coming back from the server is
 * normalised before it is rendered:
 *
 *   `/os/tasks/<id>`                → `/os/tasks?task=<id>`
 *   `/os/notes/<id>`                → `/os/notes?note=<id>`
 *   `/os/contacts/<id>`             → `/os/contacts?contact=<id>`
 *   `/os/settings?tab=goals`        → `/os/goals`      (goals have their own page)
 *
 * Anything else — `/os/projects/<id>`, `/os/search?q=…` — is already canonical
 * and passes through untouched.
 */
export function osHref(href: string): string
export function osHref(href?: string | null): string | null
export function osHref(href?: string | null): string | null {
  if (!href || !href.startsWith('/os/')) return href ?? null
  const cut = href.indexOf('?')
  const path = cut === -1 ? href : href.slice(0, cut)
  const query = new URLSearchParams(cut === -1 ? '' : href.slice(cut + 1))

  if (path === '/os/settings' && query.get('tab') === 'goals') return '/os/goals'

  const segments = path.split('/').filter(Boolean)
  const record = segments.length === 3 ? OS_RECORD_PARAMS[segments[1]] : undefined
  if (!record || !segments[2]) return href

  query.set(record.param, segments[2])
  const search = query.toString()
  return `${record.page}${search ? `?${search}` : ''}`
}
