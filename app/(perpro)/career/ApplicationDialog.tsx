'use client'

import { useEffect, useState } from 'react'

import { blankToNull, mergeFieldErrors, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums, useUpdate } from '@/lib/os/hooks'
import { CAREER_PATHS, CAREER_SCOPE, salaryBandError } from '@/lib/os/career'
import type { JobApplication, JobApplicationInput } from '@/lib/os/career'
import { errorMessage } from '@/lib/os/client'
import { moneyInputError, parseMoney } from '@/lib/os/currency'
import { enumLabel, todayDate } from '@/lib/os/format'
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
import { CheckboxRow } from '@/components/os/ui/checkbox'
import { CompanySelect, ContactSelect, EnumSelect } from '@/components/os/pickers'
import { toastSuccess } from '@/components/os/ui/toast'

interface ApplicationForm {
  role_title: string
  company_id: string | null
  contact_id: string | null
  channel: string
  url: string
  status: string
  salary_min: string
  salary_max: string
  location: string
  remote: boolean
  applied_at: string
  next_action: string
  next_action_date: string
  notes: string
}

function blank(): ApplicationForm {
  return {
    role_title: '',
    company_id: null,
    contact_id: null,
    channel: 'referral',
    url: '',
    status: 'saved',
    salary_min: '',
    salary_max: '',
    location: '',
    remote: false,
    applied_at: '',
    next_action: '',
    next_action_date: '',
    notes: '',
  }
}

function fromRow(row: JobApplication): ApplicationForm {
  return {
    role_title: row.role_title,
    company_id: row.company_id,
    contact_id: row.contact_id,
    channel: row.channel ?? 'referral',
    url: row.url ?? '',
    status: row.status,
    salary_min: row.salary_min === null || row.salary_min === undefined ? '' : String(row.salary_min),
    salary_max: row.salary_max === null || row.salary_max === undefined ? '' : String(row.salary_max),
    location: row.location ?? '',
    remote: row.remote,
    applied_at: row.applied_at ?? '',
    next_action: row.next_action ?? '',
    next_action_date: row.next_action_date ?? '',
    notes: row.notes ?? '',
  }
}

/**
 * Every writable field on a job application, in one form.
 *
 * Status is deliberately *not* editable when an existing row is opened: moving an application
 * is a state-machine step with its own endpoint (`POST /job-applications/{id}/transition`), and
 * the detail sheet is where it belongs — the board offers the same move in one drag. Letting a
 * form jump a row from `saved` to `offer` would either fail with a 409 the user cannot predict
 * or quietly teach them that the funnel is decoration.
 */
