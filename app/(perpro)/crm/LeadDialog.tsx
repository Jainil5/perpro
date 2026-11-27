'use client'

import { useEffect, useState } from 'react'

import {
  blankToNull,
  dateInputValue,
  mergeFieldErrors,
  numOrNull,
  useObjectForm,
} from '@/lib/os/forms'
import { useCreate, useEnums, useUpdate } from '@/lib/os/hooks'
import { CRM_PATHS, CRM_SCOPE, leadPath } from '@/lib/os/crm'
import type { Lead, LeadInput, LeadStatus } from '@/lib/os/crm'
import { errorMessage } from '@/lib/os/client'
import { moneyInputError, parseMoney } from '@/lib/os/currency'
import { enumLabel } from '@/lib/os/format'
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
import { AmountField, CurrencySelect } from '@/components/os/finance'
import { CompanySelect, ContactSelect, EnumSelect } from '@/components/os/pickers'
import { toastSuccess } from '@/components/os/ui/toast'
import { cn } from '@/lib/os/cn'

interface LeadForm {
  name: string
  contact_id: string | null
  company_id: string | null
  email: string
  origin: string
  status: string
  score: string
  estimated_value: string
  currency: string
  next_touch_at: string
  lost_reason: string
  notes: string
}

function blank(workspaceCurrency: string): LeadForm {
  return {
    name: '',
    contact_id: null,
    company_id: null,
    email: '',
    origin: '',
    status: 'new',
    score: '',
    estimated_value: '',
    currency: workspaceCurrency,
    next_touch_at: '',
    lost_reason: '',
    notes: '',
  }
}

function fromRow(row: Lead): LeadForm {
  return {
    name: row.name,
    contact_id: row.contact_id,
    company_id: row.company_id,
    email: row.email ?? '',
    origin: row.origin ?? '',
    status: row.status,
    score: row.score === null || row.score === undefined ? '' : String(row.score),
    estimated_value:
      row.estimated_value === null || row.estimated_value === undefined
        ? ''
        : String(row.estimated_value),
    currency: row.currency ?? '',
    next_touch_at: dateInputValue(row.next_touch_at),
    lost_reason: row.lost_reason ?? '',
    notes: row.notes ?? '',
  }
}

/** Day-offset chips for the follow-up date: the three answers that cover most "when do I call". */
const TOUCH_CHIPS: Array<{ label: string; days: number }> = [
  { label: 'today', days: 0 },
  { label: 'in 3 days', days: 3 },
  { label: 'next week', days: 7 },
]

function touchValue(days: number): string {
  const at = new Date()
  at.setDate(at.getDate() + days)
  // A date, not a timestamp: `next_touch_at` is a DATE column, so the day is the whole answer.
  return dateInputValue(at.toISOString())
}

/**
 * Add or edit a lead.
 *
 * Like the application form, status is not editable on an existing row: a lead moves through
 * `POST /leads/{id}/transition`, which is also what stamps `last_touch_at` and writes the activity
 * row. A form that could set `won` directly would either 409 unpredictably or win an account
 * without the client record that winning is supposed to create.
 */
