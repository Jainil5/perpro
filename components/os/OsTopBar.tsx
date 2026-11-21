'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Menu, Plus, Search, X } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { isNavItemActive, OS_NAV_FOOTER, OS_NAV_GROUPS } from '@/lib/os/nav'
import { useHealth, useResource } from '@/lib/os/hooks'
import type { NotificationsResponse } from '@/lib/os/types'
import { Button, IconButton } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { VDivider } from './ui/separator'
import ThemeToggle from './ThemeToggle'
import { useQuickCreate, type QuickKind } from './QuickCreate'

const QUICK_ITEMS: { kind: QuickKind; label: string }[] = [
  { kind: 'task', label: 'New task' },
  { kind: 'project', label: 'New project' },
  { kind: 'note', label: 'New note' },
  { kind: 'contact', label: 'New contact' },
  { kind: 'reminder', label: 'New reminder' },
]

export default function OsTopBar({
  onToggleNav,
  onOpenPalette,
  navOpen,
}: {
  onToggleNav: () => void
  onOpenPalette: () => void
  navOpen: boolean
}) {
  const pathname = usePathname()
  const health = useHealth()
  const unread = useResource<NotificationsResponse>('/notifications', { unread: true, limit: 1 })
  const quick = useQuickCreate()

  const current = [...OS_NAV_GROUPS.flatMap((g) => g.items), ...OS_NAV_FOOTER].find(
    (item) => item.href && isNavItemActive(item.href, pathname)
  )
  const title = current?.label ?? 'MyOS'
  const group = OS_NAV_GROUPS.find((g) => g.items.some((i) => i.href && isNavItemActive(i.href, pathname)))
  const count = unread.data?.unread ?? 0
  const up = health.data?.status === 'ok'

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-background/85 px-3 backdrop-blur-md md:px-5">
      <IconButton
        label={navOpen ? 'Close navigation' : 'Open navigation'}
        onClick={onToggleNav}
        className="text-muted-foreground md:hidden"
        aria-expanded={navOpen}
      >
        {navOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </IconButton>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h1 className="truncate font-os-display text-[15px] font-semibold tracking-tight">{title}</h1>
          {group && group.title !== 'Personal' ? (
            <span className="os-eyebrow hidden md:inline">{group.title}</span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-line bg-input px-2.5 text-[13px] text-faint transition-colors hover:border-line-strong hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex lg:w-72"
        aria-label="Search MyOS"
      >
        <Search className="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-left">Search…</span>
        <kbd className="os-mono rounded border border-line px-1 text-[10px] tracking-normal">⌘K</kbd>
      </button>

      <IconButton label="Search MyOS" onClick={onOpenPalette} className="text-muted-foreground sm:hidden">
        <Search className="size-4" />
      </IconButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2 lg:px-2.5">
            <Plus className="size-3.5" />
            <span className="hidden lg:inline">Create</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Quick create</DropdownMenuLabel>
          {QUICK_ITEMS.map((item) => (
            <DropdownMenuItem key={item.kind} onSelect={() => quick.open(item.kind)}>
              {item.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => quick.open('import')}>Import tasks from JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <VDivider />

      <Link
        href="/os/notifications"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className={cn(
          'relative inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          count === 0 && 'text-faint'
        )}
      >
        <Bell className="size-4" />
        {count > 0 ? (
          <span className="os-mono absolute right-0.5 top-0.5 grid min-w-3.5 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-4 text-destructive-foreground">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>

      <ThemeToggle />

      <Link
        href="/os/settings"
        title={
          up
            ? `API ok · v${health.data?.version ?? '?'} · ${health.data?.database ?? 'sqlite'}`
            : health.loading
              ? 'Checking the MyOS API…'
              : 'MyOS API is unreachable'
        }
        className="hidden items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            health.loading ? 'bg-faint' : up ? 'bg-success' : 'bg-destructive'
          )}
        />
        <span className="os-mono tracking-normal">
          {health.loading ? 'api…' : up ? `api v${health.data?.version}` : 'api down'}
        </span>
      </Link>
    </header>
  )
}