export function ApplicationDialog({
  open,
  onOpenChange,
  row,
  defaults,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  row?: JobApplication | null
  /** Used when the row is created from a company, a contact or a listing already on screen. */
  defaults?: Partial<JobApplicationInput>
  currency: string
  onSaved?: (row: JobApplication, created: boolean) => void
}) {
  const { enums } = useEnums()
  const editing = Boolean(row?.id)
  const { values, patch, reset, dirty } = useObjectForm<ApplicationForm>(blank())
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const create = useCreate<JobApplication, JobApplicationInput>(CAREER_PATHS.applications, {
    invalidates: [...CAREER_SCOPE],
  })
  const update = useUpdate<JobApplication, JobApplicationInput>(
    () => `${CAREER_PATHS.applications}/${row?.id}`,
    { invalidates: [...CAREER_SCOPE] }
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
        ...blank(),
        company_id: defaults?.company_id ?? null,
        contact_id: defaults?.contact_id ?? null,
        channel: defaults?.channel ?? 'referral',
        url: defaults?.url ?? '',
        location: defaults?.location ?? '',
        remote: defaults?.remote ?? false,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.role_title.trim()) {
      next.role_title = 'What is the role called? Copy it from the listing if you can'
    }
    const min = moneyInputError(values.salary_min, { min: 0 })
    if (min) next.salary_min = min
    const max = moneyInputError(values.salary_max, { min: 0 })
    if (max) next.salary_max = max
    if (!next.salary_min && !next.salary_max) {
      const band = salaryBandError(parseMoney(values.salary_min), parseMoney(values.salary_max))
      if (band) next.salary_max = band
    }
    if (values.url && !/^https?:\/\/\S+$/i.test(values.url.trim())) {
      next.url = 'A full link, starting with http:// or https://'
    }
    if (values.applied_at && values.applied_at > todayDate()) {
      next.applied_at = 'You cannot have applied in the future'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: JobApplicationInput = {
      role_title: values.role_title.trim(),
      company_id: values.company_id,
      contact_id: values.contact_id,
      channel: blankToNull(values.channel),
      url: blankToNull(values.url),
      salary_min: parseMoney(values.salary_min),
      salary_max: parseMoney(values.salary_max),
      location: blankToNull(values.location),
      remote: values.remote,
      applied_at: blankToNull(values.applied_at),
      next_action: blankToNull(values.next_action),
      next_action_date: blankToNull(values.next_action_date),
      notes: blankToNull(values.notes),
    }
    // A new row says where it entered the funnel; an edit never touches status (see above).
    if (!editing) body.status = values.status as JobApplicationInput['status']
    try {
      const saved = editing ? await update.mutate(body) : await create.mutate(body)
      toastSuccess(editing ? 'Application saved' : 'Application added', {
        description: `${saved.role_title}${saved.company?.name ? ` · ${saved.company.name}` : ''}`,
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

  const channels = enums.job_application_channel ?? [
    'referral',
    'job_board',
    'recruiter',
    'website',
    'event',
    'other',
  ]
  /** A new row can only enter at the top of the funnel — the board does the rest. */
  const entryStatuses = (enums.job_application_status ?? ['saved', 'applied']).filter((status) =>
    status === 'saved' || status === 'applied'
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? `Edit ${row?.role_title ?? 'application'}` : 'New application'}
          description="One row per role you have applied to. The funnel itself is moved from the board or the row’s detail sheet, so nothing here can put the role backwards."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <Field
            label="Role title"
            htmlFor="application-role"
            required
            error={issues.role_title ?? null}
          >
            <Input
              id="application-role"
              autoFocus
              value={values.role_title}
              placeholder="Senior Product Engineer"
              invalid={Boolean(issues.role_title)}
              onChange={(event) => patch({ role_title: event.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" htmlFor="application-company" hint="companies live under People">
              <CompanySelect
                id="application-company"
                value={values.company_id}
                onChange={(company_id) => patch({ company_id })}
              />
            </Field>
            <Field
              label="Person you are dealing with"
              htmlFor="application-contact"
              hint="recruiter, hiring manager, the one who referred you"
            >
              <ContactSelect
                id="application-contact"
                value={values.contact_id}
                onChange={(contact_id) => patch({ contact_id })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How you found it" htmlFor="application-channel">
              <EnumSelect
                id="application-channel"
                value={values.channel}
                onChange={(channel) => patch({ channel })}
                options={channels}
              />
            </Field>
            {editing ? (
              <Field label="Status" hint="move it on the board, or from its detail sheet">
                <p className="os-mono flex h-9 items-center text-[12.5px] text-muted-foreground">
                  {enumLabel(values.status)}
                </p>
              </Field>
            ) : (
              <Field label="Starting status" htmlFor="application-status" hint="where it enters the funnel">
                <EnumSelect
                  id="application-status"
                  value={values.status}
                  onChange={(status) => patch({ status })}
                  options={entryStatuses.length ? entryStatuses : ['saved', 'applied']}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Field
              label="Salary from"
              htmlFor="application-salary-min"
              hint={`in ${currency}, stored exactly as you write it`}
              error={issues.salary_min ?? null}
            >
              <Input
                id="application-salary-min"
                inputMode="decimal"
                value={values.salary_min}
                placeholder="1800000"
                invalid={Boolean(issues.salary_min)}
                onChange={(event) => patch({ salary_min: event.target.value })}
              />
            </Field>
            <Field
              label="Salary to"
              htmlFor="application-salary-max"
              hint="the top of the advertised band"
              error={issues.salary_max ?? null}
            >
              <Input
                id="application-salary-max"
                inputMode="decimal"
                value={values.salary_max}
                placeholder="2400000"
                invalid={Boolean(issues.salary_max)}
                onChange={(event) => patch({ salary_max: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location" htmlFor="application-location">
              <Input
                id="application-location"
                value={values.location}
                placeholder="Bengaluru / Remote"
                onChange={(event) => patch({ location: event.target.value })}
              />
            </Field>
            <CheckboxRow
              id="application-remote"
              label="Remote"
              checked={values.remote}
              onCheckedChange={(remote) => patch({ remote })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applied on" htmlFor="application-applied" error={issues.applied_at ?? null}>
              <Input
                id="application-applied"
                type="date"
                value={values.applied_at}
                invalid={Boolean(issues.applied_at)}
                onChange={(event) => patch({ applied_at: event.target.value })}
              />
            </Field>
            <Field label="Listing URL" htmlFor="application-url" error={issues.url ?? null}>
              <Input
                id="application-url"
                type="url"
                inputMode="url"
                value={values.url}
                placeholder="https://…"
                invalid={Boolean(issues.url)}
                onChange={(event) => patch({ url: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Field
              label="Next action"
              htmlFor="application-next"
              hint="the single next step, e.g. “follow up with Priya”"
            >
              <Input
                id="application-next"
                value={values.next_action}
                placeholder="Follow up on the referral"
                onChange={(event) => patch({ next_action: event.target.value })}
              />
            </Field>
            <Field label="By" htmlFor="application-next-date">
              <Input
                id="application-next-date"
                type="date"
                value={values.next_action_date}
                onChange={(event) => patch({ next_action_date: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor="application-notes">
            <Textarea
              id="application-notes"
              rows={3}
              value={values.notes}
              placeholder="What the role is about, who said what, why you want it…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          <p className="os-micro">
            {dirty ? 'Unsaved changes' : 'Nothing changed yet'} · salary bands are annual and stay in{' '}
            {currency}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save application' : 'Add application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
