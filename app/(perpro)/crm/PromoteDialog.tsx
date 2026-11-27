'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useEnums } from '@/lib/os/hooks'
import { blankToNull, dateInputValue, mergeFieldErrors } from '@/lib/os/forms'
import {
  CLIENT_HEALTH,
  CLIENT_STAGES,
  type ClientHealth,
  type ClientStage,
  CRM_SCOPE,
  leadPromotePath,
  type LeadPromoteInput,
  type LeadPromoteResult
} from '@/lib/os/crm'
import { enumLabel } from '@/lib/os/format'
import { OsApiError } from '@/lib/os/client'
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
import { EnumSelect, TagInput } from '@/components/os/pickers'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

/**
 * Win a lead and open the account in one call.
 *
 * `POST /leads/{id}/promote` creates the client from the lead's contact or company — and when the
 * lead names neither, the API creates a contact from the lead's own name and email, so the account
 * always has a name. The overrides here are the only part of that new client the UI can decide:
 * stage, health, the contract window, tags and notes. Everything else (`mrr`, the derived
 * `name`) is the server's answer, which is why none of it is a field.
 *
 * A second promote is refused with 409, because two accounts for one customer is exactly the
 * mistake a CRM is supposed to prevent — the reason is surfaced verbatim, with a link to the
 * account that already exists when the lead detail knows about it.
 */
export function PromoteDialog({
  open,
  onOpenChange,
  lead,
  workspaceCurrency,
  onDone,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  lead: { id: string; name: string; client?: { id: string; name: string } | null } | null
  workspaceCurrency: string
  onDone?: (result: LeadPromoteResult) => void
}) {
  const { enums } = useEnums()
  const [stage, setStage] = useState('onboarding')
  const [health, setHealth] = useState('unknown')
  const [contractStart, setContractStart] = useState('')
  const [contractEnd, setContractEnd] = useState('')
  const [reminderDays, setReminderDays] = useState('30')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setStage('onboarding')
    setHealth('unknown')
    setContractStart(dateInputValue(new Date().toISOString()))
    setContractEnd('')
    setReminderDays('30')
    setTags([])
    setNotes('')
    setIssues({})
    setFormError(null)
  }, [open, lead?.id])

  function validate(): boolean {
    const next: Record<string, string> = {}
    const days = Number(reminderDays)
    // §12's CHECK is 0..180, and the server answers outside it with a 422 on this field.
    if (reminderDays !== '' && (!Number.isFinite(days) || days < 0 || days > 180)) {
      next.reminder_days = '0–180 days, or leave it empty'
    }
    if (contractStart && contractEnd && contractEnd < contractStart) {
      next.contract_end = 'The contract cannot end before it starts'
    }
    setIssues(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!lead || !validate()) return
    setPending(true)
    setFormError(null)
    // `extra="forbid"`: these seven keys are the whole contract. `name` is derived by the API
    // (company, else contact, else the contact it creates from this lead), so it is not a field.
    const body: LeadPromoteInput = {
      stage: stage as ClientStage,
      health: health as ClientHealth,
      contract_start: blankToNull(contractStart),
      contract_end: blankToNull(contractEnd),
      renewal_reminder_days: reminderDays === '' ? null : Number(reminderDays),
      tags: tags.length ? tags : null,
      notes: blankToNull(notes),
    }
    try {
      const result = await api<LeadPromoteResult>(leadPromotePath(lead.id), {
        method: 'POST',
        body,
      })
      invalidate(...CRM_SCOPE)
      toastSuccess('Account opened', {
        description: `${result.client.name} · ${enumLabel(result.client.stage)} · ${lead.name} is now won`,
      })
      onOpenChange(false)
      onDone?.(result)
    } catch (error) {
      const message = errorMessage(error)
      setFormError(message)
      setIssues((prev) => mergeFieldErrors(error, prev))
      if (error instanceof OsApiError && error.status === 409) {
        toastError('That lead is already an account', { description: message })
      }
    } finally {
      setPending(false)
    }
  }

  const stages = enums.client_stage ?? CLIENT_STAGES
  const healths = enums.client_health ?? CLIENT_HEALTH

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={`Win “${lead?.name ?? 'lead'}”`}
          description="This creates the client record and closes the lead as won — one transaction, so the pipeline cannot say won while the accounts screen says nothing."
        />
        <DialogBody className="space-y-4">
          {formError ? (
            <div className="space-y-2 rounded-os border border-line px-3 py-2 text-xs">
              <p role="alert" className="text-danger">
                {formError}
              </p>
              {lead?.client ? (
                <Link
                  href={`/customers?client=${lead.client.id}`}
                  className="underline underline-offset-2"
                >
                  Open {lead.client.name}
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Stage" htmlFor="promote-stage" hint="what the account is doing right now">
              <EnumSelect id="promote-stage" value={stage} onChange={setStage} options={stages} />
            </Field>
            <Field label="Health" htmlFor="promote-health" hint="leave it unknown until there is a reason">
              <EnumSelect id="promote-health" value={health} onChange={setHealth} options={healths} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contract starts" htmlFor="promote-start" error={issues.contract_start ?? null}>
              <Input
                id="promote-start"
                type="date"
                value={contractStart}
                invalid={Boolean(issues.contract_start)}
                onChange={(event) => setContractStart(event.target.value)}
              />
            </Field>
            <Field
              label="Contract ends"
              htmlFor="promote-end"
              error={issues.contract_end ?? null}
              hint="a dated contract is what makes the renewal warning real"
            >
              <Input
                id="promote-end"
                type="date"
                value={contractEnd}
                invalid={Boolean(issues.contract_end)}
                onChange={(event) => setContractEnd(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Remind me before it ends"
            htmlFor="promote-reminder"
            error={issues.reminder_days ?? null}
            hint="days ahead of the end date"
          >
            <Input
              id="promote-reminder"
              inputMode="numeric"
              value={reminderDays}
              invalid={Boolean(issues.reminder_days)}
              onChange={(event) => setReminderDays(event.target.value)}
            />
          </Field>

          <Field
            label="Tags"
            htmlFor="promote-tags"
            hint="shared with the rest of the OS — one tag list, filtered by ?tag="
          >
            <TagInput id="promote-tags" value={tags} onChange={setTags} />
          </Field>

          <Field label="Notes" htmlFor="promote-notes" hint="what was agreed, in the words you would repeat back">
            <Textarea
              id="promote-notes"
              rows={3}
              value={notes}
              placeholder="Scope, the rate that was agreed, what is out of scope…"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          <p className={cn('os-micro')}>
            the account's name comes from the lead's company, else its contact, else a contact
            created from the lead itself · money still lives in {workspaceCurrency} until a
            subscription says otherwise
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            Win and open the account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

