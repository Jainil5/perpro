'use client'

import { useEffect, useState } from 'react'

import { blankToNull, dateInputValue, mergeFieldErrors, numOrNull, parseTags, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums, useUpdate } from '@/lib/os/hooks'
import {
  CLIENT_HEALTH,
  CLIENT_STAGES,
  CRM_PATHS,
  CRM_SCOPE,
  type Client,
  type ClientInput,
} from '@/lib/os/crm'
import { errorMessage } from '@/lib/os/client'
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
import { CompanySelect, ContactSelect, EnumSelect, TagInput } from '@/components/os/pickers'
import { toastSuccess } from '@/components/os/ui/toast'

interface ClientForm {
  contact_id: string | null
  company_id: string | null
  stage: string
  health: string
  contract_start: string
  contract_end: string
  renewal_reminder_days: string
  tags: string[]
  notes: string
}

function blank(): ClientForm {
  return {
    contact_id: null,
    company_id: null,
    stage: 'onboarding',
    health: 'unknown',
    contract_start: '',
    contract_end: '',
    renewal_reminder_days: '30',
    tags: [],
    notes: '',
  }
}

function fromRow(row: Client): ClientForm {
  return {
    contact_id: row.contact_id,
    company_id: row.company_id,
    stage: row.stage,
    health: row.health,
    contract_start: dateInputValue(row.contract_start),
    contract_end: dateInputValue(row.contract_end),
    renewal_reminder_days:
      row.renewal_reminder_days === null || row.renewal_reminder_days === undefined
        ? ''
        : String(row.renewal_reminder_days),
    tags: row.tags ?? [],
    notes: row.notes ?? '',
  }
}

/**
 * Open or edit an account.
 *
 * There is no name field, on purpose: `clients` points at people, and the name the API prints is
 * the company's, else the contact's. So an account has to be attached to at least one of them —
 * the same rule the server enforces with a 422 that names both fields, which is why the form checks
 * it before sending rather than after.
 *
 * `mrr` is not a field either. It is derived from the account's live subscriptions, so the way to
 * change it is to add a subscription under Money.
 */
