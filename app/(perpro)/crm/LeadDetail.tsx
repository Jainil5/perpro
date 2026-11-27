'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Check,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useResource } from '@/lib/os/hooks'
import {
  dateInputValue,
  mergeFieldErrors,
} from '@/lib/os/forms'
import {
  allowedLeadTransitions,
  CRM_PATHS,
  CRM_SCOPE,
  isClosedLead,
  leadPath,
  leadTransitionPath,
  type LeadDetail as LeadRow,
  type LeadStatus,
  type LeadTransitionInput,
  type Meeting,
} from '@/lib/os/crm'
import type { ListResponse } from '@/lib/os/types'
import { countLabel, dueLabel, dueTone, enumLabel, formatDate } from '@/lib/os/format'
import { formatMoney } from '@/lib/os/currency'
import { LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
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
import { HairlineBar, MicroData, StatusDot } from '@/components/os/marks'
import { MeetingDialog, MeetingLine } from '@/components/os/meetings'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

/** What each lead move is called when a human has to click it. */
const MOVE_LABELS: Record<string, string> = {
  contacted: 'Mark contacted',
  qualified: 'Qualify',
  proposal: 'Send a proposal',
  won: 'Win it',
  lost: 'Lose it',
  dormant: 'Park it',
}

/**
 * One lead, opened: the legal moves first, then the facts, then the diary.
 *
 * Moves go to `POST /leads/{id}/transition`, which is the call that stamps `last_touch_at` and
 * writes the activity row — so a follow-up clock can only be reset by doing the thing, not by
 * editing a date. Closing as `lost` requires a reason (the API asks, and the win/loss line quotes
 * it back), and winning here is a two-part question: the transition, or promote, which also opens
 * the account.
 */
export function LeadDetail({
  id,
  currency,
  open,
  onOpenChange,
  onEdit,
  onRequestDelete,
  onPromote,
}: {
  id: string | null
  currency: string
  open: boolean
  onOpenChange: (next: boolean) => void
  onEdit: (row: LeadRow) => void
  onRequestDelete: (row: LeadRow) => void
  /** Opens the promote dialog; the account is created by the API, not here. */
  onPromote: (row: LeadRow) => void
}) {
  const detail = useResource<LeadRow>(id ? leadPath(id) : null)
  // The lead's diary is a meeting-list read, not an embed: `/meetings` is the one calendar the
  // whole OS shares, filtered by the polymorphic pair.
  const diary = useResource<ListResponse<Meeting>>(
    id ? CRM_PATHS.meetings : null,
    { entity_type: 'lead', entity_id: id ?? undefined, sort: 'starts_at', dir: 'asc', limit: 10 }
  )
  const [moving, setMoving] = useState<string | null>(null)
  const [losing, setLosing] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [touchBusy, setTouchBusy] = useState(false)
  const [meetingForm, setMeetingForm] = useState(false)

  useEffect(() => {
    if (!open) return
    setMoving(null)
    setLosing(false)
    setLostReason('')
    setIssues({})
    setMeetingForm(false)
    detail.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id])

  async function move(status: LeadStatus) {
    if (!id) return
    if (status === 'lost' && !lostReason.trim()) {
      setLosing(true)
      setIssues((prev) => ({ ...prev, lost_reason: 'A lost lead needs a reason — it is the only feedback the pipeline gives back' }))
      return
    }
    setMoving(status)
    try {
      const body: LeadTransitionInput = {
        status,
        lost_reason: status === 'lost' ? lostReason.trim() : null,
      }
      await api<LeadRow>(leadTransitionPath(id), { method: 'POST', body })
      invalidate(...CRM_SCOPE)
      toastSuccess(`Lead ${enumLabel(status).toLowerCase()}`, {
        description: status === 'lost' ? lostReason.trim() : 'The follow-up clock restarted on this touch',
      })
      setLosing(false)
      setLostReason('')
      setIssues({})
      detail.reload()
    } catch (error) {
      toastError('That move was refused', { description: errorMessage(error) })
      setIssues((prev) => mergeFieldErrors(error, prev))
    } finally {
      setMoving(null)
    }
  }

  async function patchTouch(value: string) {
    if (!id) return
    setTouchBusy(true)
    try {
      await api<LeadRow>(leadPath(id), {
        method: 'PATCH',
        // `next_touch_at` is a DATE column, so the field's `YYYY-MM-DD` is already the body.
        body: { next_touch_at: value || null },
      })
      invalidate(...CRM_SCOPE)
      toastSuccess(value ? 'Follow-up set' : 'Follow-up cleared')
      detail.reload()
    } catch (error) {
      toastError('Could not save that', { description: errorMessage(error) })
      setIssues((prev) => mergeFieldErrors(error, prev))
    } finally {
      setTouchBusy(false)
    }
  }

  const row = detail.data
  const moves = row ? allowedLeadTransitions(row.status) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={row ? row.name : 'Lead'}
          description={
            row
              ? `${enumLabel(row.status)}${row.origin ? ` · from ${enumLabel(row.origin)}` : ''}${
                  row.client ? ' · already an account' : ''
                }`
              : 'Reading the row…'
          }
        />
        <DialogBody className="space-y-4">
          {id === null ? null : (
            <ResourceState
              resource={detail}
              skeleton={<LoadingBlock rows={6} label="Loading this lead…" />}
            >
              {(data) => (
                <div className="space-y-4">
                  {/* ---- the move ---- */}
                  <section className="min-w-0 space-y-2">
                    <p className="os-label">Move this lead</p>
                    {moves.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {moves.map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={moving !== null}
                            onClick={() => void move(status as LeadStatus)}
                            className={cn(
                              'os-tap-none inline-flex min-h-[32px] items-center gap-1.5 rounded-os border px-2 text-[12px] transition-colors',
                              status === 'lost'
                                ? 'border-line text-muted-foreground hover:border-danger hover:text-danger'
                                : status === 'won'
                                  ? 'border-success text-success'
                                  : status === 'dormant'
                                    ? 'border-line text-faint hover:border-line-strong'
                                    : 'border-line text-foreground hover:border-line-strong',
                              moving === status && 'opacity-60'
                            )}
                          >
                            {moving === status ? <Check className="size-3 animate-pulse" /> : null}
                            {MOVE_LABELS[status] ?? `Move to ${enumLabel(status)}`}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="os-micro">
                        {data.status === 'won'
                          ? 'Won is terminal — the account is where the work happens now.'
                          : 'Nothing legal from here.'}
                      </p>
                    )}

                    {losing || moves.includes('lost') ? (
                      <Field
                        label="Why it was lost"
                        htmlFor="lead-lost-reason"
                        error={issues.lost_reason ?? null}
                        hint="price, timing, they went quiet — one sentence, and it is kept on the row"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Input
                            id="lead-lost-reason"
                            value={lostReason}
                            placeholder="Went with a cheaper agency"
                            invalid={Boolean(issues.lost_reason)}
                            onChange={(event) => {
                              setLostReason(event.target.value)
                              if (event.target.value.trim()) {
                                setIssues((prev) => ({ ...prev, lost_reason: '' }))
                              }
                            }}
                          />
                          {losing ? (
                            <Button
                              size="sm"
                              onClick={() => void move('lost')}
                              loading={moving === 'lost'}
                            >
                              Confirm lost
                            </Button>
                          ) : null}
                        </div>
                      </Field>
                    ) : null}

                    {!isClosedLead(data.status) && !data.client ? (
                      <div className="flex flex-wrap items-center gap-2 border-t border-line-faint pt-2">
                        <Button size="sm" variant="outline" onClick={() => onPromote(data)}>
                          <Sparkles /> Win and open the account
                        </Button>
                        <span className="os-micro">
                          promotes this lead to a client in one transaction; the plain “Win it” move
                          above only closes the funnel
                        </span>
                      </div>
                    ) : data.client ? (
                      <p className="os-micro pt-1">
                        Opened{' '}
                        <Link
                          href={`/customers?client=${data.client.id}`}
                          className="inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          {data.client.name}
                          <ArrowUpRight className="size-3" />
                        </Link>{' '}
                        as {enumLabel(data.client.stage)}
                      </p>
                    ) : null}
                  </section>

                  {/* ---- the facts ---- */}
                  <section className="min-w-0 space-y-3 border-t border-line pt-3">
                    <MicroData
                      items={[
                        data.email,
                        data.score === null || data.score === undefined
                          ? 'unscored'
                          : `score ${data.score}/100`,
                        data.estimated_value !== null && data.estimated_value !== undefined
                          ? `${formatMoney(data.estimated_value, data.currency ?? currency)} if it lands`
                          : 'no value on it',
                        data.days_since_touch === null || data.days_since_touch === undefined
                          ? null
                          : `touched ${data.days_since_touch} days ago`,
                        data.created_at ? `added ${formatDate(data.created_at)}` : null,
                      ]}
                    />
                    {data.score !== null && data.score !== undefined ? (
                      <HairlineBar
                        value={data.score}
                        label="Lead score"
                        title={`${data.score} of 100 — it weights the pipeline total`}
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      {data.contact ? (
                        <Link
                          href={`/contacts?contact=${data.contact.id}`}
                          className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          person: {data.contact.name}
                          <ArrowUpRight className="size-3" />
                        </Link>
                      ) : null}
                      {data.company ? (
                        <Link
                          href={`/contacts?company=${data.company.id}`}
                          className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          company: {data.company.name}
                          <ArrowUpRight className="size-3" />
                        </Link>
                      ) : null}
                      {!data.contact && !data.company ? (
                        <span className="os-micro text-faint">
                          no person or company on it yet — promoting will create the person from the
                          lead's own name and email
                        </span>
                      ) : null}
                    </div>
                  </section>

                  {/* ---- the follow-up clock ---- */}
                  <section className="min-w-0 space-y-2 border-t border-line pt-3">
                    <p className="os-label">Follow up</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field
                        label="Next touch"
                        htmlFor="lead-touch"
                        hint="a move or a meeting stamps the touch; this only sets the intention"
                      >
                        <Input
                          id="lead-touch"
                          type="date"
                          defaultValue={dateInputValue(data.next_touch_at)}
                          disabled={touchBusy}
                          onBlur={(event) => {
                            const next = event.target.value
                            if (next === dateInputValue(data.next_touch_at)) return
                            void patchTouch(next)
                          }}
                        />
                      </Field>
                      <p
                        className={cn(
                          'os-micro pb-2',
                          dueTone(data.next_touch_at) === 'overdue'
                            ? 'text-danger'
                            : dueTone(data.next_touch_at) === 'today' ||
                                dueTone(data.next_touch_at) === 'soon'
                              ? 'text-warning'
                              : 'text-faint'
                        )}
                      >
                        {data.next_touch_at
                          ? `${dueLabel(data.next_touch_at)} · ${formatDate(data.next_touch_at)}${
                              data.is_overdue
                                ? ` · ${Math.abs(data.days_to_next_touch ?? 0)} days past`
                                : ''
                            }`
                          : 'no follow-up planned'}
                      </p>
                      {data.next_touch_at ? (
                        <IconButton
                          label="Clear the follow-up date"
                          size="icon-sm"
                          disabled={touchBusy}
                          onClick={() => void patchTouch('')}
                        >
                          <X className="size-3.5" />
                        </IconButton>
                      ) : null}
                    </div>
                  </section>

                  {/* ---- the diary ---- */}
                  <section className="min-w-0 space-y-2 border-t border-line pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="os-label">Meetings ahead</p>
                      <Button size="sm" variant="outline" onClick={() => setMeetingForm(true)}>
                        Book a meeting
                      </Button>
                    </div>
                    <SoftError error={diary.error} />
                    {diary.loading && diary.data === undefined ? (
                      <LoadingBlock rows={2} label="Reading this lead's diary…" />
                    ) : (diary.data?.items.length ?? 0) > 0 ? (
                      <ul className="min-w-0 divide-y divide-line">
                        {(diary.data?.items ?? []).map((meeting) => (
                          <MeetingLine
                            key={meeting.id}
                            meeting={meeting}
                            onChanged={() => {
                              diary.reload()
                              detail.reload()
                            }}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="os-micro text-faint">
                        Nothing booked. A meeting on a lead is the honest way to stop it reading as
                        overdue — the API stamps the touch when it happens.
                      </p>
                    )}
                  </section>

                  {data.notes ? (
                    <section className="min-w-0 space-y-1 border-t border-line pt-3">
                      <p className="os-label">Notes</p>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                        {data.notes}
                      </p>
                    </section>
                  ) : null}

                  {data.lost_reason ? (
                    <p className="os-micro border-t border-line pt-3 text-danger">
                      lost because: {data.lost_reason}
                    </p>
                  ) : null}
                </div>
              )}
            </ResourceState>
          )}
        </DialogBody>
        <DialogFooter>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => row && onEdit(row)}
              disabled={!row}
            >
              <Pencil /> Edit
            </Button>
            <Button
              variant="ghost"
              onClick={() => row && onRequestDelete(row)}
              disabled={!row || isClosedLead(row.status)}
              title={
                row && isClosedLead(row.status)
                  ? 'A closed lead is history — losing it is recorded, deleting it is not'
                  : undefined
              }
            >
              <Trash2 /> Delete
            </Button>
          </div>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {row ? (
        <MeetingDialog
          open={meetingForm}
          onOpenChange={setMeetingForm}
          entity={{ type: 'lead', id: row.id, label: row.name }}
          defaultTitle={`Call with ${row.name}`}
          onSaved={() => detail.reload()}
        />
      ) : null}
    </Dialog>
  )
}

/** The dot used by the board card and the table row, from the same status. */
export function leadStatusDot(status: LeadStatus | string) {
  return (
    <StatusDot
      state={
        status === 'won'
          ? 'done'
          : status === 'lost'
            ? 'abandoned'
            : status === 'dormant'
              ? 'archived'
              : status === 'new'
                ? 'open'
                : 'in_progress'
      }
      title={enumLabel(status)}
    />
  )
}
