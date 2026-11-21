'use client'

import { Check, Clock, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { useResource, invalidate } from '@/lib/os/hooks'
import { formatDateTime, relativeFuture } from '@/lib/os/format'
import type { ListResponse, Reminder } from '@/lib/os/types'
import { StatusDot } from './marks'
import { SkeletonLines } from './states'
import { Button, IconButton } from './ui/button'
import { toastError, toastSuccess } from './ui/toast'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ReminderDialog } from './dialogs/ReminderDialog'

const REMINDER_SCOPE = ['/reminders', '/notifications', '/dashboard', '/meta', '/activity']

/**
 * Reminders panel: list, create, complete, snooze 60 minutes and delete — all
 * through the documented `/reminders` endpoints. Rows are hairline-separated;
 * hue appears only on the leading disc of an overdue reminder.
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
    return <SkeletonLines rows={3} />
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
        <p className="os-label">{title}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null)
            setDialog(true)
          }}
          className="rounded-os bg-transparent text-[11px]"
        >
          New
        </Button>
      </div>

      {!items.length ? (
        <p className="os-micro py-3">
          No pending reminders. They turn into notifications on the next refresh.
        </p>
      ) : (
        <ul className="min-w-0">
          {items.map((reminder) => {
            const late = reminder.due_at ? new Date(reminder.due_at).getTime() < Date.now() : false
            const busy = busyId === reminder.id
            return (
              <li
                key={reminder.id}
                className={cn(
                  'group flex min-w-0 items-center gap-2.5 border-b border-line-faint px-2 py-1.5',
                  busy && 'opacity-60'
                )}
              >
                <StatusDot tone={late ? 'critical' : undefined} title="Pending reminder" />
                <button
                  type="button"
                  aria-label={`Complete ${reminder.title}`}
                  title="Mark done"
                  disabled={busy}
                  onClick={() => void action(reminder.id, '/complete')}
                  className="os-tap-none grid size-4 shrink-0 place-items-center rounded-full border border-line-strong text-transparent transition-colors hover:border-line-strong hover:text-muted-foreground"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </button>
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                  {reminder.title}
                </p>
                <span className="os-mono shrink-0 text-right text-[11px] text-muted-foreground">
                  {formatDateTime(reminder.due_at)}
                </span>
                <span className="os-micro hidden w-24 shrink-0 text-right sm:inline">
                  {relativeFuture(reminder.due_at)}
                </span>
                {reminder.snoozed_until ? (
                  <span className="os-label os-label-faint hidden shrink-0 sm:inline">snoozed</span>
                ) : null}
                {reminder.entity_type ? (
                  <span className="os-label os-label-faint hidden shrink-0 lg:inline">
                    {reminder.entity_type}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
                    dense && 'opacity-100'
                  )}
                >
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
        <p role="alert" className="os-mono text-[11px] text-danger">
          {errorMessage(reminders.error)}
        </p>
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
