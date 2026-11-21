'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw, ServerCrash } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { errorMessage, type OsApiError } from '@/lib/os/client'
import { Button } from './ui/button'
import { Empty, EmptyAction, EmptyDescription, EmptyMedia, EmptyTitle } from './ui/empty'
import { SkeletonCard, SkeletonRows } from './ui/skeleton'

/**
 * The four states every MyOS screen must render. Pages compose these instead of
 * hand-rolling spinners, so an unreachable backend always looks the same.
 */

export function LoadingBlock({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <p className="text-xs text-muted-foreground">{label ?? 'Loading…'}</p>
      <SkeletonRows rows={rows} />
    </div>
  )
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

export function ErrorBlock({
  error,
  onRetry,
  title,
  className,
}: {
  error: OsApiError | unknown
  onRetry?: () => void
  title?: string
  className?: string
}) {
  const err = error as OsApiError
  const down = err?.isUpstreamDown === true
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border px-4 py-3.5',
        down ? 'border-warning/40 bg-warning/10' : 'border-destructive/40 bg-destructive/10',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 shrink-0', down ? 'text-warning' : 'text-destructive')}>
          {down ? <ServerCrash className="size-4" /> : <AlertTriangle className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[13px] font-semibold', down ? 'text-warning' : 'text-destructive')}>
            {title ?? (down ? 'MyOS API is not reachable' : 'This could not be loaded')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {down
              ? 'Start the backend (`uvicorn app.main:app --port 8000`) or set MYOS_API_URL, then retry.'
              : errorMessage(error)}
          </p>
          {err?.details?.length ? (
            <ul className="os-mono mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {err.details.map((d, i) => (
                <li key={`${d.field}-${i}`}>
                  {d.field ? `${d.field}: ` : ''}
                  {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
            <RefreshCw /> Retry
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function EmptyBlock({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={className}>
      {icon ? <EmptyMedia>{icon}</EmptyMedia> : null}
      <EmptyTitle>{title}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      {action ? <EmptyAction>{action}</EmptyAction> : null}
    </Empty>
  )
}

/**
 * Chooses between the four states for a `useResource` result. `children` only
 * receives data that exists, so screens never re-check for null.
 */
export function ResourceState<T>({
  resource,
  skeleton,
  empty,
  children,
}: {
  resource: { data: T | undefined; error: OsApiError | null; loading: boolean; reload: () => void }
  skeleton?: ReactNode
  empty?: ReactNode
  children: (data: T) => ReactNode
}) {
  if (resource.error && resource.data === undefined)
    return <ErrorBlock error={resource.error} onRetry={resource.reload} />
  if (resource.loading && resource.data === undefined)
    return <>{skeleton ?? <LoadingBlock />}</>
  if (resource.data === undefined)
    return <>{empty ?? <EmptyBlock title="Nothing here yet" />}</>
  return <>{children(resource.data)}</>
}

/** Inline "something went wrong" strip that keeps existing data on screen. */
export function SoftError({ error }: { error: OsApiError | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {errorMessage(error)}
    </p>
  )
}
