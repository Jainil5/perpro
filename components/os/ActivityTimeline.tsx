'use client'

import Link from 'next/link'
import {
  CircleDot,
  Eye,
  Move,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { dayHeading, dayKey, formatTime, osHref, relativeTime } from '@/lib/os/format'
import type { ActivityLog } from '@/lib/os/types'
import { Badge } from './ui/badge'

const VERB_ICON: Record<string, ReactNode> = {
  created: <Plus className="size-3" />,
  updated: <Pencil className="size-3" />,
  completed: <CircleDot className="size-3" />,
  reopened: <RotateCcw className="size-3" />,
  deleted: <Trash2 className="size-3" />,
  commented: <MessageSquare className="size-3" />,
  moved: <Move className="size-3" />,
}

/** Activity feed grouped by calendar day — /os/activity and project detail. */
export function ActivityTimeline({
  items,
  emptyLabel = 'No activity recorded yet.',
}: {
  items: ActivityLog[]
  emptyLabel?: string
}) {
  if (!items.length) return <p className="px-1 py-4 text-xs text-muted-foreground">{emptyLabel}</p>

  const sections: { key: string; items: ActivityLog[] }[] = []
  for (const item of items) {
    const key = dayKey(item.created_at)
    const last = sections[sections.length - 1]
    if (last && last.key === key) last.items.push(item)
    else sections.push({ key, items: [item] })
  }

  return (
    <div className="min-w-0 space-y-4">
      {sections.map((section) => (
        <section key={section.key} className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="os-eyebrow">{dayHeading(section.key)}</h3>
            <span className="os-num text-[10px] text-faint">{section.items.length}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ol className="relative min-w-0 space-y-1 pl-4">
            <span aria-hidden className="absolute inset-y-1 left-[5px] w-px bg-line" />
            {section.items.map((item) => {
              const href = osHref(item.href)
              return (
                <li key={item.id} className="relative min-w-0">
                  <span
                    aria-hidden
                    className="absolute left-[-11px] top-2.5 grid size-3 place-items-center rounded-full border border-line bg-card"
                  >
                    <span className="text-faint [&_svg]:size-2">
                      {VERB_ICON[item.verb] ?? <Eye className="size-2" />}
                    </span>
                  </span>
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50">
                    {osHref(item.href) ? (
                      <Link
                        href={osHref(item.href) as string}
                        className="min-w-0 flex-1 truncate text-[12.5px] underline-offset-2 hover:text-primary hover:underline"
                      >
                        {item.summary || item.entity_title || item.verb}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {item.summary || item.entity_title || item.verb}
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
                      <Badge tone="outline" size="sm">
                        {item.entity_type}
                      </Badge>
                      <span className="os-mono">{formatTime(item.created_at)}</span>
                      <span className="hidden sm:inline">{relativeTime(item.created_at)}</span>
                    </span>
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
  if (!items.length)
    return <p className="px-1 py-3 text-xs text-muted-foreground">Nothing has changed recently.</p>
  return (
    <ul className="min-w-0 space-y-px">
      {items.map((item) => {
        const href = osHref(item.href)
        return (
          <li key={item.id} className="min-w-0">
            <Link
              href={href ?? '#'}
              scroll={Boolean(href)}
              className={cn(
                'flex min-w-0 items-baseline gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-muted/50',
                !href && 'pointer-events-none text-muted-foreground'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{item.summary}</span>
              <span className="os-mono shrink-0 text-[11px] text-faint">
                {relativeTime(item.created_at)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
