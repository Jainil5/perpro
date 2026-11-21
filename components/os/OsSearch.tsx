'use client'

import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  Folder,
  ListChecks,
  Moon,
  Plus,
  Search as SearchIcon,
  Sun,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { osHref } from '@/lib/os/format'
import { useDebounced, useResource } from '@/lib/os/hooks'
import { OS_PAGE_INDEX } from '@/lib/os/nav'
import type { SearchResponse } from '@/lib/os/types'
import { Badge } from './ui/badge'
import { Dialog, DialogContent } from './ui/dialog'
import { useOsTheme } from './os-bootstrap'
import { useQuickCreate, type QuickKind } from './QuickCreate'

interface Row {
  key: string
  group: string
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  /** Either a navigation target or a command — never both. */
  href?: string
  run?: () => void
}

const CREATE_COMMANDS: { kind: QuickKind; label: string; search: string; icon: ReactNode }[] = [
  { kind: 'task', label: 'New task', search: 'new task create todo', icon: <ListChecks /> },
  { kind: 'project', label: 'New project', search: 'new project create repo', icon: <Folder /> },
  { kind: 'note', label: 'New note', search: 'new note write markdown', icon: <FileText /> },
  { kind: 'contact', label: 'New contact', search: 'new contact person company', icon: <Users /> },
  {
    kind: 'reminder',
    label: 'New reminder',
    search: 'new reminder alarm schedule',
    icon: <Plus />,
  },
  {
    kind: 'import',
    label: 'Import tasks from JSON',
    search: 'import json paste agent bulk tasks',
    icon: <Plus />,
  },
]

/**
 * ⌘K palette: one input over `GET /search`, grouped results with counts,
 * keyboard navigation, plus create/navigate/toggle-theme commands. It only ever
 * reads through the API proxy — no client-side copy of the data.
 */
export default function OsSearch({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const quick = useQuickCreate()
  const [theme, setTheme] = useOsTheme()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const term = useDebounced(q.trim(), 250)

  const search = useResource<SearchResponse>(
    open && term.length >= 2 ? '/search' : null,
    { q: term, limit: 8 }
  )

  useEffect(() => {
    if (!open) setQ('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => setActive(0), [term, q])

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase()
    const out: Row[] = []

    const matchingCommands = CREATE_COMMANDS.filter((item) =>
      needle ? `${item.label} ${item.search}`.toLowerCase().includes(needle) : !term
    )
    for (const item of matchingCommands.slice(0, term ? 4 : 6)) {
      out.push({
        key: `create-${item.kind}`,
        group: 'Create',
        label: item.label,
        icon: item.icon,
        run: () => quick.open(item.kind),
      })
    }

    const pages = OS_PAGE_INDEX.filter(
      (page) => !needle || page.label.toLowerCase().includes(needle) || page.href.includes(needle)
    )
    for (const page of pages.slice(0, term ? 5 : 9)) {
      out.push({
        key: `page-${page.href}`,
        group: 'Jump to',
        label: page.label,
        hint: <span className="text-faint">{page.group}</span>,
        href: page.href,
      })
    }

    const toggle: Row = {
      key: 'theme',
      group: 'Commands',
      label: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
      icon: theme === 'light' ? <Moon /> : <Sun />,
      run: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    }
    if (!needle || 'theme appearance dark light'.includes(needle)) out.push(toggle)

    for (const group of search.data?.groups ?? []) {
      for (const item of group.items) {
        out.push({
          key: `result-${group.type}-${item.id}`,
          group: `${group.label} · ${group.items.length}`,
          label: item.title,
          hint: item.subtitle ?? undefined,
          icon: undefined,
          href: osHref(item.href),
        })
      }
    }
    return out
  }, [q, theme, search.data, quick, setTheme, term])

  const running = useRef(false)

  const activate = useCallback(
    (row: Row | undefined) => {
      if (!row || running.current) return
      running.current = true
      if (row.run) row.run()
      else if (row.href) router.push(row.href)
      onOpenChange(false)
      // allow the next keypress to open a fresh palette
      setTimeout(() => {
        running.current = false
      }, 50)
    },
    [onOpenChange, router]
  )

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, rows.length])

  const grouped = useMemo(() => {
    const map: { group: string; rows: { row: Row; index: number }[] }[] = []
    rows.forEach((row, index) => {
      const last = map[map.length - 1]
      if (last && last.group === row.group) last.rows.push({ row, index })
      else map.push({ group: row.group, rows: [{ row, index }] })
    })
    return map
  }, [rows])

  const searching = term.length >= 2
  const nothingFound = searching && !search.loading && (search.data?.groups.length ?? 0) === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="top-[12%] translate-y-0"
        hideClose
        aria-label="Search MyOS"
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4">
          <SearchIcon className="size-4 shrink-0 text-faint" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((i) => (rows.length ? (i + 1) % rows.length : 0))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
              } else if (event.key === 'Home') {
                event.preventDefault()
                setActive(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                setActive(Math.max(0, rows.length - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                activate(rows[active])
              }
            }}
            placeholder="Search tasks, projects, notes, people… or type a command"
            aria-label="Search MyOS"
            aria-controls="os-search-results"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full min-w-0 border-0 bg-transparent text-[14px] outline-none placeholder:text-faint focus:ring-0"
          />
          {search.loading && searching ? (
            <span className="os-mono shrink-0 text-[10px] text-faint">searching…</span>
          ) : null}
        </div>

        <div
          ref={listRef}
          id="os-search-results"
          role="listbox"
          aria-label="Results"
          aria-activedescendant={`os-search-row-${active}`}
          tabIndex={-1}
          className="os-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2"
        >
          {search.error && searching ? (
            <p className="px-3 py-6 text-xs text-destructive">
              {search.error.isUpstreamDown
                ? 'The MyOS API is unreachable, so search has nothing to query.'
                : search.error.message}
            </p>
          ) : nothingFound ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[13px] font-medium">No match for “{term}”</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Search covers tasks, projects, notes, milestones, contacts and companies.
              </p>
            </div>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-1 last:mb-0">
                <p className="os-eyebrow px-2 pb-1 pt-1.5">{section.group}</p>
                {section.rows.map(({ row, index }) => (
                  <button
                    key={row.key}
                    type="button"
                    id={`os-search-row-${index}`}
                    data-row={index}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => activate(row)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors',
                      index === active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {row.icon ? (
                      <span className="shrink-0 text-faint [&_svg]:size-4">{row.icon}</span>
                    ) : (
                      <ArrowRight className="size-3.5 shrink-0 text-faint" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{row.label}</span>
                      {row.hint ? (
                        <span className="block truncate text-[11px] text-faint">{row.hint}</span>
                      ) : null}
                    </span>
                    {index === active ? (
                      <Badge tone="outline" size="sm">
                        <CornerDownLeft />
                        <span className="os-mono">open</span>
                      </Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <kbd className="os-mono rounded border border-line px-1">↑</kbd>
            <kbd className="os-mono rounded border border-line px-1">↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="os-mono rounded border border-line px-1">↵</kbd> open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="os-mono rounded border border-line px-1">esc</kbd> close
          </span>
          {search.data?.total ? (
            <span className="ml-auto">
              {search.data.total} match{search.data.total === 1 ? '' : 'es'}
              {search.data.query ? ` for “${search.data.query}”` : ''}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
