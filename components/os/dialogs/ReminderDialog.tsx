'use client'

import { useEffect, useState } from 'react'

import { generalError, toIsoFromDateTimeLocal, dateTimeInputValue, useObjectForm } from '@/lib/os/forms'
import { useCreate, useUpdate } from '@/lib/os/hooks'
import type { Reminder, ReminderInput } from '@/lib/os/types'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog'
import { Field } from '../ui/label'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '../ui/select'

export const REMINDER_SCOPE = ['/reminders', '/notifications', '/dashboard', '/meta', '/activity']

const ENTITY_OPTIONS = [
  { value: '__none', label: 'Nothing — a standalone reminder' },
  { value: 'task', label: 'A task' },
  { value: 'project', label: 'A project' },
  { value: 'milestone', label: 'A milestone' },
  { value: 'note', label: 'A note' },
]

interface ReminderForm {
  title: string
  due_at: string
  entity_type: string
  entity_id: string
  notes: string
}

/**
 * Create/edit reminder. `entity_id` is not enforced by the API, so the id field
 * is only shown when a type is chosen; the reminders panel links to it.
 */
export function ReminderDialog({
  open,
  onOpenChange,
  reminder,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reminder?: Reminder | null
  onSaved?: (reminder: Reminder, created: boolean) => void
}) {
  const editing = Boolean(reminder?.id)
  const { values, patch, reset, setDirty } = useObjectForm<ReminderForm>({
    title: '',
    due_at: '',
    entity_type: '__none',
    entity_id: '',
    notes: '',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Reminder, ReminderInput>('/reminders', { invalidates: REMINDER_SCOPE })
  const update = useUpdate<Reminder, ReminderInput>(() => `/reminders/${reminder?.id}`, {
    invalidates: REMINDER_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset({
      title: reminder?.title ?? '',
      due_at: dateTimeInputValue(reminder?.due_at ?? defaultDueAt()),
      entity_type: reminder?.entity_type ?? '__none',
      entity_id: reminder?.entity_id ?? '',
      notes: reminder?.notes ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reminder?.id])

  async function submit() {
    if (!values.title.trim()) {
      setLocalError('A reminder needs a title')
      return
    }
    setLocalError(null)
    const payload: ReminderInput = {
      title: values.title.trim(),
      due_at: toIsoFromDateTimeLocal(values.due_at),
      entity_type: values.entity_type === '__none' ? null : values.entity_type,
      entity_id: values.entity_type === '__none' ? null : values.entity_id.trim() || null,
      notes: values.notes.trim() || null,
    }
    try {
      const saved = editing ? await update.mutate(payload) : await create.mutate(payload)
      setDirty(false)
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch {
      /* shown below */
    }
  }

  const banner = localError ?? generalError(error, ['title', 'due_at'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? 'Edit reminder' : 'New reminder'}
          description="Reminders become notifications on the next refresh; times are stored in UTC."
        />
        <DialogBody className="space-y-4">
          {banner ? (
            <p
              role="alert"
              className="rounded-os border border-line px-3 py-2 text-xs text-danger"
            >
              {banner}
            </p>
          ) : null}
          <Field label="Title" htmlFor="reminder-title" required>
            <Input
              id="reminder-title"
              autoFocus
              value={values.title}
              placeholder="Chase invoice"
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label="Remind me at" htmlFor="reminder-due" required>
            <Input
              id="reminder-due"
              type="datetime-local"
              value={values.due_at}
              onChange={(event) => patch({ due_at: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Linked record" hint="optional">
              <Select
                value={values.entity_type}
                onValueChange={(entity_type) => patch({ entity_type })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map((option) => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {values.entity_type !== '__none' ? (
              <Field label="Record id" htmlFor="reminder-entity-id" hint="paste from the record URL">
                <Input
                  id="reminder-entity-id"
                  value={values.entity_id}
                  spellCheck={false}
                  className="os-mono text-xs"
                  onChange={(event) => patch({ entity_id: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
          <Field label="Notes" htmlFor="reminder-notes">
            <Textarea
              id="reminder-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-os border border-line bg-transparent hover:bg-transparent"
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} className="rounded-os">
            {editing ? 'Save reminder' : 'Create reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Tomorrow, 09:00 local — a sane starting point for a new reminder. */
function defaultDueAt(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
