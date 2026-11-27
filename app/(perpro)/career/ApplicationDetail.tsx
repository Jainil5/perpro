'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Briefcase,
  CalendarPlus,
  Check,
  ExternalLink,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useResource } from '@/lib/os/hooks'
import {
  applicationPath,
  applicationTransitionPath,
  allowedTransitions,
  CAREER_SCOPE,
  interviewPath,
  salaryBand,
} from '@/lib/os/career'
import type {
  ApplicationTransitionInput,
  JobApplicationDetail as ApplicationDetailRow,
  JobApplicationStatus,
  JobInterview,
} from '@/lib/os/career'
import { formatMoney } from '@/lib/os/currency'
import {
  countLabel,
  dueLabel,
  dueTone,
  enumLabel,
  formatDate,
  formatDateTime,
  formatMinutes,
} from '@/lib/os/format'
import { LoadingBlock, ErrorBlock, ResourceState } from '@/components/os/states'
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
import { MicroData, StatusDot } from '@/components/os/marks'
import { useContactOptions } from '@/components/os/pickers'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { InterviewDialog } from './InterviewDialog'

/** What each closing status is called when a human has to click it. */
const CLOSE_LABELS: Record<string, string> = {
  applied: 'Reopen as applied',
  screening: 'Move to screening',
  interview: 'Move to interview',
  offer: 'Move to offer',
  hired: 'Accept → hired',
  rejected: 'Reject',
  withdrawn: 'Withdraw',
  saved: 'Back to saved',
}

/**
 * One application, opened: the state machine's legal moves as buttons, the next action, and the
 * interview history — in that order, because that is the order the questions arrive in.
 *
 * The moves go to `POST /job-applications/{id}/transition`, which is the only call that carries a
 * note onto the activity row, and the list of chips is `allowedTransitions(status)` — the same
 * graph the server runs, so a chip that is not offered is a jump the API would have answered 409.
 */