export function ClientDialog({
  open,
  onOpenChange,
  row,
  defaults,
  tagSuggestions = [],
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  row?: Client | null
  /** Prefill when the account is opened from a company or a person already on screen. */
  defaults?: Partial<ClientInput>
  tagSuggestions?: string[]
  onSaved?: (row: Client, created: boolean) => void
}) {
  const { enums } = useEnums()
  const editing = Boolean(row?.id)
  const { values, patch, reset, dirty } = useObjectForm<ClientForm>(blank())
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const create = useCreate<Client, ClientInput>(CRM_PATHS.clients, { invalidates: [...CRM_SCOPE] })
  const update = useUpdate<Client, ClientInput>(
    () => `${CRM_PATHS.clients}/${row?.id}`,
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
        ...blank(),
        contact_id: defaults?.contact_id ?? null,
        company_id: defaults?.company_id ?? null,
        stage: defaults?.stage ?? 'onboarding',
        health: defaults?.health ?? 'unknown',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id])

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!values.contact_id && !values.company_id) {
      // The server answers with two `details` entries naming both fields; this says it once, first.
      next.contact_id = 'An account is a person or a company — pick at least one'
      next.company_id = 'or pick a company'
    }
    if (values.contract_start && values.contract_end && values.contract_end < values.contract_start) {
      next.contract_end = 'The contract cannot end before it starts'
    }
    if (values.contract_end && values.contract_start === '' && !editing) {
      next.contract_start = 'An end date needs a start date to count down from'
    }
    const days = numOrNull(values.renewal_reminder_days)
    // §12's CHECK is 0..180, and the server answers outside it with a 422 on this field.
    if (days !== null && (days < 0 || days > 180)) {
      next.renewal_reminder_days = '0–180 days, or leave it empty'
    }
    if (values.contract_end && days === null && values.stage !== 'archived') {
      next.renewal_reminder_days = 'Say how many days ahead to warn you, or the countdown never fires'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setPending(true)
    setFormError(null)
    const body: ClientInput = {
      contact_id: values.contact_id,
      company_id: values.company_id,
      stage: values.stage as ClientInput['stage'],
      health: values.health as ClientInput['health'],
      contract_start: blankToNull(values.contract_start),
      contract_end: blankToNull(values.contract_end),
      renewal_reminder_days: numOrNull(values.renewal_reminder_days),
      tags: parseTags(values.tags),
      notes: blankToNull(values.notes),
    }
    try {
      const saved = editing ? await update.mutate(body) : await create.mutate(body)
      toastSuccess(editing ? 'Account saved' : 'Account opened', {
        description: saved.name || 'A client with no person or company left to name it',
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

  const stages = enums.client_stage ?? CLIENT_STAGES
  const healths = enums.client_health ?? CLIENT_HEALTH

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? `Edit ${row?.name || 'account'}` : 'New account'}
          description="Winning a lead creates this record automatically. Create one by hand only for work that arrived without a funnel — the person or company it belongs to is the account."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <p role="alert" className="rounded-os border border-line px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Company"
              htmlFor="client-company"
              error={issues.company_id ?? null}
              hint="the name an account prints is its company's, else its contact's"
            >
              <CompanySelect
                id="client-company"
                value={values.company_id}
                onChange={(company_id) => patch({ company_id })}
              />
            </Field>
            <Field
              label="Person"
              htmlFor="client-contact"
              required={!values.company_id}
              error={issues.contact_id ?? null}
              hint="who signs, or who you actually talk to"
            >
              <ContactSelect
                id="client-contact"
                value={values.contact_id}
                onChange={(contact_id) => patch({ contact_id })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stage" htmlFor="client-stage" hint="an account's state, not a funnel step">
              <EnumSelect
                id="client-stage"
                value={values.stage}
                onChange={(stage) => patch({ stage })}
                options={stages}
              />
            </Field>
            <Field
              label="Health"
              htmlFor="client-health"
              hint="green, amber, red — the one place colour means judgement here"
            >
              <EnumSelect
                id="client-health"
                value={values.health}
                onChange={(health) => patch({ health })}
                options={healths}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contract starts" htmlFor="client-start" error={issues.contract_start ?? null}>
              <Input
                id="client-start"
                type="date"
                value={values.contract_start}
                invalid={Boolean(issues.contract_start)}
                onChange={(event) => patch({ contract_start: event.target.value })}
              />
            </Field>
            <Field
              label="Contract ends"
              htmlFor="client-end"
              error={issues.contract_end ?? null}
              hint="dated contracts are what make a renewal warning real"
            >
              <Input
                id="client-end"
                type="date"
                min={values.contract_start || todayDate()}
                value={values.contract_end}
                invalid={Boolean(issues.contract_end)}
                onChange={(event) => patch({ contract_end: event.target.value })}
              />
            </Field>
          </div>

          <Field
            label="Warn me this many days before the end"
            htmlFor="client-reminder"
            error={issues.renewal_reminder_days ?? null}
            hint="it is what the renewal countdown and the contract-end notification use"
          >
            <Input
              id="client-reminder"
              inputMode="numeric"
              value={values.renewal_reminder_days}
              invalid={Boolean(issues.renewal_reminder_days)}
              onChange={(event) => patch({ renewal_reminder_days: event.target.value })}
            />
          </Field>

          <Field
            label="Tags"
            htmlFor="client-tags"
            hint="one tag list across the whole OS; the table filters by ?tag="
          >
            <TagInput
              id="client-tags"
              value={values.tags}
              onChange={(tags) => patch({ tags })}
              suggestions={tagSuggestions}
            />
          </Field>

          <Field label="Notes" htmlFor="client-notes">
            <Textarea
              id="client-notes"
              rows={3}
              value={values.notes}
              placeholder="What is agreed, what is out of scope, who else is involved…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>

          <p className="os-micro">
            {dirty ? 'Unsaved changes' : 'Nothing changed yet'} · monthly revenue is derived from
            live subscriptions under Money, never typed here
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save account' : 'Open account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
