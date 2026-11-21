'use client'

import Link from 'next/link'
import { ArrowRight, Search as SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useDebounced, useResource } from '@/lib/os/hooks'
import { countLabel, osHref, plural } from '@/lib/os/format'
import type { SearchResponse } from '@/lib/os/types'
import { Badge } from '@/components/os/ui/badge'
import { Input } from '@/components/os/ui/input'
import { Panel } from '@/components/os/ui/card'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/os/states'
import { FilterBar } from '@/components/os/filters'

export default function SearchView() {
  const params = useSearchParams()
  const router = useRouter()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const q = useDebounced(term.trim(), 250)
  const search = useResource<SearchResponse>(q.length >= 2 ? '/search' : null, { q, limit: 25 })

  // The screen is driven by ?q=, so typing keeps the URL shareable.
  useEffect(() => {
    const fromUrl = params.get('q') ?? ''
    if (fromUrl === q) return
    const next = new URLSearchParams(params.toString())
    if (q) next.set('q', q)
    else next.delete('q')
    router.replace(`/search${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const groups = search.data?.groups ?? []
  const total = search.data?.total ?? 0

  return (
    <div className="os-enter space-y-4">
      <header className="min-w-0 border-b border-line pb-4">
        <p className="os-label">System</p>
        <h1 className="os-title">Search</h1>
        <p className="os-micro mt-2">
          One query across tasks, projects, notes, milestones, contacts and companies. Results come
          straight from <span className="os-mono">GET /search</span>.
        </p>
      </header>

      <FilterBar>
        <div className="relative flex min-w-0 flex-1 items-center">
          <SearchIcon className="pointer-events-none absolute left-3 size-4 text-faint" />
          <Input
            autoFocus
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search everything…"
            aria-label="Search everything"
            className="h-11 min-w-0 pl-9 text-sm"
          />
        </div>
        <span className="os-num shrink-0 text-[11px] text-muted-foreground">
          {q.length < 2
            ? 'two characters minimum'
            : search.loading && !search.data
              ? 'searching…'
              : countLabel(total, 'match', 'matches')}
        </span>
      </FilterBar>

      {q.length < 2 ? (
        <EmptyBlock
          title="Start typing"
          description="The API ranks exact matches first, then prefixes, then substrings. Shorter queries return nothing on purpose."
          icon={<SearchIcon className="size-5" />}
          className="border-dashed"
        />
      ) : search.error ? (
        <ErrorBlock error={search.error} onRetry={search.reload} />
      ) : search.loading && !search.data ? (
        <LoadingBlock rows={5} label="Searching…" />
      ) : !groups.length ? (
        <EmptyBlock
          title={`Nothing matches “${q}”`}
          description="Try a shorter word, or search by a project or person's name instead."
          icon={<SearchIcon className="size-5" />}
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Panel
              key={group.type}
              dense
              icon={<SearchIcon />}
              title={group.label}
              description={countLabel(group.items.length, 'result', 'results')}
              action={
                <Link
                  href={osHref(group.href)}
                  className="inline-flex h-7 items-center gap-1 rounded-os px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Open in app <ArrowRight className="size-3.5" />
                </Link>
              }
            >
              <ul className="divide-y divide-line">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={osHref(item.href)}
                      className="flex min-w-0 items-center gap-2.5 py-2 transition-colors hover:bg-canvas-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{item.title}</span>
                        {item.subtitle ? (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.badge ? (
                        <Badge tone="outline" size="sm">
                          {item.badge}
                        </Badge>
                      ) : null}
                      <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
          <p className="text-[11px] text-faint">
            {plural(groups.length, 'group')} shown · press{' '}
            <kbd className="os-mono rounded border border-line px-1">⌘K</kbd> anywhere for the same
            results in a palette.
          </p>
        </div>
      )}
    </div>
  )
}
