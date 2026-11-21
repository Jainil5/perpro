'use client'

import { Check, Clock, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { useResource, invalidate } from '@/lib/os/hooks'
import { formatDateTime, relativeFuture } from '@/lib/os/format'
import type { ListResponse, Reminder } from '@/lib/os/types'
import { Button, IconButton } from './ui/button'
import { Badge } from './ui/badge'
import { SkeletonRows } from './ui/skeleton'
import { toastError, toastSuccess } from './ui/toast'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ReminderDialog } from './dialogs/ReminderDialog'

const REMINDER_SCOPE = ['/reminders', '/notifications', '/dashboard', '/meta', '/activity']

/**
 * Reminders panel: list, create, complete, snooze 60 minutes and delete — all
 * through the documented `/reminders` endpoints.
 */
export function ReminderPanel({
  limit,
  title = 'Reminders',
  dense,
}: {
  /** Restricts how many are shown (dashboard); the page shows all pending. */
  limit?: number
  title?: string
  dense?: boolean
}) {
  const reminders = useResource<ListResponse<Reminder>>('/reminders', { status: 'pending', limit: limit ?? 50 })
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [dialog, setDialog] = useState(false)
  const [deleting, setDeleting] = useState<Reminder | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const items = useMemo(() => {
    const list = [...(reminders.data?.items ?? [])]
    list.sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))
    return limit ? list.slice(0, limit) : list
  }, [limit, reminders.data])

  async function action(id: string, path: string, body?: unknown) {
    setBusyId(id)
    try {
      await api(`/reminders/${id}${path}`, { method: 'POST', body })
      invalidate(...REMINDER_SCOPE)
      return true
    } catch (e) {
      toastError(errorMessage(e, 'Could not update the reminder'))
      return false
    } finally {
      setBusyId(null)
    }
  }

  if (reminders.loading && !reminders.data) {
    return <SkeletonRows rows={3} />
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="os-eyebrow">{title}</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(null)
            setDialog(true)
          }}
        >
          New
        </Button>
      </div>

      {!items.length ? (
        <p className={cn('text-xs text-muted-foreground', dense ? '' : 'rounded-lg border border-dashed border-line px-3 py-4 text-center')}>
          No pending reminders. They turn into notifications on the next refresh.
        </p>
      ) : (
        <ul className="min-w-0 space-y-px">
          {items.map((reminder) => {
            const late = reminder.due_at ? new Date(reminder.due_at).getTime() < Date.now() : false
            const busy = busyId === reminder.id
            return (
              <li
                key={reminder.id}
                className="group flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  aria-label={`Complete ${reminder.title}`}
                  title="Mark done"
                  disabled={busy}
                  onClick={() => void action(reminder.id, '/complete')}
                  className="os-tap-none mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line-strong text-transparent transition-colors hover:border-success hover:text-success/60"
                >
                  <Check className="size-3" strokeWidth={3} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 truncate text-[12.5px] text-foreground">{reminder.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                    <span className={cn('os-num', late ? 'text-destructive' : 'text-muted-foreground')}>
                      {formatDateTime(reminder.due_at)}
                    </span>
                    <span className={cn(late ? 'text-destructive' : 'text-faint')}>
                      {relativeFuture(reminder.due_at)}
                    </span>
                    {reminder.snoozed_until ? (
                      <Badge tone="warning" size="sm">
                        snoozed
                      </Badge>
                    ) : null}
                    {reminder.entity_type ? (
                      <span className="text-faint">· {reminder.entity_type}</span>
                    ) : null}
                  </p>
                </div>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <IconButton
                    label="Snooze 60 minutes"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => void action(reminder.id, '/snooze', { minutes: 60 })}
                  >
                    <Clock className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Edit ${reminder.title}`}
                    size="icon-sm"
                    onClick={() => {
                      setEditing(reminder)
                      setDialog(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${reminder.title}`}
                    size="icon-sm"
                    onClick={() => setDeleting(reminder)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {reminders.error && !reminders.data ? (
        <p className="text-[11px] text-destructive">{errorMessage(reminders.error)}</p>
      ) : null}

      <ReminderDialog
        open={dialog}
        onOpenChange={setDialog}
        reminder={editing}
        onSaved={(_, created) => toastSuccess(created ? 'Reminder created' : 'Reminder saved')}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title="Delete reminder"
        description={deleting ? `“${deleting.title}” will be removed for good.` : undefined}
        onConfirm={() =>
          api(`/reminders/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            invalidate(...REMINDER_SCOPE)
            toastSuccess('Reminder deleted')
          })
        }
      />
    </div>
  )
}
