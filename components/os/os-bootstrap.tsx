'use client'

/**
 * Theme bootstrap.
 *
 * `OsThemeScript` is rendered by app/(os)/layout.tsx *before* the shell markup,
 * so it can put `os-root` / `os-light` on <html> during parsing — the first
 * paint is already the right theme, which is why there is no hydration flash and
 * no `suppressHydrationWarning` trick. The same classes are mirrored onto the
 * `.os-root` wrapper for the shell contract in docs/MYOS/ARCHITECTURE.md §4.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type OsTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'myos.theme'

/** Kept in sync with `app/os.css`; runs before paint and never throws. */
export const THEME_SCRIPT = `(function(){try{var d=document,e=d.documentElement;e.classList.add('os-root');var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');e.classList.toggle('os-light',t==='light');}catch(x){}})();`

export function OsThemeScript() {
  return <script id="os-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
}

/* --------------------------------------------------------------- the store */

type Theme = OsTheme

let current: Theme | null = null
const listeners = new Set<() => void>()

function readFromDom(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('os-light') ? 'light' : 'dark'
}

function snapshot(): Theme {
  if (current === null) current = readFromDom()
  return current
}

/** Reflects the theme on <html> and on every `.os-root` wrapper mounted so far. */
function apply(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.add('os-root')
  root.classList.toggle('os-light', theme === 'light')
  root.style.colorScheme = theme
  document.querySelectorAll<HTMLElement>('.os-root').forEach((el) => {
    if (el === root) return
    el.classList.toggle('os-light', theme === 'light')
  })
}

/** Called by the shell after mount, and whenever a new `.os-root` appears. */
export function syncThemeRoots(): void {
  apply(snapshot())
}

export function setTheme(theme: Theme): void {
  current = theme
  apply(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* private mode: the theme still applies for this session */
  }
  listeners.forEach((notify) => notify())
}

export function toggleTheme(): OsTheme {
  const next: Theme = snapshot() === 'light' ? 'dark' : 'light'
  setTheme(next)
  return next
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/**
 * `[theme, setTheme]`. Server renders `dark`, then the store re-reads the class
 * the bootstrap script already applied — React handles that second read during
 * hydration, so there is no flash and no mismatch warning.
 */
export function useOsTheme(): [OsTheme, (next: OsTheme) => void] {
  const theme = useSyncExternalStore<OsTheme>(subscribe, snapshot, () => 'dark')

  useEffect(() => {
    apply(theme)
  }, [theme])

  const update = useCallback((next: OsTheme) => setTheme(next), [])

  return [theme, update]
}
