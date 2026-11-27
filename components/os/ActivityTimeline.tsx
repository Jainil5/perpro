'use client'

import Link from 'next/link'
import {
  ArrowRightLeft,
  CircleDot,
  Eye,
  Move,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { dayHeading, dayKey, formatTime, osHref, relativeTime } from '@/lib/os/format'
import type { ActivityLog } from '@/lib/os/types'

/** Verb glyphs stay 1px-stroke and inline — no circles, no fills. */
const VERB_ICON: Record<string, ReactNode> = {
  created: <Plus className="size-3" />,
  updated: <Pencil className="size-3" />,
  completed: <CircleDot className="size-3" />,
  reopened: <RotateCcw className="size-3" />,
  deleted: <Trash2 className="size-3" />,
  commented: <MessageSquare className="size-3" />,
  moved: <Move className="size-3" />,
  // Phase 2 · a funnel hop is not an edit, and a win is not a funnel hop
  transitioned: <ArrowRightLeft className="size-3" />,
  promoted: <ShieldCheck className="size-3" />,
}

const LINK_CLASS =
  'text-foreground underline decoration-line-strong underline-offset-2 hover:decoration-foreground'

/**
 * Activity feed grouped by calendar day — /activity and project detail.
 * Structure per DESIGN rule 8: a fixed mono time gutter, a hairline spine,
 * the entry, and the record kind as a micro-label.
 */
export function ActivityTimeline({
  items,
  emptyLabel = 'No activity recorded yet.',
}: {
  items: ActivityLog[]
  emptyLabel?: string
}) {
  if (!items.length) return <p className="os-micro px-1 py-4">{emptyLabel}</p>

  const sections: { key: string; items: ActivityLog[] }[] = []
  for (const item of items) {
    const key = dayKey(item.created_at)
    const last = sections[sections.length - 1]
    if (last && last.key === key) last.items.push(item)
    else sections.push({ key, items: [item] })
  }

  return (
    <div className="min-w-0 space-y-5">
      {sections.map((section) => (
        <section key={section.key} className="min-w-0">
          <div className="mb-1 flex items-center gap-3">
            <h3 className="os-label">{dayHeading(section.key)}</h3>
            <span className="os-mono text-[10px] text-faint">{section.items.length}</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
          <ol className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)]">
            {section.items.map((item) => {
              const href = osHref(item.href)
              return (
                <li key={item.id} className="contents">
                  <span className="os-mono py-1.5 pr-2 text-right text-[11px] leading-5 text-faint">
                    {formatTime(item.created_at)}
                  </span>
                  <div className="min-w-0 border-l border-line py-1.5 pl-3">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span aria-hidden className="self-center text-faint">
                        {VERB_ICON[item.verb] ?? <Eye className="size-3" />}
                      </span>
                      {href ? (
                        <Link href={href} className={cn('min-w-0 flex-1 truncate text-[12.5px]', LINK_CLASS)}>
                          {item.summary || item.entity_title || item.verb}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                          {item.summary || item.entity_title || item.verb}
                        </span>
                      )}
                      <span className="os-label os-label-faint shrink-0">{item.entity_type}</span>
                      <span className="os-micro hidden shrink-0 sm:inline">
                        {relativeTime(item.created_at)}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

/** The same data as a tight table, for panels with little room. */
export function ActivityRows({ items }: { items: ActivityLog[] }) {
  if (!items.length) return <p className="os-micro px-1 py-3">Nothing has changed recently.</p>
  return (
    <ul className="min-w-0">
      {items.map((item) => {
        const href = osHref(item.href)
        return (
          <li
            key={item.id}
            className="flex min-w-0 items-baseline gap-2 border-b border-line-faint px-1 py-1.5 last:border-b-0"
          >
            <Link
              href={href ?? '#'}
              scroll={Boolean(href)}
              className={cn(
                'min-w-0 flex-1 truncate text-[12.5px]',
                href ? LINK_CLASS : 'pointer-events-none text-muted-foreground'
              )}
            >
              {item.summary}
            </Link>
            <span className="os-mono shrink-0 text-right text-[11px] text-faint">
              {relativeTime(item.created_at)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
