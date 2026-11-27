'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useEnums } from '@/lib/os/hooks'
import { blankToNull, mergeFieldErrors, toIsoFromDateTimeLocal } from '@/lib/os/forms'
import { CRM_PATHS, CRM_SCOPE, meetingPath } from '@/lib/os/crm'
import type { Meeting, MeetingEntityType, MeetingInput, MeetingStatus } from '@/lib/os/crm'
import { enumLabel, formatDateTime, formatMinutes } from '@/lib/os/format'
import {
  DAY_CHIPS,
  DURATION_PRESETS,
  defaultSlot,
  durationMinutes,
  editEnd,
  editStart,
  formatLocalInput,
  pickDuration,
  shiftDay,
  slotSummary,
  type SlotState,
} from '@/lib/meeting-times'
import { Button, IconButton } from '@/components/os/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/os/ui/dialog'
import { Field } from '@/components/os/ui/label'
import { Input } from '@/components/os/ui/input'
import { Textarea } from '@/components/os/ui/textarea'
import { EnumSelect } from '@/components/os/pickers'
import { MicroData, StatusDot, type DotState } from '@/components/os/marks'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

/** Where the API's polymorphic meeting link lands. `/meetings` stays the Supabase screen. */
export const MEETING_HOME: Record<MeetingEntityType, string> = {
  task: '/tasks',
  note: '/notes',
  project: '/projects',
  milestone: '/projects',
  contact: '/contacts',
  company: '/contacts',
  goal: '/goals',
  job_application: '/career',
  lead: '/crm',
  client: '/customers',
}

/** The `?param` each owner screen opens a record with. */
export const MEETING_PARAM: Record<MeetingEntityType, string> = {
  task: 'task',
  note: 'note',
  project: 'project',
  milestone: 'project',
  contact: 'contact',
  company: 'company',
  goal: 'goal',
  job_application: 'app',
  lead: 'lead',
  client: 'client',
}

/** A meeting's deep link is its owner's link — an unowned meeting has no home to point at. */
export function meetingHref(
  entityType: MeetingEntityType | null | undefined,
  entityId: string | null | undefined
): string | null {
  if (!entityType || !entityId) return null
  const base = MEETING_HOME[entityType]
  const param = MEETING_PARAM[entityType]
  if (!base || !param) return null
  return `${base}?${param}=${entityId}`
}

export function meetingDot(status: MeetingStatus | string | null | undefined): DotState {
  switch (status) {
    case 'completed':
      return 'done'
    case 'cancelled':
      return 'abandoned'
    case 'no_show':
      return 'archived'
    default:
      return 'in_progress'
  }
}

