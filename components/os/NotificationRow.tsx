'use client'

import Link from 'next/link'
import { Check, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate } from '@/lib/os/hooks'
import { enumLabel, osHref, relativeTime } from '@/lib/os/format'
import type { Notification } from '@/lib/os/types'
import { Badge, SEVERITY_TONE, SeverityDot, toneFor } from './ui/badge'
import { IconButton } from './ui/button'
import { toastError } from './ui/toast'

const SCOPE = ['/notifications', '/dashboard', '/meta', '/activity']

/**
 * Notification line used by the top bar digest, the dashboard widget and
 * /os/notifications. Marking read is a PATCH; deleting is a DELETE.
 */
export function NotificationRow({
  notification,
  showActions = true,
  onSelect,
}: {
  notification: Notification
  showActions?: boolean
  onSelect?: (notification: Notification) => void
}) {
  const [busy, setBusy] = useState(false)

  async function patch(read: boolean) {
    setBusy(true)
    try {
      await api<Notification>(`/notifications/${notification.id}`, { method: 'PATCH', body: { read } })
      invalidate(...SCOPE)
      onSelect?.(notification)
    } catch (e) {
      toastError(errorMessage(e, 'Could not update the notification'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api(`/notifications/${notification.id}`, { method: 'DELETE' })
      invalidate(...SCOPE)
    } catch (e) {
      toastError(errorMessage(e, 'Could not dismiss the notification'))
    } finally {
      setBusy(false)
    }
  }

  // API hrefs are normalised so the whole app keeps one link scheme.
  const linkHref = osHref(notification.href)

  const body = (
    <>
      <span className="mt-1 flex size-2 shrink-0 items-center">
        {notification.read ? (
          <span aria-hidden className="size-2 rounded-full border border-line" />
        ) : (
          <SeverityDot severity={notification.severity} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[12.5px]',
            notification.read ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {notification.title}
        </span>
        {notification.body ? (
          <span className="mt-0.5 block truncate text-[11px] text-faint">{notification.body}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
        <Badge tone={toneFor(SEVERITY_TONE, notification.severity)} size="sm">
          {enumLabel(notification.kind)}
        </Badge>
        <span className="os-mono hidden sm:inline">{relativeTime(notification.created_at)}</span>
      </span>
    </>
  )

  return (
    <div
      className={cn(
        'group flex min-w-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
        notification.read ? 'border-line bg-transparent' : 'border-line bg-muted/40 hover:bg-muted/70',
        busy && 'opacity-60'
      )}
    >
      {linkHref ? (
        <Link
          href={linkHref}
          className="flex min-w-0 flex-1 items-start gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (!notification.read) void patch(true)
          }}
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2.5">{body}</span>
      )}

      {showActions ? (
        <span className="flex shrink-0 items-center">
          {notification.read ? (
            <IconButton
              label="Mark unread"
              size="icon-sm"
              disabled={busy}
              onClick={() => void patch(false)}
            >
              <Undo2 className="size-3.5" />
            </IconButton>
          ) : (
            <IconButton
              label="Mark read"
              size="icon-sm"
              disabled={busy}
              onClick={() => void patch(true)}
            >
              <Check className="size-3.5" />
            </IconButton>
          )}
          <IconButton label="Dismiss" size="icon-sm" disabled={busy} onClick={() => void remove()}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </span>
      ) : null}
    </div>
  )
}
