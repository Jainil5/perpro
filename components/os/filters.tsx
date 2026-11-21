'use client'

import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { enumLabel } from '@/lib/os/format'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from './ui/select'

/** Pill toggle used by every list screen's filter row. */
export function FilterChip({
  active,
  onClick,
  children,
  count,
  tone = 'primary',
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  count?: number
  tone?: 'primary' | 'danger' | 'warning'
}) {
  const activeTone =
    tone === 'danger'
      ? 'border-destructive/40 bg-destructive/12 text-destructive'
      : tone === 'warning'
        ? 'border-warning/40 bg-warning/12 text-warning'
        : 'border-primary/40 bg-primary/12 text-primary'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? activeTone
          : 'border-line bg-card text-muted-foreground hover:border-line-strong hover:text-foreground'
      )}
    >
      {children}
      {count != null ? <span className={cn('os-num text-faint')}>{count}</span> : null}
    </button>
  )
}

/** Toolbar wrapper: wraps on mobile, keeps a single line on desktop. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card/60 px-2.5 py-2',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Compact search box that is part of a filter row. */
export function InlineSearch({
  value,
  onChange,
  placeholder = 'Search this list…',
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative flex min-w-0 flex-1 items-center', className)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="os-tap-none h-8 w-full min-w-0 rounded-lg border border-line bg-input pl-8 pr-7 text-xs text-foreground outline-none transition-colors placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="os-tap-none absolute right-1.5 grid size-5 place-items-center rounded text-faint hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

/** Sort picker over the API's `sort` values. */
export function SortSelect({
  value,
  onChange,
  options,
  label = 'Sort',
}: {
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  label?: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <ArrowUp className="size-3.5 text-faint" aria-hidden />
      <span className="sr-only">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-[7.5rem]" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <Option key={option} value={option}>
              {enumLabel(option)}
            </Option>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** List / board / table switch used by Tasks and Project detail. */
export function ViewToggle({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (next: string) => void
  options: { value: string; label: string; icon: ReactNode }[]
}) {
  return (
    <div role="tablist" aria-label="View" className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-muted/60 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          title={option.label}
          className={cn(
            'os-tap-none inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors',
            value === option.value
              ? 'bg-card text-foreground shadow-os'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="[&_svg]:size-3.5">{option.icon}</span>
          <span className="hidden sm:inline">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

/** `limit`/`offset` pager for the API-paginated lists. */
export function LoadMore({
  loaded,
  total,
  loading,
  onMore,
  onReset,
  size = 50,
}: {
  loaded: number
  total: number
  loading?: boolean
  onMore: () => void
  onReset?: () => void
  size?: number
}) {
  const remaining = Math.max(0, total - loaded)
  if (total <= 0) return null
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
      <span className="os-num">
        {Math.min(loaded, total)} of {total}
        {remaining > 0 ? ` · ${remaining} more` : ' · all loaded'}
      </span>
      {remaining > 0 ? (
        <button
          type="button"
          onClick={onMore}
          disabled={loading}
          className="os-tap-none inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
        >
          <ArrowDown className="size-3.5" />
          Load {Math.min(size, remaining)} more
        </button>
      ) : null}
      {loaded > size && onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="os-tap-none inline-flex h-7 items-center rounded-lg px-2 text-xs text-faint transition-colors hover:bg-accent hover:text-foreground"
        >
          Back to top
        </button>
      ) : null}
    </div>
  )
}