/**
 * Schedule or edit one meeting attached to a record — a lead, an account.
 *
 * `ends_at` is required by the API (`NOT NULL`, and strictly after the start), so the slot maths
 * keeps the pair consistent rather than letting a form submit an impossible pair: the end is
 * derived from the start plus a duration until it is typed by hand, exactly as the interview form
 * behaves. The entity pair is sent both-or-neither, since half of it is a 422.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  entity,
  meeting,
  defaultTitle,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** The record the meeting belongs to; a lead detail passes `{ type: 'lead', id }`. */
  entity?: { type: MeetingEntityType; id: string; label?: string } | null
  /** Set when editing an existing row. */
  meeting?: Meeting | null
  defaultTitle?: string
  onSaved?: (row: Meeting, created: boolean) => void
}) {
  const { enums } = useEnums()
  const [title, setTitle] = useState('')
  const [slot, setSlot] = useState<SlotState>(() => ({ ...defaultSlot(new Date()), follow: true }))
  const [location, setLocation] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [agenda, setAgenda] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<MeetingStatus>('scheduled')
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const editing = Boolean(meeting)

  // Every open is a fresh, sensible default: today's next clean half hour for an hour.
  useEffect(() => {
    if (!open) return
    setIssues({})
    setFormError(null)
    if (meeting) {
      const start = new Date(meeting.starts_at)
      const end = new Date(meeting.ends_at)
      setSlot({
        starts_at: formatLocalInput(start),
        ends_at: formatLocalInput(end),
        // A stored pair is trusted as written: re-deriving the end from a default duration would
        // silently reschedule a meeting nobody asked to move.
        follow: false,
      })
      setTitle(meeting.title)
      setLocation(meeting.location ?? '')
      setVideoUrl(meeting.video_url ?? '')
      setAgenda(meeting.agenda ?? '')
      setNotes(meeting.notes ?? '')
      setStatus(meeting.status)
      return
    }
    const now = new Date()
    setSlot({ ...defaultSlot(now), follow: true })
    setTitle(defaultTitle ?? '')
    setLocation('')
    setVideoUrl('')
    setAgenda('')
    setNotes('')
    setStatus('scheduled')
  }, [open, meeting?.id, defaultTitle])

  const minutes = durationMinutes(slot.starts_at, slot.ends_at)
  const blockers = useMemo(
    () =>
      [
        !title.trim() ? 'Name the meeting' : null,
        !slot.starts_at ? 'Pick when it happens' : null,
        minutes === null ? 'The end has to be after the start' : null,
      ].filter((x): x is string => Boolean(x)),
    [title, slot.starts_at, minutes]
  )

  async function submit() {
    if (blockers.length) {
      setIssues((prev) => ({
        ...prev,
        ...(title.trim() ? {} : { title: 'A meeting nobody named is a gap in the diary' }),
        ...(!slot.starts_at || minutes === null
          ? { starts_at: 'Start and end have to make a slot' }
          : {}),
      }))
      return
    }
    const startsAt = toIsoFromDateTimeLocal(slot.starts_at)
    const endsAt = toIsoFromDateTimeLocal(slot.ends_at)
    if (!startsAt || !endsAt) {
      setIssues((prev) => ({ ...prev, starts_at: 'Neither half of the slot reads as a time' }))
      return
    }
    setPending(true)
    setFormError(null)
    const body: MeetingInput = {
      title: title.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      location: blankToNull(location),
      video_url: blankToNull(videoUrl),
      agenda: blankToNull(agenda),
      notes: blankToNull(notes),
      status,
      entity_type: entity ? entity.type : null,
      entity_id: entity ? entity.id : null,
    }
    try {
      const saved = await api<Meeting>(
        editing ? meetingPath(meeting!.id) : CRM_PATHS.meetings,
        { method: editing ? 'PATCH' : 'POST', body }
      )
      invalidate(...CRM_SCOPE)
      toastSuccess(editing ? 'Meeting saved' : 'Meeting booked', {
        description: `${saved.title} · ${formatDateTime(saved.starts_at)}`,
      })
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch (error) {
      setFormError(errorMessage(error))
      setIssues((prev) => mergeFieldErrors(error, prev))
    } finally {
      setPending(false)
    }
  }

  const statuses = enums.meeting_status ?? ['scheduled', 'completed', 'cancelled', 'no_show']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? `Edit ${meeting?.title ?? 'meeting'}` : 'Book a meeting'}
          description={
            entity
              ? `On the record for ${entity.label ?? enumLabel(entity.type)}. Booking it stamps that record's last touch, which is how a follow-up clock resets honestly.`
              : 'Not attached to any record — it books the time only.'
          }
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <Field label="Title" htmlFor="meeting-title" required error={issues.title ?? null}>
            <Input
              id="meeting-title"
              autoFocus
              value={title}
              placeholder="Discovery call, quarterly review, handover…"
              invalid={Boolean(issues.title)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="meeting-start" required error={issues.starts_at ?? null}>
              <Input
                id="meeting-start"
                type="datetime-local"
                value={slot.starts_at}
                invalid={Boolean(issues.starts_at)}
                onChange={(event) => setSlot(editStart(slot, event.target.value))}
              />
            </Field>
            <Field
              label="Ends"
              htmlFor="meeting-end"
              required
              error={issues.ends_at ?? null}
              hint={minutes === null ? undefined : `${minutes} minutes`}
            >
              <Input
                id="meeting-end"
                type="datetime-local"
                value={slot.ends_at}
                invalid={Boolean(issues.ends_at)}
                onChange={(event) => setSlot(editEnd(slot, event.target.value))}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="os-label mr-1">Duration</span>
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => setSlot(pickDuration(slot, preset.minutes))}
                  aria-pressed={minutes === preset.minutes}
                  className={cn(
                    'os-tap-none rounded-os border px-1.5 py-0.5 text-[11px] transition-colors',
                    minutes === preset.minutes
                      ? 'border-line-strong text-foreground'
                      : 'border-line text-faint hover:border-line-strong hover:text-muted-foreground'
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="os-label mr-1">Day</span>
              {DAY_CHIPS.map((chip) => (
                <button
                  key={chip.days}
                  type="button"
                  onClick={() => setSlot(shiftDay(slot, chip.days, new Date()))}
                  className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-line-strong hover:text-muted-foreground"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="os-micro">
              {slotSummary(slot.starts_at, slot.ends_at)}
              {!slot.follow && slot.ends_at ? ' · end fixed by hand' : ''}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where" htmlFor="meeting-location">
              <Input
                id="meeting-location"
                value={location}
                placeholder="Studio, or the room's name"
                onChange={(event) => setLocation(event.target.value)}
              />
            </Field>
            <Field label="Video link" htmlFor="meeting-video" error={issues.video_url ?? null}>
              <Input
                id="meeting-video"
                value={videoUrl}
                placeholder="https://…"
                invalid={Boolean(issues.video_url)}
                onChange={(event) => setVideoUrl(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Agenda"
            htmlFor="meeting-agenda"
            hint="what has to be decided — this is the line the next meeting quotes back"
          >
            <Textarea
              id="meeting-agenda"
              rows={2}
              value={agenda}
              onChange={(event) => setAgenda(event.target.value)}
            />
          </Field>

          <Field label="Notes" htmlFor="meeting-notes">
            <Textarea
              id="meeting-notes"
              rows={2}
              value={notes}
              placeholder="What was said, what was promised…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <Field label="Status" htmlFor="meeting-status" hint="completed is a fact, not a feeling">
            <EnumSelect
              id="meeting-status"
              value={status}
              onChange={(next) => setStatus(next as MeetingStatus)}
              options={statuses}
            />
          </Field>

          <p className="os-micro">
            {blockers.length ? (
              <span className="text-danger">{blockers.join(' · ')}</span>
            ) : (
              <>
                {formatMinutes(minutes ?? 0)} from{' '}
                <span className="os-mono">{slot.starts_at.replace('T', ' ')}</span>
                {entity ? ` · ${enumLabel(entity.type)}` : ' · unattached'}
              </>
            )}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={blockers.length > 0}>
            {editing ? 'Save meeting' : 'Book meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One diary line for an entity's embedded meetings. `onOpen` edits it, `onChanged` re-reads the
 * owner, and a completed or cancelled row keeps its history rather than disappearing.
 */
export function MeetingLine({
  meeting,
  showOwner,
  onOpen,
  onChanged,
}: {
  meeting: Meeting
  /** On a summary list, name the record the meeting belongs to. */
  showOwner?: boolean
  onOpen?: (meeting: Meeting) => void
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const href = meetingHref(meeting.entity_type, meeting.entity_id)
  const minutes = durationMinutes(
    formatLocalInput(new Date(meeting.starts_at)),
    formatLocalInput(new Date(meeting.ends_at))
  )

  async function close(next: MeetingStatus) {
    setBusy(true)
    try {
      await api<Meeting>(meetingPath(meeting.id), {
        method: 'PATCH',
        body: { status: next },
      })
      invalidate(...CRM_SCOPE)
      toastSuccess(`Meeting ${enumLabel(next).toLowerCase()}`, { description: meeting.title })
      onChanged?.()
    } catch (error) {
      toastError('The API refused that', { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="min-w-0 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen ? () => onOpen(meeting) : undefined}
            disabled={!onOpen}
            className={cn(
              'os-tap-none block max-w-full text-left text-[13px] leading-snug text-foreground',
              onOpen ? 'underline-offset-2 hover:underline' : 'cursor-default'
            )}
          >
            {meeting.title}
          </button>
          <MicroData
            items={[
              formatDateTime(meeting.starts_at),
              minutes ? formatMinutes(minutes) : null,
              meeting.location,
              showOwner && meeting.entity_type ? enumLabel(meeting.entity_type) : null,
            ]}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showOwner && href ? (
            <Link
              href={href}
              className="os-micro underline underline-offset-2 hover:text-foreground"
            >
              open
            </Link>
          ) : null}
          <StatusDot state={meetingDot(meeting.status)} title={enumLabel(meeting.status)} />
          {meeting.status === 'scheduled' ? (
            <>
              <IconButton
                label="Mark completed"
                size="icon-sm"
                disabled={busy}
                onClick={() => void close('completed')}
              >
                <Check className="size-3.5" />
              </IconButton>
              <IconButton
                label="Cancel meeting"
                size="icon-sm"
                disabled={busy}
                onClick={() => void close('cancelled')}
              >
                <X className="size-3.5" />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>
      {meeting.agenda ? (
        <p className="os-micro mt-1 line-clamp-2 text-faint">{meeting.agenda}</p>
      ) : null}
    </li>
  )
}
