/**
 * Money *display* for the Finance screens.
 *
 * The server owns every calculation (docs/MYOS/PHASE3_FINANCE.md §2): figures arrive
 * already quantised, totals are aggregated in Python, and nothing is converted behind the
 * user's back. This module therefore never adds, averages or converts — it turns a number
 * plus an ISO code into text a person can read. That still needs two real facts the generic
 * `Intl` currency style gets wrong for us: which currencies have no minor unit (JPY, KRW,
 * VND…) and which are grouped the Indian way (₹1,00,000 not ₹100,000).
 *
 * Codes are validated against the server's registry (`GET /currencies`, built from
 * `backend/app/core/currencies.py`); an unknown code here is not an error, it just falls
 * back to printing the code as its own symbol.
 */

/** Currencies whose smallest unit is the whole unit — 0 decimal places, always. */
const ZERO_DECIMAL = new Set([
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'ISK',
  'PYG',
  'RWF',
  'UGX',
  'XAF',
  'XOF',
  'XAG',
  'XAU',
])

/** Codes people write with 1,00,000 grouping (lakh / crore). */
const SOUTH_ASIAN_GROUPING = new Set(['INR', 'PKR', 'NPR', 'BDT', 'LKR', 'MUR'])

/** Display glyphs for the common codes. Anything absent prints its own ISO code. */
const GLYPHS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  PKR: '₨',
  NPR: 'रू',
  BDT: '৳',
  LKR: 'Rs',
  MUR: 'Rs',
  AED: 'د.إ',
  SAR: '﷼',
  QAR: '﷼',
  KWD: 'د.ك',
  OMR: '﷼',
  SGD: 'S$',
  MYR: 'RM',
  THB: '฿',
  KRW: '₩',
  VND: '₫',
  CHF: 'CHF',
  CAD: 'C$',
  AUD: 'A$',
  NZD: 'NZ$',
  ZAR: 'R',
  NGN: '₦',
  TRY: '₺',
  BRL: 'R$',
  MXN: 'Mex$',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  IDR: 'Rp',
  PHP: '₱',
  HKD: 'HK$',
  TWD: 'NT$',
  ILS: '₪',
  EGP: 'E£',
  COP: 'COL$',
  CLP: 'CLP$',
  ARS: '$',
}

const PLACEHOLDER = '—'

/** 2 for almost everything, 0 for the zero-decimal codes. */
export function minorUnits(code?: string | null): 0 | 2 {
  return ZERO_DECIMAL.has(normaliseCode(code)) ? 0 : 2
}

function normaliseCode(code?: string | null): string {
  return (code || '').trim().toUpperCase()
}

/** The symbol to put in front of a figure; falls back to the ISO code itself. */
export function currencyGlyph(code?: string | null): string {
  const upper = normaliseCode(code)
  if (!upper) return ''
  return GLYPHS[upper] ?? upper
}

function group(value: number, decimals: number, indian: boolean): string {
  try {
    return new Intl.NumberFormat(indian ? 'en-IN' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  } catch {
    return value.toFixed(decimals)
  }
}

export interface MoneyOptions {
  /** `'auto'` (default) keeps a minus sign; `'always'` prefixes `+` for positives. */
  sign?: 'auto' | 'always' | 'never'
  /** Force decimal places, e.g. when a rate-like figure needs more than the currency allows. */
  decimals?: number
  /** Put the glyph after the number (`1 200 €`), which is how most of Europe writes it. */
  glyphAfter?: boolean
  /** Compact for large figures: `₹1.24 L`, `$1.2M`. Off by default. */
  compact?: boolean
}

/**
 * One figure, one currency, one string. `null`/`NaN` is an em dash — a missing amount is
 * never rendered as `0`, because 0 is a fact the user did not state. An explicit `null` code
 * prints the figure with no glyph instead of borrowing someone else's currency; leaving the
 * argument out means the workspace default, which is INR.
 */
export function formatMoney(
  value: number | null | undefined,
  code: string | null = 'INR',
  options: MoneyOptions = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return PLACEHOLDER
  const { sign = 'auto', glyphAfter = false, compact = false } = options
  const upper = normaliseCode(code)
  const decimals = options.decimals ?? minorUnits(upper)
  const indian = SOUTH_ASIAN_GROUPING.has(upper)
  const negative = value < 0
  const magnitude = Math.abs(value)
  const body = compact
    ? compactNumber(magnitude, decimals, indian)
    : group(magnitude, decimals, indian)
  const glyph = currencyGlyph(upper)
  const joined = glyphAfter ? `${body}${glyph ? ` ${glyph}` : ''}` : `${glyph}${body}`
  if (negative && sign !== 'never') return `−${joined}`
  if (!negative && sign === 'always' && magnitude > 0) return `+${joined}`
  return joined
}

/** `124000 → 1.24 L` / `1240000 → 12.4 L` / `1240 → 1.2 k`, always 1-2 significant groups. */
export function compactNumber(magnitude: number, decimals: number, indian: boolean): string {
  if (indian) {
    if (magnitude >= 1e7) return `${trim(magnitude / 1e7, 2)} Cr`
    if (magnitude >= 1e5) return `${trim(magnitude / 1e5, 2)} L`
    if (magnitude >= 1e3) return `${trim(magnitude / 1e3, 1)} k`
    return group(magnitude, Math.min(decimals, 0), indian)
  }
  if (magnitude >= 1e9) return `${trim(magnitude / 1e9, 2)}B`
  if (magnitude >= 1e6) return `${trim(magnitude / 1e6, 2)}M`
  if (magnitude >= 1e3) return `${trim(magnitude / 1e3, 1)}k`
  return group(magnitude, Math.min(decimals, 0), indian)
}

function trim(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)))
}

