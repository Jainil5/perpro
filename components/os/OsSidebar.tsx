'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ExternalLink } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { useWorkspace } from '@/lib/os/hooks'
import {
  OS_NAV_FOOTER,
  OS_NAV_GROUPS,
  isNavItemActive,
  roadmapHref,
  type OsNavItem,
} from '@/lib/os/nav'
import { Badge } from './ui/badge'
import { Hint } from './ui/tooltip'

/**
 * Compact module rail. Phase 1 modules link to their screens; everything else
 * is deliberately muted and points at the roadmap anchor for its phase, so an
 * unbuilt module never looks like a working feature.
 */
export default function OsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const workspace = useWorkspace()

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex shrink-0 items-center gap-2.5 px-4 py-4">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-os-display text-[13px] font-bold text-primary-foreground shadow-os"
        >
          M
        </span>
        <span className="min-w-0">
          <span className="block font-os-display text-[13px] font-semibold leading-tight tracking-tight">
            {workspace.data?.name ?? 'MyOS'}
          </span>
          <span className="block text-[11px] leading-tight text-faint">
            {workspace.loading ? 'connecting…' : `workspace · ${workspace.data?.slug ?? 'default'}`}
          </span>
        </span>
      </div>

      <nav aria-label="MyOS modules" className="os-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {OS_NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-3 last:mb-0">
            <p className="os-eyebrow px-2 pb-1 pt-2">{group.title}</p>
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.label}>
                  <SidebarLink item={item} pathname={pathname} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line px-2.5 py-2.5">
        <ul className="space-y-px">
          {OS_NAV_FOOTER.map((item) => (
            <li key={item.label}>
              <SidebarLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <p className="px-2 pt-2 text-[10px] leading-relaxed text-faint">
          Phase 1 · data lives in a local SQLite file
        </p>
      </div>
    </div>
  )
}

function SidebarLink({
  item,
  pathname,
  onNavigate,
}: {
  item: OsNavItem
  pathname: string
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const base =
    'group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  if (item.href) {
    const active = isNavItemActive(item.href, pathname)
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          base,
          active
            ? 'bg-primary/12 font-medium text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {active ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
      </Link>
    )
  }

  const href = roadmapHref(item.anchor ?? 'phases')
  return (
    <Hint label={item.hint ?? 'Planned for a later phase'} side="right">
      <Link
        href={href}
        scroll
        onClick={onNavigate}
        aria-label={`${item.label} — not built yet, opens the roadmap`}
        className={cn(base, 'text-faint hover:bg-accent hover:text-muted-foreground')}
      >
        <Icon className="size-4 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <Badge tone="outline" size="sm" className="gap-1 font-os-mono">
          Phase {item.phase}
          <ExternalLink className="size-2.5 opacity-70" />
        </Badge>
      </Link>
    </Hint>
  )
}
