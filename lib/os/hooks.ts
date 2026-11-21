'use client'

/**
 * Tiny resource cache + hooks, modelled on lib/useTable.ts (loading / error /
 * reload-on-focus) but keyed by request path so a mutation can revalidate every
 * screen that depends on it. No external data-fetching dependency by design.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { api, buildQuery, isOsApiError, OsApiError, type Method, type Query } from './client'
import { CANONICAL_ENUMS } from './enums'
import type { EnumSet, Health, Meta, Workspace } from './types'

interface EntryState<T> {
  data: T | undefined
  error: OsApiError | null
  loading: boolean
  fetchedAt: number
}

interface Entry {
  state: EntryState<unknown>
  inflight: Promise<void> | null
  subs: Set<() => void>
}

/** Cache key: `/projects?status=active` — the API path plus its query string. */
function keyOf(path: string, query?: Query): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${clean}${buildQuery(query)}`
}

function splitKey(key: string): { path: string; query?: Query } {
  const idx = key.indexOf('?')
  if (idx === -1) return { path: key }
  const params = new URLSearchParams(key.slice(idx + 1))
  const query: Query = {}
  params.forEach((value, k) => {
    query[k] = value
  })
  return { path: key.slice(0, idx), query }
}

const store = new Map<string, Entry>()

const INITIAL: EntryState<unknown> = { data: undefined, error: null, loading: true, fetchedAt: 0 }

function toApiError(e: unknown): OsApiError {
  if (isOsApiError(e)) return e
  return new OsApiError({
    status: 0,
    code: 'client_error',
    message: e instanceof Error ? e.message : 'Unexpected client error',
    details: [],
  })
}

function ensure(key: string): Entry {
  const existing = store.get(key)
  if (existing) return existing
  const entry: Entry = { state: INITIAL, inflight: null, subs: new Set() }
  store.set(key, entry)
  return entry
}

function patch(entry: Entry, next: Partial<EntryState<unknown>>): void {
  entry.state = { ...entry.state, ...next }
  entry.subs.forEach((notify) => notify())
}

function refresh(entry: Entry, key: string, force: boolean): Promise<void> {
  if (entry.inflight) return entry.inflight
  if (!force && entry.state.fetchedAt > 0) return Promise.resolve()

  const { path, query } = splitKey(key)
  const task = (async () => {
    try {
      const data = await api<unknown>(path, { query })
      patch(entry, { data, error: null, loading: false, fetchedAt: Date.now() })
    } catch (e) {
      patch(entry, { error: toApiError(e), loading: entry.state.data === undefined })
    } finally {
      entry.inflight = null
    }
  })()

  entry.inflight = task
  return task
}

/**
 * Revalidation. A key matches a prefix when its path is the prefix itself,
 * `prefix?…` (a filtered list) or `prefix/…` (a detail or sub-resource), so
 * `invalidate('/projects')` also clears `/projects/{id}` and `…/stats`.
 */
export function invalidate(...prefixes: string[]): void {
  const entries: [string, Entry][] = []
  store.forEach((entry, key) => entries.push([key, entry]))
  for (const raw of prefixes) {
    const needle = raw.startsWith('/') ? raw : `/${raw}`
    for (const [key, entry] of entries) {
      const path = key.split('?')[0]
      const matches =
        path === needle || path.startsWith(`${needle}/`) || key.startsWith(`${needle}?`) || key === needle
      if (!matches) continue
      if (entry.subs.size === 0) {
        store.delete(key)
        continue
      }
      entry.state = { ...entry.state, fetchedAt: 0 }
      void refresh(entry, key, true)
    }
  }
}

/** Drops one cache entry outright (used after a destructive action). */
export function dropResource(path: string, query?: Query): void {
  const key = keyOf(path, query)
  const entry = store.get(key)
  if (!entry) return
  entry.state = INITIAL
  entry.subs.forEach((notify) => notify())
}

export interface UseResourceResult<T> {
  data: T | undefined
  error: OsApiError | null
  /** Nothing on screen yet: first load, or a reload after invalidation. */
  loading: boolean
  reload: () => void
  /** Local write-through for optimistic UI (checkbox flips, inline rename). */
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void
}

/**
 * GETs `path` (relative to `/api/os/v1`) and keeps the result in the shared
 * cache. Pass `null` as the path to skip the request entirely.
 */
export function useResource<T>(path: string | null, query?: Query): UseResourceResult<T> {
  const queryKey = query ? buildQuery(query) : ''
  const key = useMemo(
    () => (path ? keyOf(path, query) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, queryKey]
  )

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!key) return () => undefined
      const entry = ensure(key)
      entry.subs.add(notify)
      void refresh(entry, key, false)
      return () => {
        entry.subs.delete(notify)
      }
    },
    [key]
  )

  const getSnapshot = useCallback(() => (key ? ensure(key).state : INITIAL), [key])
  const getServerSnapshot = useCallback(() => INITIAL, [])

  const state = useSyncExternalStore<EntryState<unknown>>(subscribe, getSnapshot, getServerSnapshot)

  const reload = useCallback(() => {
    if (!key) return
    const entry = ensure(key)
    entry.state = { ...entry.state, fetchedAt: 0 }
    void refresh(entry, key, true)
  }, [key])

  const setData = useCallback(
    (updater: T | ((prev: T | undefined) => T | undefined)) => {
      if (!key) return
      const entry = ensure(key)
      const next =
        typeof updater === 'function'
          ? (updater as (prev: T | undefined) => T | undefined)(entry.state.data as T | undefined)
          : updater
      patch(entry, { data: next })
    },
    [key]
  )

  // Reload on focus, like lib/useTable.ts, so a second tab or the CLI shows up.
  useEffect(() => {
    if (!key) return
    const onFocus = () => {
      const entry = store.get(key)
      if (entry) void refresh(entry, key, true)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [key])

  return {
    data: state.data as T | undefined,
    error: state.error,
    loading: !!key && state.loading,
    reload,
    setData,
  }
}

/* --------------------------------------------------------------- mutations */

export interface MutationOptions {
  /** Cache prefixes to revalidate after a successful write. */
  invalidates?: string[]
}

export interface UseMutationResult<TRes, TBody = unknown> {
  mutate: (body?: TBody) => Promise<TRes>
  pending: boolean
  error: OsApiError | null
  reset: () => void
}

function useApiMutation<TRes, TBody>(
  resolve: () => string,
  method: Method,
  invalidates?: string[]
): UseMutationResult<TRes, TBody> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<OsApiError | null>(null)
  const alive = useRef(true)
  const targets = useRef<string[] | undefined>(invalidates)
  targets.current = invalidates

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const mutate = useCallback(
    async (body?: TBody) => {
      if (alive.current) {
        setPending(true)
        setError(null)
      }
      try {
        const data = await api<TRes>(resolve(), {
          method,
          body: method === 'DELETE' || body === undefined ? undefined : body,
        })
        if (targets.current?.length) invalidate(...targets.current)
        if (alive.current) setPending(false)
        return data
      } catch (e) {
        const err = toApiError(e)
        if (alive.current) {
          setError(err)
          setPending(false)
        }
        throw err
      }
    },
    [method, resolve]
  )

  const reset = useCallback(() => setError(null), [])

  return { mutate, pending, error, reset }
}

function useResolver(path: string | (() => string)): () => string {
  const ref = useRef<string | (() => string)>(path)
  ref.current = path
  return useCallback(() => {
    const value = typeof ref.current === 'function' ? ref.current() : ref.current
    return value.startsWith('/') ? value : `/${value}`
  }, [])
}

/** POST `path` with a body. Pass a function to resolve the path at call time. */
export function useCreate<TRes = unknown, TBody = unknown>(
  path: string | (() => string),
  opts: MutationOptions = {}
): UseMutationResult<TRes, TBody> {
  return useApiMutation<TRes, TBody>(useResolver(path), 'POST', opts.invalidates)
}

/** PATCH `path` with a body. */
export function useUpdate<TRes = unknown, TBody = unknown>(
  path: string | (() => string),
  opts: MutationOptions = {}
): UseMutationResult<TRes, TBody> {
  return useApiMutation<TRes, TBody>(useResolver(path), 'PATCH', opts.invalidates)
}

/** PUT `path` with a body. */
export function usePut<TRes = unknown, TBody = unknown>(
  path: string | (() => string),
  opts: MutationOptions = {}
): UseMutationResult<TRes, TBody> {
  return useApiMutation<TRes, TBody>(useResolver(path), 'PUT', opts.invalidates)
}

/** DELETE `path` (no body). */
export function useRemove<TRes = unknown>(
  path: string | (() => string),
  opts: MutationOptions = {}
): UseMutationResult<TRes, void> {
  return useApiMutation<TRes, void>(useResolver(path), 'DELETE', opts.invalidates)
}

/** A body-less POST — `/tasks/{id}/complete`, `/notifications/refresh`, … */
export function useAction<TRes = unknown>(
  path: string | (() => string),
  opts: MutationOptions = {}
): UseMutationResult<TRes, void> {
  return useApiMutation<TRes, void>(useResolver(path), 'POST', opts.invalidates)
}

/* ------------------------------------------------------------------ shared */

export function useHealth() {
  return useResource<Health>('/health')
}

export function useWorkspace() {
  return useResource<Workspace>('/workspace')
}

export function useMeta() {
  return useResource<Meta>('/meta')
}

/**
 * `GET /meta` keys its enumerations exactly as API.md writes them — `task.status`,
 * `note.category`, `note_relation.target_type`. The UI reads them as properties
 * (`task_status`), so every key is re-spelled here first. Lists the server does
 * not send keep their documented fallback; a list it does send always wins.
 */
export function normaliseEnums(raw?: Record<string, string[]> | null): EnumSet {
  const out: EnumSet = { ...CANONICAL_ENUMS }
  if (!raw) return out
  for (const [key, values] of Object.entries(raw)) {
    if (!Array.isArray(values)) continue
    const clean = values.filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (!clean.length) continue
    out[key.replace(/[^A-Za-z0-9]+/g, '_')] = clean
  }
  return out
}

/** Enum options for selects: `GET /meta` when it answers, else the documented set. */
export function useEnums(): { enums: EnumSet; loading: boolean } {
  const meta = useMeta()
  return { enums: normaliseEnums(meta.data?.enums), loading: meta.loading }
}

/** Workspace slug from `GET /workspace`, used to namespace local prefs. */
export function useWorkspaceSlug(): string {
  const { data } = useWorkspace()
  return data?.slug ?? 'default'
}

/* ------------------------------------------------------------- local prefs */

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or quota — the screen works, it just won't persist */
  }
}

/** localStorage-backed preference (widget layout, view mode, sidebar state). */
export function useLocalState<T>(
  key: string,
  fallback: T
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readLocal(key, fallback))

  useEffect(() => {
    setValue(readLocal(key, fallback))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        writeLocal(key, resolved)
        return resolved
      })
    },
    [key]
  )

  return [value, write]
}

/* --------------------------------------------------------------------- misc */

/** Debounced value for search-as-you-type inputs. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** False during SSR, true after mount — guards store reads that must match. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
