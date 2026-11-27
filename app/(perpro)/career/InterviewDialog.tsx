'use client'

import { useEffect, useMemo, useState } from 'react'

import { blankToNull, mergeFieldErrors, toIsoFromDateTimeLocal } from '@/lib/os/forms'
import { useCreate, useEnums, useResource, useUpdate } from '@/lib/os/hooks'
import {
  CAREER_PATHS,
  CAREER_SCOPE,
  INTERVIEW_DURATIONS,
  interviewPath,
} from '@/lib/os/career'
import type {
  JobApplication,
  JobInterview,
  JobInterviewInput,
  JobInterviewOutcome,
  JobInterviewStatus,
  JobInterviewType,
} from '@/lib/os/career'
import { errorMessage } from '@/lib/os/client'
import { enumLabel, formatDateTime } from '@/lib/os/format'
import type { ListResponse } from '@/lib/os/types'
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
import { Button } from '@/components/os/ui/button'
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
import { ContactMultiSelect, EnumSelect } from '@/components/os/pickers'
import {
  Option,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/os/ui/select'
import { toastSuccess } from '@/components/os/ui/toast'
import { cn } from '@/lib/os/cn'

interface InterviewForm {
  application_id: string | null
  round: string
  type: string
  status: string
  outcome: string
  starts_at: string
  ends_at: string
  follow: boolean
  interviewer_ids: string[]
  notes: string
}

/** The outcome only means something once the conversation has happened. */
const OUTCOME_OPTIONS: JobInterviewOutcome[] = ['positive', 'neutral', 'negative', 'pending']

/**
 * Schedule or edit one interview.
 *
 * The slot behaves exactly like the meeting form does — it opens on today's next clean half hour
 * for an hour, duration chips and day chips move both fields together, and a hand-typed end stops
 * being derived — because a calendar control nobody trusts gets typed into a notes field instead.
 *
 * `duration_minutes` is what the API stores, so the end time is a preview of the duration rather
 * than a second source of truth: `durationMinutes(start, end)` is what goes on the wire.
 */
export function InterviewDialog({
  open,
  onOpenChange,
  interview,
  application,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Set when editing; an id also arrives from `/career?interview=`. */
  interview?: JobInterview | null
  /** Set when scheduling onto a known application — the picker is then locked to it. */
  application?: JobApplication | null
  onSaved?: (row: JobInterview, created: boolean) => void
}) {
  const { enums } = useEnums()
  const editing = Boolean(interview?.id)
  const locked = Boolean(application?.id) && !editing

  const [values, setValues] = useState<InterviewForm>(() => blankForm())
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const applications = useResource<ListResponse<JobApplication>>(
    locked || editing ? null : CAREER_PATHS.applications,
    { limit: 200, sort: 'created', dir: 'desc' }
  )
  const people = useResource<ListResponse<{ id: string; name: string }>>(
    open ? '/contacts' : null,
    { limit: 200, sort: 'name' }
  )

  const create = useCreate<JobInterview, JobInterviewInput>(CAREER_PATHS.interviews, {
    invalidates: [...CAREER_SCOPE],
  })
  const update = useUpdate<JobInterview, JobInterviewInput>(
    () => interviewPath(interview?.id ?? ''),
    { invalidates: [...CAREER_SCOPE] }
  )

  useEffect(() => {
    if (!open) return
    setIssues({})
    setFormError(null)
    create.reset()
    update.reset()
    if (interview) {
      setValues({
        application_id: interview.application_id,
        round: interview.round,
        type: interview.type ?? 'phone',
        status: interview.status,
        outcome: interview.outcome ?? 'pending',
        ...slotFromStart(interview.scheduled_at, interview.duration_minutes ?? 60),
        follow: true,
        interviewer_ids: interview.interviewer_ids ?? [],
        notes: interview.notes ?? '',
      })
      return
    }
    const now = new Date()
    setValues({
      application_id: application?.id ?? null,
      round: '',
      type: 'phone',
      status: 'scheduled',
      outcome: 'pending',
      ...defaultSlot(now),
      follow: true,
      interviewer_ids: [],
      notes: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interview?.id, application?.id])

  const patch = (next: Partial<InterviewForm>) => setValues((prev) => ({ ...prev, ...next }))

  /** The slot fields are a `SlotState`; the API stores a start plus a duration. */
  const slot: SlotState = { starts_at: values.starts_at, ends_at: values.ends_at, follow: values.follow }
  function applySlot(next: SlotState) {
    patch({ starts_at: next.starts_at, ends_at: next.ends_at, follow: next.follow })
  }

  const duration = durationMinutes(values.starts_at, values.ends_at)
  const chosen = useMemo(() => {
    const rows = people.data?.items ?? []
    return values.interviewer_ids
      .map((id) => rows.find((row) => row.id === id)?.name ?? id)
      .filter(Boolean)
  }, [people.data, values.interviewer_ids])

  const blockers = [
    !values.application_id ? 'Pick the application' : null,
    !values.round.trim() ? 'Name the round' : null,
    !values.starts_at ? 'Pick when it happens' : null,
    duration === null ? 'The end is not after the start' : null,
  ].filter((x): x is string => Boolean(x))

  async function submit() {
    if (!values.application_id || !values.round.trim() || !values.starts_at || duration === null) {
      setIssues((prev) => ({
        ...prev,
        ...(values.round.trim() ? {} : { round: 'Interviewers ask what this round is' }),
        ...(!values.starts_at || duration === null ? { starts_at: 'Start and end have to make a slot' } : {}),
      }))
      return
    }
    setPending(true)
    setFormError(null)
    const body: JobInterviewInput = {
      application_id: values.application_id,
      round: values.round.trim(),
      type: blankToNull(values.type) as JobInterviewType | null,
      scheduled_at: toIsoFromDateTimeLocal(values.starts_at) ?? values.starts_at,
      duration_minutes: duration,
      status: values.status as JobInterviewStatus,
      outcome: blankToNull(values.outcome) as JobInterviewOutcome | null,
      interviewer_ids: values.interviewer_ids.length ? values.interviewer_ids : null,
      notes: blankToNull(values.notes),
    }
    try {
      const saved = editing ? await update.mutate(body) : await create.mutate(body)
      toastSuccess(editing ? 'Interview saved' : 'Interview scheduled', {
        description: `${saved.round} · ${formatDateTime(saved.scheduled_at)} · ${saved.duration_minutes ?? 60} min`,
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

  const types = enums.job_interview_type ?? ['phone', 'video', 'onsite', 'technical', 'hr', 'other']
  const statuses = enums.job_interview_status ?? ['scheduled', 'completed', 'cancelled', 'no_show']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? `Edit ${interview?.round ?? 'interview'}` : 'Schedule an interview'}
          description={
            locked && application
              ? `For ${application.role_title}${application.company?.name ? ` at ${application.company.name}` : ''}. Scheduling an interview does not move the application itself — that is a separate, deliberate step.`
              : 'Pick the application first. The round, the slot and who is in the room are all you have to decide.'
          }
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Application" htmlFor="interview-application" required error={issues.application_id ?? null}>
              {locked || editing ? (
                <p className="flex h-9 items-center truncate text-[13px] text-muted-foreground">
                  {application?.role_title ?? interview?.application?.role_title ?? 'This application'}
                  {application?.company?.name ?? interview?.application?.company
                    ? ` · ${application?.company?.name ?? interview?.application?.company}`
                    : ''}
                </p>
              ) : (
                <Select
                  value={values.application_id ?? '__none'}
                  onValueChange={(next) => patch({ application_id: next === '__none' ? null : next })}
                >
                  <SelectTrigger id="interview-application">
                    <SelectValue
                      placeholder={
                        applications.loading
                          ? 'Loading applications…'
                          : 'Pick the application'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <Option value="__none">No application</Option>
                    {(applications.data?.items ?? []).map((row) => (
                      <Option key={row.id} value={row.id}>
                        {row.role_title}
                        {row.company?.name ? ` · ${row.company.name}` : ''}
                      </Option>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Round" htmlFor="interview-round" required error={issues.round ?? null} hint="what you call it — recruiter screen, system design, final loop">
              <Input
                id="interview-round"
                autoFocus={locked}
                value={values.round}
                placeholder="Recruiter screen"
                invalid={Boolean(issues.round)}
                onChange={(event) => patch({ round: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="interview-type">
              <EnumSelect
                id="interview-type"
                value={values.type}
                onChange={(type) => patch({ type })}
                options={types}
              />
            </Field>
            <Field label="Status" htmlFor="interview-status" hint="completed is a fact, not a feeling">
              <EnumSelect
                id="interview-status"
                value={values.status}
                onChange={(status) => patch({ status })}
                options={statuses}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor="interview-start" required error={issues.starts_at ?? null}>
              <Input
                id="interview-start"
                type="datetime-local"
                value={values.starts_at}
                invalid={Boolean(issues.starts_at)}
                onChange={(event) => applySlot(editStart(slot, event.target.value))}
              />
            </Field>
            <Field label="Ends" htmlFor="interview-end" hint={duration === null ? undefined : `${duration} minutes`}>
              <Input
                id="interview-end"
                type="datetime-local"
                value={values.ends_at}
                onChange={(event) => applySlot(editEnd(slot, event.target.value))}
              />
            </Field>
          </div>

          {/* The same quick-picks the meeting form uses: durations snap the end, day chips move both. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="os-label mr-1">Duration</span>
              {DURATION_PRESETS.filter((preset) =>
                  (INTERVIEW_DURATIONS as readonly number[]).includes(preset.minutes)
                ).map((preset) => (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => applySlot(pickDuration(slot, preset.minutes))}
                  aria-pressed={duration === preset.minutes}
                  className={cn(
                    'os-tap-none rounded-os border px-1.5 py-0.5 text-[11px] transition-colors',
                    duration === preset.minutes
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
                  onClick={() => applySlot(shiftDay(slot, chip.days, new Date()))}
                  className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-line-strong hover:text-muted-foreground"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="os-micro">
              {slotSummary(values.starts_at, values.ends_at)}
              {!values.follow && values.ends_at ? ' · end fixed by hand' : ''}
            </p>
          </div>

          <Field label="Interviewers" hint="picked people are stored as ids, so renaming them does not break the round">
            <ContactMultiSelect
              value={values.interviewer_ids}
              onChange={(interviewer_ids) => patch({ interviewer_ids })}
              options={(people.data?.items ?? []).map((row) => ({ id: row.id, name: row.name }))}
              placeholder={people.loading ? 'Loading people…' : 'No contacts yet'}
            />
          </Field>
          {chosen.length ? (
            <p className="os-micro">{`${chosen.length} picked: ${chosen.join(', ')}`}</p>
          ) : null}

          <Field label="Outcome" htmlFor="interview-outcome" hint="how it went, once it has">
            <EnumSelect
              id="interview-outcome"
              value={values.outcome}
              onChange={(outcome) => patch({ outcome })}
              options={OUTCOME_OPTIONS}
            />
          </Field>

          <Field label="Notes" htmlFor="interview-notes">
            <Textarea
              id="interview-notes"
              rows={3}
              value={values.notes}
              placeholder="Questions they asked, what you said you would send, who to thank…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          <p className="os-micro">
            {blockers.length ? (
              <span className="text-danger">{blockers.join(' · ')}</span>
            ) : (
              <>
                {enumLabel(values.status)} · {values.type} · saved as{' '}
                <span className="os-mono">{duration} min</span> from{' '}
                <span className="os-mono">{values.starts_at.replace('T', ' ')}</span>
              </>
            )}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={blockers.length > 0}>
            {editing ? 'Save interview' : 'Schedule interview'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------- pieces -- */

function blankForm(): InterviewForm {
  return {
    application_id: null,
    round: '',
    type: 'phone',
    status: 'scheduled',
    outcome: 'pending',
    starts_at: '',
    ends_at: '',
    follow: true,
    interviewer_ids: [],
    notes: '',
  }
}

/** An existing row's timestamp + duration, as the two local inputs the slot helpers expect. */
function slotFromStart(scheduledAt: string, minutes: number): Pick<InterviewForm, 'starts_at' | 'ends_at'> {
  const start = new Date(scheduledAt)
  if (Number.isNaN(start.getTime())) return { starts_at: '', ends_at: '' }
  return {
    starts_at: formatLocalInput(start),
    ends_at: formatLocalInput(new Date(start.getTime() + minutes * 60_000)),
  }
}
