import { NextResponse, type NextRequest } from 'next/server'

/**
 * Server-side proxy from the browser to the FastAPI backend.
 *
 *   /api/os/v1/projects?status=active  →  ${MYOS_API_URL}/api/v1/projects?status=active
 *
 * The browser never learns the backend origin or any credential: request
 * headers that could carry a session (Cookie, Authorization, X-API-Key, …) are
 * dropped here, as required by docs/MYOS/ARCHITECTURE.md §1.
 *
 * An unreachable backend is aborted after UPSTREAM_TIMEOUT_MS and answers
 * 502 `{"error":{"code":"upstream_unavailable"}}`, so a stopped FastAPI shows
 * the offline card instead of a spinner that never ends.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPSTREAM_TIMEOUT_MS = 15_000

/** Never forwarded upstream, whatever the browser sends. */
const BLOCKED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-apikey',
  'x-access-token',
  'x-csrf-token',
  'forwarded',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-real-ip',
  'referer',
  'origin',
  'host',
])

/** Only these survive the hop. */
const ALLOWED_REQUEST_HEADERS = new Set(['content-type', 'accept', 'accept-language'])

function upstreamBase(): string {
  const raw = process.env.MYOS_API_URL ?? 'http://127.0.0.1:8000'
  return raw.replace(/\/+$/, '')
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message, details: [] } }, { status })
}

/** Rejects traversal and anything that is not a plain path segment. */
function safeSegments(path?: string[]): string[] | null {
  if (!path || path.length === 0) return null
  const out: string[] = []
  for (const segment of path) {
    const decoded = decodeSegment(segment)
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\'))
      return null
    if (!/^[A-Za-z0-9][A-Za-z0-9._@:%~+-]*$/.test(decoded)) return null
    out.push(encodeURIComponent(decoded))
  }
  return out
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

interface RouteContext {
  params: Promise<{ path?: string[] }>
}

async function handler(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params
  const segments = safeSegments(path)
  if (!segments) return errorResponse(404, 'not_found', 'Unknown MyOS API route')

  const search = request.nextUrl.search
  const target = `${upstreamBase()}/api/${segments.join('/')}${search}`

  const init: RequestInit = {
    method: request.method,
    headers: pickHeaders(request.headers),
    cache: 'no-store',
    redirect: 'manual',
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.arrayBuffer()
    if (body.byteLength > 0) init.body = body
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  init.signal = controller.signal

  try {
    const upstream = await fetch(target, init)
    clearTimeout(timer)

    const payload = await upstream.arrayBuffer()
    const headers = new Headers()
    const contentType = upstream.headers.get('content-type')
    headers.set('content-type', contentType ?? 'application/json')
    // CORS is same-origin (the browser only ever talks to Next), so keep it closed.
    headers.set('cache-control', 'no-store')

    if (upstream.status === 204 || payload.byteLength === 0) {
      return new NextResponse(null, { status: upstream.status, headers })
    }
    return new NextResponse(payload, { status: upstream.status, headers })
  } catch (cause) {
    clearTimeout(timer)
    const timedOut = controller.signal.aborted
    console.error(
      `[os-proxy] ${request.method} ${target} failed: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    return errorResponse(
      502,
      'upstream_unavailable',
      timedOut
        ? `MyOS API did not respond within ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)}s`
        : 'MyOS API is unreachable — is the backend running?'
    )
  }
}

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (BLOCKED_REQUEST_HEADERS.has(lower) || !ALLOWED_REQUEST_HEADERS.has(lower)) return
    out[lower] = value
  })
  return out
}

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const DELETE = handler
export const OPTIONS = handler