/** Exchange rates are `NUMERIC(18,6)`: show what is there without inventing precision. */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return PLACEHOLDER
  const fixed = value.toFixed(6)
  return fixed.replace(/0+$/, '').replace(/\.$/, '.0')
}

/** part ÷ whole as a percentage, `null` when the whole is 0 (0 % would be a lie). */
export function shareOf(part: number | null, whole: number | null | undefined): number | null {
  if (part === null || whole === null || whole === undefined || whole === 0) return null
  if (Number.isNaN(part) || Number.isNaN(whole)) return null
  return (part / whole) * 100
}

export type DeltaDirection = 'up' | 'down' | 'flat' | 'unknown'

export interface MoneyDelta {
  direction: DeltaDirection
  abs: number | null
  pct: number | null
}

/**
 * Month-on-month movement. A previous figure of 0 has no percentage — the direction is
 * still true and the caller shows `new` rather than `+∞ %`.
 */
export function moneyDelta(current: number | null, previous: number | null): MoneyDelta {
  if (current === null || previous === null) return { direction: 'unknown', abs: null, pct: null }
  const abs = current - previous
  if (abs === 0) return { direction: 'flat', abs: 0, pct: 0 }
  return {
    direction: abs > 0 ? 'up' : 'down',
    abs,
    pct: previous === 0 ? null : (abs / Math.abs(previous)) * 100,
  }
}

/* ---------------------------------------------------------------- months ---- */

/** `2026-11-14` → `2026-11`. Pure string math: no Date, so no timezone drift. */
export function monthKey(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null
  const match = /^(\d{4})-(\d{2})/.exec(isoDate.trim())
  return match ? `${match[1]}-${match[2]}` : null
}

/** Shift a `YYYY-MM` key by whole months, rolling the year correctly. */
export function addMonths(key: string, months: number): string {
  const [year, month] = key.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12 + 12) % 12
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`
}

/** Calendar distance in whole months between two keys (`a - b`). */
export function monthDistance(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return ay * 12 + am - (by * 12 + bm)
}

function monthParts(key: string): [number, number] {
  const [year, month] = key.split('-').map(Number)
  return [year, month]
}

/** First and last real day of a `YYYY-MM` key, as `YYYY-MM-DD` (leap years included). */
export function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = monthParts(key)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/** `2026-11` → `Nov 2026`; `long` gives `November 2026`. */
export function monthLabel(key: string | null | undefined, opts: { long?: boolean } = {}): string {
  if (!key) return PLACEHOLDER
  const [year, month] = monthParts(key)
  const names = opts.long
    ? [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const name = names[month - 1]
  return name ? `${name} ${year}` : key
}

/** `2026-11` → `Nov`, for a chart axis where the year is stated once. */
export function monthShort(key: string): string {
  return monthLabel(key).split(' ')[0] ?? key
}

/** `YYYY-MM` keys from `from` to `to` inclusive, capped so a typo cannot build 900 months. */
export function monthRange(from: string, to: string, cap = 240): string[] {
  const out: string[] = []
  let cursor = from
  while (monthDistance(cursor, to) <= 0 && out.length < cap) {
    out.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return out
}

/* ------------------------------------------------------------- user input --- */

/** Parse a money field the way the API expects it: plain decimal, no grouping, no currency. */
export function parseMoney(text: string | null | undefined): number | null {
  const raw = (text ?? '').trim().replace(/\s/g, '').replace(/,/g, '')
  if (!raw) return null
  if (!/^-?\d*(\.\d*)?$/.test(raw)) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** Field-level message for a money input, so a form can block a submit with a reason. */
export function moneyInputError(
  text: string | null | undefined,
  opts: { required?: boolean; min?: number; max?: number } = {}
): string | null {
  const raw = (text ?? '').trim()
  if (!raw) return opts.required ? 'Enter an amount' : null
  const value = parseMoney(raw)
  if (value === null) return 'Numbers only — no currency symbol or commas'
  const decimals = raw.split('.')[1]?.length ?? 0
  if (decimals > 2) return 'Money is stored to 2 decimal places'
  if (opts.min !== undefined && value < opts.min) return `Must be ${opts.min} or more`
  if (opts.max !== undefined && value > opts.max) return `Must be ${opts.max} or less`
  return null
}

/**
 * Why `runway_months` came back `null`, as far as the summary can tell. The API nulls the
 * runway in three situations — the burn is 0, the burn could not be named in one currency,
 * or the cash figure could not be named — and only the first is "no spend".
 */
export type RunwayGap = {
  /** `false` when the response itself named no currency (a mixed book, no target). */
  named?: boolean
  burn?: number | null
  cash?: number | null
}

/**
 * Say why there is no runway instead of printing a fake number. A missing `gap` keeps the
 * burn-is-zero reading, which is what the summary meant before the currency rules (§2.3).
 */
export function runwayLabel(months: number | null | undefined, gap?: RunwayGap): string {
  if (months !== null && months !== undefined) {
    if (months >= 12) return `${(months / 12).toFixed(1)} yrs`
    if (months <= 0) return 'out of runway'
    return `${months.toFixed(1)} months`
  }
  if (gap?.named === false) return 'name a currency to measure'
  if (gap && (gap.cash === null || gap.cash === undefined)) return 'no cash figure'
  return 'no spend to run against'
}