export function ApplicationDetail({
  id,
  currency,
  open,
  onOpenChange,
  onEdit,
  onRequestDelete,
}: {
  id: string | null
  currency: string
  open: boolean
  onOpenChange: (next: boolean) => void
  onEdit: (row: ApplicationDetailRow) => void
  onRequestDelete: (row: ApplicationDetailRow) => void
}) {
  const detail = useResource<ApplicationDetailRow>(id ? applicationPath(id) : null)
  const people = useContactOptions(open)
  const [note, setNote] = useState('')
  const [moving, setMoving] = useState<string | null>(null)
  const [busyInterview, setBusyInterview] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [interviewForm, setInterviewForm] = useState<{
    open: boolean
    row: JobInterview | null
  }>({ open: false, row: null })

  useEffect(() => {
    if (!open) return
    setNote('')
    setArmed(null)
    setInterviewForm({ open: false, row: null })
  }, [open, id])

  async function move(status: JobApplicationStatus) {
    if (!id) return
    setMoving(status)
    try {
      await api<ApplicationDetailRow>(applicationTransitionPath(id), {
        method: 'POST',
        body: { status, note: note.trim() || null } satisfies ApplicationTransitionInput,
      })
      invalidate(...CAREER_SCOPE)
      toastSuccess(`Moved to ${enumLabel(status)}`, {
        description: note.trim() ? 'The note went on the activity row' : undefined,
      })
      setNote('')
    } catch (error) {
      toastError('That move was refused', { description: errorMessage(error) })
    } finally {
      setMoving(null)
    }
  }

  async function patchInterview(row: JobInterview, body: Partial<JobInterview>) {
    setBusyInterview(row.id)
    try {
      await api<JobInterview>(interviewPath(row.id), { method: 'PATCH', body })
      invalidate(...CAREER_SCOPE)
    } catch (error) {
      toastError('Could not save the interview', { description: errorMessage(error) })
    } finally {
      setBusyInterview(null)
    }
  }

  async function removeInterview(row: JobInterview) {
    setBusyInterview(row.id)
    try {
      await api(interviewPath(row.id), { method: 'DELETE' })
      invalidate(...CAREER_SCOPE)
      setArmed(null)
      toastSuccess('Interview deleted', { description: row.round })
    } catch (error) {
      toastError('Could not delete it', { description: errorMessage(error) })
    } finally {
      setBusyInterview(null)
    }
  }

  const row = detail.data
  const interviews = row?.interviews ?? []
  const moves = row ? allowedTransitions(row.status) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={row ? row.role_title : 'Application'}
          description={
            row
              ? `${row.company?.name ?? 'No company linked'} · ${enumLabel(row.status)}${
                  row.closed_at ? ` · closed ${formatDate(row.closed_at)}` : ''
                }`
              : 'Reading the row…'
          }
        />
        <DialogBody className="space-y-4">
          {id === null ? null : (
            <ResourceState
              resource={detail}
              skeleton={<LoadingBlock rows={6} label="Loading this application…" />}
            >
              {(data) => (
                <div className="space-y-4">
                  {/* ---- the move ---- */}
                  <section className="min-w-0 space-y-2">
                    <p className="os-label">Move this application</p>
                    {moves.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {moves.map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={moving !== null}
                            onClick={() => void move(status)}
                            className={cn(
                              'os-tap-none inline-flex min-h-[32px] items-center gap-1.5 rounded-os border px-2 text-[12px] transition-colors',
                              status === 'rejected' || status === 'withdrawn'
                                ? 'border-line text-muted-foreground hover:border-danger hover:text-danger'
                                : status === 'hired'
                                  ? 'border-success text-success hover:border-success'
                                  : 'border-line text-foreground hover:border-line-strong',
                              moving === status && 'opacity-60'
                            )}
                          >
                            {moving === status ? <Check className="size-3 animate-pulse" /> : null}
                            {CLOSE_LABELS[status] ?? `Move to ${enumLabel(status)}`}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="os-micro">
                        Nothing legal is left to move to from here. Reopening a closed application is
                        a deliberate step, so it is only offered on a closed row.
                      </p>
                    )}
                    <Field
                      label="Note on this move"
                      htmlFor="transition-note"
                      hint="optional; it lands on the activity row, next to the transition"
                    >
                      <Input
                        id="transition-note"
                        value={note}
                        placeholder="Passed the system design; panel said strong hire"
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </Field>
                  </section>

                  {/* ---- the facts ---- */}
                  <section className="min-w-0 space-y-3 border-t border-line pt-3">
                    <MicroData
                      items={[
                        data.channel ? `from ${enumLabel(data.channel)}` : null,
                        data.location ?? (data.remote ? 'remote' : null),
                        data.applied_at ? `applied ${formatDate(data.applied_at)}` : 'not applied yet',
                        data.interview_count
                          ? countLabel(data.interview_count, 'interview')
                          : 'no interviews',
                        data.days_since_touch !== null && data.days_since_touch !== undefined
                          ? `last touched ${data.days_since_touch} days ago`
                          : null,
                        data.source === 'demo' ? 'demo data' : null,
                      ]}
                    />
                    <p className="os-mono text-[13px] text-foreground">
                      {salaryBand(data.salary_min, data.salary_max, (value) =>
                        formatMoney(value, currency)
                      ) ?? 'No salary band recorded'}
                    </p>
                    {data.url ? (
                      <a
                        href={data.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="os-micro inline-flex items-center gap-1 text-foreground underline underline-offset-2"
                      >
                        <ExternalLink className="size-3" /> the listing
                      </a>
                    ) : null}
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <NextActionEditor row={data} />
                    </div>
                    {data.notes ? (
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                        {data.notes}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {data.company_id ? (
                        <Link
                          href={`/contacts?company=${data.company_id}`}
                          className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          <Briefcase className="size-3" /> {data.company?.name ?? 'company'}
                        </Link>
                      ) : null}
                      {data.contact_id ? (
                        <Link
                          href={`/contacts?contact=${data.contact_id}`}
                          className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          <ArrowUpRight className="size-3" /> {data.contact?.name ?? 'contact'}
                        </Link>
                      ) : null}
                      <Link
                        href="/crm"
                        className="os-micro inline-flex items-center gap-1 text-faint underline underline-offset-2"
                      >
                        this role came from a referral? check the CRM
                      </Link>
                    </div>
                  </section>

                  {/* ---- the history ---- */}
                  <section className="min-w-0 space-y-2 border-t border-line pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="os-label">Interviews</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setInterviewForm({ open: true, row: null })}
                      >
                        <CalendarPlus className="size-3.5" /> Schedule
                      </Button>
                    </div>
                    {interviews.length === 0 ? (
                      <p className="os-micro">
                        No rounds yet. Scheduling one does not move the application to interview —
                        that is the button above, and it should be a decision rather than a
                        side-effect.
                      </p>
                    ) : (
                      <ul className="min-w-0 divide-y divide-line">
                        {interviews.map((interview) => (
                          <InterviewLine
                            key={interview.id}
                            interview={interview}
                            busy={busyInterview === interview.id}
                            armed={armed === interview.id}
                            names={(idValue: string) =>
                              people.data?.items.find((item) => item.id === idValue)?.name ?? idValue
                            }
                            onArm={() => setArmed((prev) => (prev === interview.id ? null : interview.id))}
                            onEdit={() => setInterviewForm({ open: true, row: interview })}
                            onDelete={() => void removeInterview(interview)}
                            onPatch={(body) => void patchInterview(interview, body)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </ResourceState>
          )}

          {detail.error && detail.data === undefined ? (
            <ErrorBlock
              error={detail.error}
              onRetry={detail.reload}
              title={detail.error.status === 404 ? 'This application is not in this workspace' : undefined}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onEdit(row ?? ({ id } as ApplicationDetailRow))}
            disabled={!row}
          >
            <Pencil className="size-3.5" /> Edit details
          </Button>
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => onRequestDelete(row ?? ({ id } as ApplicationDetailRow))}
            disabled={!row}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <span className="ml-auto" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-3.5" /> Close
          </Button>
        </DialogFooter>

        {row ? (
          <InterviewDialog
            open={interviewForm.open}
            onOpenChange={(next) => setInterviewForm((prev) => ({ ...prev, open: next }))}
            interview={interviewForm.row}
            application={interviewForm.row ? null : row}
            onSaved={() => detail.reload()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------- pieces -- */

/** `next_action` + `next_action_date` are the two fields people change most, so they edit in place. */
function NextActionEditor({ row }: { row: ApplicationDetailRow }) {
  const [action, setAction] = useState(row.next_action ?? '')
  const [date, setDate] = useState(row.next_action_date ?? '')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setAction(row.next_action ?? '')
    setDate(row.next_action_date ?? '')
  }, [row.id, row.next_action, row.next_action_date])

  const dirty = action !== (row.next_action ?? '') || date !== (row.next_action_date ?? '')
  const tone = dueTone(row.next_action_date)

  async function save() {
    setPending(true)
    try {
      await api(applicationPath(row.id), {
        method: 'PATCH',
        body: {
          next_action: action.trim() || null,
          next_action_date: date || null,
        },
      })
      invalidate(...CAREER_SCOPE)
      toastSuccess('Next action saved', { description: action.trim() || 'cleared' })
    } catch (error) {
      toastError('Could not save it', { description: errorMessage(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <p className="os-label">
        Next action
        {row.next_action_date ? (
          <span
            className={cn(
              'ml-2 normal-case tracking-normal',
              tone === 'overdue' ? 'text-danger' : tone === 'today' || tone === 'soon' ? 'text-warning' : 'text-faint'
            )}
          >
            {dueLabel(row.next_action_date)}
          </span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={action}
          aria-label="Next action"
          placeholder="Follow up with the recruiter"
          onChange={(event) => setAction(event.target.value)}
          className="h-8 min-w-[12rem] flex-1 text-[13px]"
        />
        <Input
          type="date"
          value={date}
          aria-label="Next action date"
          onChange={(event) => setDate(event.target.value)}
          className="os-mono h-8 w-[8.5rem] text-[12px]"
        />
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function InterviewLine({
  interview,
  busy,
  armed,
  names,
  onArm,
  onEdit,
  onDelete,
  onPatch,
}: {
  interview: JobInterview
  busy: boolean
  armed: boolean
  names: (id: string) => string
  onArm: () => void
  onEdit: () => void
  onDelete: () => void
  onPatch: (body: Partial<JobInterview>) => void
}) {
  const outcome = interview.outcome ?? 'pending'
  const interviewers = (interview.interviewer_ids ?? []).map(names)
  return (
    <li className={cn('min-w-0 py-2', busy && 'opacity-60')}>
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left text-[13px] text-foreground underline-offset-2 hover:underline"
        >
          {interview.round}
          {interview.type ? (
            <span className="os-micro ml-2 uppercase tracking-[0.14em] text-faint">
              {enumLabel(interview.type)}
            </span>
          ) : null}
        </button>
        <span className="os-mono shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatDateTime(interview.scheduled_at)}
        </span>
      </div>

      <MicroData
        items={[
          interview.duration_minutes ? formatMinutes(interview.duration_minutes) : null,
          interviewers.length ? interviewers.join(', ') : null,
          interview.status === 'no_show' ? 'they did not turn up' : null,
        ]}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <StatusDot
          state={
            interview.status === 'completed'
              ? 'done'
              : interview.status === 'cancelled'
                ? 'abandoned'
                : interview.status === 'no_show'
                  ? 'abandoned'
                  : 'in_progress'
          }
          tone={
            interview.outcome === 'positive'
              ? 'success'
              : interview.outcome === 'negative'
                ? 'critical'
                : interview.outcome === 'neutral'
                  ? 'warning'
                  : undefined
          }
          title={`Status ${enumLabel(interview.status)}`}
        />
        {interview.status !== 'completed' ? (
          <button
            type="button"
            onClick={() => onPatch({ status: 'completed' })}
            className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground"
          >
            Mark completed
          </button>
        ) : (
          <span className="os-micro text-success">completed</span>
        )}
        {interview.status === 'scheduled' ? (
          <button
            type="button"
            onClick={() => onPatch({ status: 'cancelled' })}
            className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-line-strong hover:text-muted-foreground"
          >
            Cancel it
          </button>
        ) : null}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        {(['positive', 'neutral', 'negative'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={outcome === value}
            onClick={() => onPatch({ outcome: value })}
            className={cn(
              'os-tap-none rounded-os border px-1.5 py-0.5 text-[11px] transition-colors',
              outcome === value
                ? 'border-line-strong text-foreground'
                : 'border-line text-faint hover:border-line-strong hover:text-muted-foreground'
            )}
          >
            {enumLabel(value)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton label={`Edit ${interview.round}`} size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          {armed ? (
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy}>
              Confirm delete
            </Button>
          ) : (
            <IconButton label={`Delete ${interview.round}`} size="icon-sm" onClick={onArm}>
              <Trash2 className="size-3.5" />
            </IconButton>
          )}
        </span>
      </div>
      {armed ? (
        <p className="os-micro mt-1 text-danger">
          deleting removes the round only — the application and its activity stay
        </p>
      ) : null}
      {interview.notes ? (
        <p className="os-micro mt-1 whitespace-pre-line text-muted-foreground">{interview.notes}</p>
      ) : null}
    </li>
  )
}
