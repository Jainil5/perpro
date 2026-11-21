'use client'

/** Small helpers shared by every MyOS create/edit dialog. */

import { useCallback, useState } from 'react'

import type { OsApiError } from './client'

export interface ObjectForm<T> {
  values: T
  /** Merges a partial update and marks the form dirty. */
  patch: (next: Partial<T>) => void
  /** Replaces every value and clears the dirty flag (call when a dialog opens). */
  reset: (next: T) => void
  dirty: boolean
  setDirty: (next: boolean) => void
}

/** Form state for the create/edit dialogs: one object, partial writes, dirty flag. */
export function useObjectForm<T extends object>(initial: T): ObjectForm<T> {
  const [values, setValues] = useState<T>(initial)
  const [dirty, setDirty] = useState(false)

  const patch = useCallback((next: Partial<T>) => {
    setDirty(true)
    setValues((prev) => ({ ...prev, ...next }))
  }, [])

  const reset = useCallback((next: T) => {
    setDirty(false)
    setValues(next)
  }, [])

  return { values, patch, reset, dirty, setDirty }
}

export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial)

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const reset = useCallback((next: T) => setValues(next), [])

  return { values, set, reset, setValues }
}

/** '' → null, so blank optional fields are stored as null rather than ''. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

export function numOrNull(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseInt((value ?? '').trim(), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function clampPercent(value: number | null | undefined): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Comma / space separated tags → a clean, de-duplicated list. */
export function parseTags(input: string | string[] | null | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? '').split(/[,;\n]/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const tag = raw.trim().replace(/^#/, '')
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** Local date value for `<input type="date">` from an API date string. */
export function dateInputValue(value?: string | null): string {
  return value ? value.slice(0, 10) : ''
}

/** ISO timestamp for `<input type="datetime-local">` from an API timestamp. */
export function dateTimeInputValue(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

/** `datetime-local` value → UTC ISO-8601 with `Z`, as the API expects. */
export function toIsoFromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export interface FormErrorSource {
  error: OsApiError | null
}

/** Picks the message that belongs to a field, for inline validation. */
export function fieldError(error: OsApiError | null, field: string): string | null {
  if (!error) return null
  if (error.code !== 'validation_error') return null
  return error.details.find((d) => d.field === field)?.message ?? null
}

/** Everything that is not field-specific goes in the dialog's banner. */
export function generalError(error: OsApiError | null, fields: string[]): string | null {
  if (!error) return null
  if (error.code === 'validation_error' && error.details.some((d) => fields.includes(d.field))) return null
  return error.message
}
