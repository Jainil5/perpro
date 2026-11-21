/**
 * Typed client for the MyOS API.
 *
 * Every request goes to the Next.js proxy at /api/os/* (never to FastAPI
 * directly — see docs/MYOS/ARCHITECTURE.md §1). Paths given here are relative
 * to the versioned base, e.g. api<Project[]>('/projects').
 */

export const OS_BASE = '/api/os/v1'

export type QueryValue = string | number | boolean | null | undefined | string[]
export type Query = Record<string, QueryValue>

/** Skips null/undefined/empty values; repeats the key for arrays. */
export function buildQuery(query?: Query): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, String(v))
      continue
    }
    if (typeof value === 'string' && value.trim() === '') continue
    if (typeof value === 'boolean') {
      if (value) sp.set(key, 'true')
      continue
    }
    sp.set(key, String(value))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export function apiUrl(path: string, query?: Query): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${OS_BASE}${clean}${buildQuery(query)}`
}

/* ------------------------------------------------------------------ errors -- */

export interface FieldIssue {
  field: string
  message: string
}

export interface OsErrorShape {
  code: string
  message: string
  details: FieldIssue[]
}

export const ERROR_CODES = {
  notFound: 'not_found',
  conflict: 'conflict',
  validation: 'validation_error',
  upstream: 'upstream_unavailable',
  network: 'network_error',
  timeout: 'timeout',
} as const

/** Normalised API failure: `code`, `message` and field-level `details`. */
export class OsApiError extends Error {
  readonly code: string
  readonly details: FieldIssue[]
  readonly status: number

  constructor(shape: OsErrorShape & { status: number }) {
    super(shape.message)
    this.name = 'OsApiError'
    this.code = shape.code
    this.details = shape.details
    this.status = shape.status
  }

  /** "email: must be a valid address" style lines for form fields. */
  get issues(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const d of this.details) if (d.field) map[d.field] = d.message
    return map
  }

  get isUpstreamDown(): boolean {
    return this.code === ERROR_CODES.upstream || this.status === 502 || this.status === 504
  }
}

export function isOsApiError(e: unknown): e is OsApiError {
  return e instanceof OsApiError
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

function fieldOf(loc: unknown): string {
  if (Array.isArray(loc)) {
    const last = loc.filter((p) => typeof p === 'string' || typeof p === 'number').at(-1)
    return asString(last)
  }
  return asString(loc)
}

/**
 * Turns any response body into the contract's `{ code, message, details }`.
 * Handles both the documented `{ error: { … } }` envelope and a bare FastAPI
 * `detail` payload, which the proxy passes through unchanged.
 */
export function normaliseError(status: number, payload: unknown): OsErrorShape {
  const fallbackMessage =
    status === 404
      ? 'Not found'
      : status === 409
        ? 'That conflicts with existing data'
        : status === 422
          ? 'Please correct the highlighted fields'
          : status >= 500
            ? 'The MyOS API returned a server error'
            : `Request failed (${status})`

  if (payload == null || typeof payload !== 'object') {
    const text = typeof payload === 'string' ? payload.trim() : ''
    return {
      code: status >= 500 ? 'server_error' : 'request_failed',
      message: text || fallbackMessage,
      details: [],
    }
  }

  const body = payload as Record<string, unknown>
  const wrapped = body.error
  if (wrapped && typeof wrapped === 'object') {
    const err = wrapped as Record<string, unknown>
    return {
      code: asString(err.code) || 'request_failed',
      message: asString(err.message) || fallbackMessage,
      details: normaliseDetails(err.details ?? err.detail ?? body.detail),
    }
  }
  // undocumented-but-possible FastAPI shape: { detail: [...] | "..." }
  return {
    code: status === 422 ? 'validation_error' : 'request_failed',
    message: fallbackMessage,
    details: normaliseDetails(body.detail),
  }
}

function normaliseDetails(raw: unknown): FieldIssue[] {
  if (!Array.isArray(raw)) return []
  const out: FieldIssue[] = []
  for (const item of raw) {
    if (item == null) continue
    if (typeof item === 'string') {
      out.push({ field: '', message: item })
      continue
    }
    const obj = item as Record<string, unknown>
    out.push({
      field: fieldOf(obj.field ?? obj.loc ?? obj.name),
      message: asString(obj.message ?? obj.msg ?? obj.detail) || 'invalid value',
    })
  }
  return out
}

/* ------------------------------------------------------------------ requests */

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: Method
  body?: unknown
  query?: Query
  signal?: AbortSignal
  /** Milliseconds before the call is abandoned. */
  timeoutMs?: number
}

/** Fetches and parses JSON, throwing a normalised OsApiError on failure. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const url = apiUrl(path, opts.query)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  let res: Response
  try {
    res = await fetch(url, {
      method,
      signal: opts.signal ? combineSignals([opts.signal, controller.signal]) : controller.signal,
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    })
  } catch (e) {
    clearTimeout(timeout)
    if (opts.signal?.aborted) throw toAbortError(e)
    if (controller.signal.aborted) throw timeoutError()
    throw new OsApiError({
      status: 502,
      code: ERROR_CODES.network,
      message: 'Could not reach the MyOS API. Is the backend running?',
      details: [],
    })
  }
  clearTimeout(timeout)

  const text = await res.text()
  const payload = text ? safeJson(text) : null

  if (!res.ok) {
    const shape = normaliseError(res.status, payload)
    throw new OsApiError({ ...shape, status: res.status })
  }
  if (res.status === 204 || payload === null) return undefined as T
  return payload as T
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const anySignal = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (anySignal) return anySignal(signals)
  const combined = new AbortController()
  for (const s of signals) {
    if (s.aborted) combined.abort()
    else s.addEventListener('abort', () => combined.abort(), { once: true })
  }
  return combined.signal
}

function timeoutError(): OsApiError {
  return new OsApiError({
    status: 408,
    code: ERROR_CODES.timeout,
    message: 'The MyOS API did not respond in time',
    details: [],
  })
}

function toAbortError(e: unknown): OsApiError {
  if (isOsApiError(e)) return e
  return new OsApiError({
    status: 408,
    code: ERROR_CODES.timeout,
    message: 'The request timed out',
    details: [],
  })
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Thin POST helper (actions like /tasks/{id}/complete). */
export function post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) {
  return api<T>(path, { ...opts, method: 'POST', body })
}

/**
 * Downloads /export through the proxy and triggers a browser save. Returns the
 * parsed payload so callers can name the file from its timestamp.
 */
export async function downloadExport(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(apiUrl('/export'), { cache: 'no-store' })
  if (!res.ok) {
    const shape = normaliseError(res.status, safeJson(await res.text()))
    throw new OsApiError({ ...shape, status: res.status })
  }
  const blob = await res.blob()
  return { blob, filename: `myos-export-${new Date().toISOString().slice(0, 10)}.json` }
}

/** One-line message for toasts and error banners. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (isOsApiError(e)) {
    if (e.isUpstreamDown) return 'MyOS API is unreachable — start the backend, then retry.'
    return e.message || fallback
  }
  if (e instanceof Error) return e.message || fallback
  return fallback
}