export function LeadDialog({
  open,
  onOpenChange,
  row,
  defaults,
  workspaceCurrency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  row?: Lead | null
  /** Prefill when the lead arrives from a contact, a company or a listing already on screen. */
  defaults?: Partial<LeadInput>
  workspaceCurrency: string
  onSaved?: (row: Lead, created: boolean) => void
}) {
  const { enums } = useEnums()
  const editing = Boolean(row?.id)
  const { values, patch, reset, dirty } = useObjectForm<LeadForm>(blank(workspaceCurrency))
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const create = useCreate<Lead, LeadInput>(CRM_PATHS.leads, { invalidates: [...CRM_SCOPE] })
  const update = useUpdate<Lead, LeadInput>(
    () => leadPath(row?.id ?? ''),
    { invalidates: [...CRM_SCOPE] }
  )

  useEffect(() => {
    if (!open) return
    setIssues({})
    setFormError(null)
    create.reset()
    update.reset()
    if (row) {
      reset(fromRow(row))
    } else {
      reset({
        ...blank(workspaceCurrency),
        name: defaults?.name ?? '',
        contact_id: defaults?.contact_id ?? null,
        company_id: defaults?.company_id ?? null,
        email: defaults?.email ?? '',
        origin: defaults?.origin ?? '',
        status: defaults?.status ?? 'new',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.name.trim()) {
      next.name = 'Who is it? A company, a person, or the project they mentioned'
    }
    if (values.email.trim() && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(values.email.trim())) {
      next.email = 'That is not an email address'
    }
    const score = numOrNull(values.score)
    if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) {
      next.score = 'Score is 0–100'
    }
    const value = moneyInputError(values.estimated_value, { min: 0 })
    if (value) next.estimated_value = value
    if (values.lost_reason.length > 500) {
      next.lost_reason = 'Keep it to a sentence — the reason is quoted, not read'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: LeadInput = {
      name: values.name.trim(),
      contact_id: values.contact_id,
      company_id: values.company_id,
      // A blank email is null, not an error — the API says so explicitly.
      email: blankToNull(values.email),
      origin: blankToNull(values.origin),
      score: numOrNull(values.score),
      estimated_value: parseMoney(values.estimated_value),
      currency: blankToNull(values.currency),
      // The field's `YYYY-MM-DD` is the body; blank means no follow-up planned.
      next_touch_at: blankToNull(values.next_touch_at),
      notes: blankToNull(values.notes),
    }
    // A new row says where it enters the funnel; an edit never touches status (see above).
    if (!editing) body.status = values.status as LeadStatus
    if (row?.status === 'lost') body.lost_reason = blankToNull(values.lost_reason)
    try {
      const saved = editing ? await update.mutate(body) : await create.mutate(body)
      toastSuccess(editing ? 'Lead saved' : 'Lead added', {
        description: saved.name,
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

  const origins = enums.lead_origin ?? [
    'referral',
    'inbound',
    'outbound',
    'event',
    'content',
    'marketplace',
    'other',
  ]
  /** Only the top of the funnel is a starting point; the rest are moves. */
  const entryStatuses = (enums.lead_status ?? ['new', 'contacted']).filter(
    (status) => status === 'new' || status === 'contacted'
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? `Edit ${row?.name ?? 'lead'}` : 'New lead'}
          description="A lead is anybody you have not closed yet — a reply to a post, a referral, a brief that went quiet. Winning it is a separate, deliberate step that creates the account."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <Field label="Name" htmlFor="lead-name" required error={issues.name ?? null}>
            <Input
              id="lead-name"
              autoFocus
              value={values.name}
              placeholder="Northwind redesign, or the person who asked"
              invalid={Boolean(issues.name)}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Person"
              htmlFor="lead-contact"
              hint="optional — winning the lead can create one for you"
            >
              <ContactSelect
                id="lead-contact"
                value={values.contact_id}
                onChange={(contact_id) => patch({ contact_id })}
              />
            </Field>
            <Field label="Company" htmlFor="lead-company" hint="optional">
              <CompanySelect
                id="lead-company"
                value={values.company_id}
                onChange={(company_id) => patch({ company_id })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="lead-email" error={issues.email ?? null}>
              <Input
                id="lead-email"
                type="email"
                value={values.email}
                placeholder="they@company.com"
                invalid={Boolean(issues.email)}
                onChange={(event) => patch({ email: event.target.value })}
              />
            </Field>
            <Field
              label="Where it came from"
              htmlFor="lead-origin"
              hint="no default — a source you did not pick stays unset"
            >
              <EnumSelect
                id="lead-origin"
                value={values.origin}
                onChange={(origin) => patch({ origin })}
                options={['', ...origins]}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {editing ? (
              <Field label="Status" hint="move it on the board, or from its card">
                <p className="os-mono flex h-9 items-center text-[12.5px] text-muted-foreground">
                  {enumLabel(values.status)}
                </p>
              </Field>
            ) : (
              <Field label="Starting status" htmlFor="lead-status">
                <EnumSelect
                  id="lead-status"
                  value={values.status}
                  onChange={(status) => patch({ status })}
                  options={entryStatuses.length ? entryStatuses : ['new', 'contacted']}
                />
              </Field>
            )}
            <Field
              label="Score"
              htmlFor="lead-score"
              hint="0–100, how likely it is to land — it weights the pipeline total"
              error={issues.score ?? null}
            >
              <Input
                id="lead-score"
                inputMode="numeric"
                value={values.score}
                placeholder="60"
                invalid={Boolean(issues.score)}
                onChange={(event) => patch({ score: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <AmountField
              label="Estimated value"
              id="lead-value"
              value={values.estimated_value}
              onChange={(estimated_value) => patch({ estimated_value })}
              currency={values.currency || null}
              min={0}
              hint="what the job is worth if it lands"
            />
            <CurrencySelect
              value={values.currency}
              onChange={(currency) => patch({ currency })}
              label="Currency"
              id="lead-currency"
              hint="a value with no code is booked in your workspace currency"
            />
          </div>

          {values.estimated_value && !values.currency ? (
            <p className="os-micro text-warning">
              No currency named — the API will record this in {workspaceCurrency}.
            </p>
          ) : null}

          <Field
            label="Next touch"
            htmlFor="lead-next-touch"
            hint="when you intend to follow up — overdue means this date has passed"
          >
            <Input
              id="lead-next-touch"
              type="date"
              value={values.next_touch_at}
              onChange={(event) => patch({ next_touch_at: event.target.value })}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <span className="os-label mr-1">Quick set</span>
            {TOUCH_CHIPS.map((chip) => {
              const active = values.next_touch_at === touchValue(chip.days)
              return (
                <button
                  key={chip.days}
                  type="button"
                  onClick={() => patch({ next_touch_at: touchValue(chip.days) })}
                  aria-pressed={active}
                  className={cn(
                    'os-tap-none rounded-os border px-1.5 py-0.5 text-[11px] transition-colors',
                    active
                      ? 'border-line-strong text-foreground'
                      : 'border-line text-faint hover:border-line-strong hover:text-muted-foreground'
                  )}
                >
                  {chip.label}
                </button>
              )
            })}
            {values.next_touch_at ? (
              <button
                type="button"
                onClick={() => patch({ next_touch_at: '' })}
                className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-line-strong hover:text-foreground"
              >
                clear
              </button>
            ) : null}
          </div>

          {row?.status === 'lost' ? (
            <Field
              label="Why it was lost"
              htmlFor="lead-lost-reason"
              error={issues.lost_reason ?? null}
              hint="the reason is kept on the row and quoted in the win/loss line"
            >
              <Input
                id="lead-lost-reason"
                value={values.lost_reason}
                invalid={Boolean(issues.lost_reason)}
                onChange={(event) => patch({ lost_reason: event.target.value })}
              />
            </Field>
          ) : null}

          <Field label="Notes" htmlFor="lead-notes">
            <Textarea
              id="lead-notes"
              rows={3}
              value={values.notes}
              placeholder="What they asked for, what you said, who else is in the conversation…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          <p className="os-micro">{dirty ? 'Unsaved changes' : 'Nothing changed yet'}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save lead' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
