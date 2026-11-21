'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/os/cn'
import { errorMessage, type OsApiError } from '@/lib/os/client'
import { GridField } from './marks'
import { Button } from './ui/button'

/**
 * The four states every MyOS screen must render. Pages compose these instead of
 * hand-rolling spinners, so an unreachable backend always looks the same.
 *
 * The language here is strict (docs/DESIGN.md §4): skeletons are flat hairline
 * bars, an empty state is a bounded grid field plus one display sentence and a
 * monospace hint, and an error is a hairline panel with danger text — never a
 * coloured fill or an icon in a circle.
 */

/* ------------------------------------------------------------- skeletons --- */

/** Flat hairline bars — the only loading ornament this design allows. */
export function SkeletonLines({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('min-w-0 space-y-2.5', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-2 shrink-0 rounded-full border border-line" />
          <span className="h-[2px] min-w-0 flex-1 bg-line-faint" />
          <span className="hidden h-[2px] w-16 shrink-0 bg-line-faint sm:block" />
        </div>
      ))}
    </div>
  )
}

export function LoadingBlock({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="min-w-0 space-y-3">
      <p className="os-micro">{label ?? 'Loading…'}</p>
      <SkeletonLines rows={rows} />
    </div>
  )
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="os-panel min-w-0 space-y-3 p-4">
          <span className="block h-[2px] w-1/3 bg-line-faint" />
          <SkeletonLines rows={2} />
        </div>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- error --- */

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
    <div role="alert" className={cn('os-panel min-w-0 px-4 py-3.5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="os-label">{down ? 'Unreachable' : 'Error'}</p>
          <p className="mt-1 text-[13px] text-danger">
            {title ?? (down ? 'MyOS API is not reachable' : 'This could not be loaded')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {down
              ? 'Start the backend (`uvicorn app.main:app --port 8000`) or set MYOS_API_URL, then retry.'
              : errorMessage(error)}
          </p>
          {err?.details?.length ? (
            <ul className="os-mono mt-2 space-y-0.5 text-[11px] text-danger">
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
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="shrink-0 bg-transparent"
          >
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- empty --- */

export function EmptyBlock({
  title,
  description,
  icon,
  action,
  className,
  gridHeight = 64,
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  /** height of the bounded hairline field above the sentence */
  gridHeight?: number
}) {
  return (
    <div className={cn('os-panel min-w-0 overflow-hidden', className)}>
      <GridField height={gridHeight} className="border-b border-line-faint" />
      <div className="px-5 pb-5 pt-4 text-center">
        {icon ? (
          <span aria-hidden className="mb-2 inline-flex text-faint [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <p className="os-title mx-auto max-w-prose">{title}</p>
        {description ? <p className="os-micro mt-2">{description}</p> : null}
        {action ? (
          <span className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</span>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ dispatcher --- */

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
    <p role="alert" className="os-mono text-[11px] text-danger">
      {errorMessage(error)}
    </p>
  )
}
