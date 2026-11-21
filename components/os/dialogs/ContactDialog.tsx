'use client'

import { useEffect, useState } from 'react'

import { fieldError, generalError, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums, useUpdate } from '@/lib/os/hooks'
import type { Company, CompanyInput, Contact, ContactInput } from '@/lib/os/types'
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
import { CompanySelect, TagInput, useTagOptions } from '../pickers'

export const PEOPLE_SCOPE = ['/contacts', '/companies', '/dashboard', '/meta', '/search', '/activity']


interface ContactForm {
  name: string
  email: string
  phone: string
  title: string
  company_id: string | null
  location: string
  kind: string
  tags: string[]
  notes: string
}

function contactForm(contact?: Contact | null): ContactForm {
  return {
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    title: contact?.title ?? '',
    company_id: contact?.company_id ?? null,
    location: contact?.location ?? '',
    kind: contact?.kind ?? 'client',
    tags: contact?.tags ?? [],
    notes: contact?.notes ?? '',
  }
}

/** Create/edit contact — every writable field from the contact shape. */
export function ContactDialog({
  open,
  onOpenChange,
  contact,
  defaults,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: Contact | null
  defaults?: Partial<ContactForm>
  onSaved?: (contact: Contact, created: boolean) => void
}) {
  const tags = useTagOptions()
  // Kinds come from /meta: the API rejects anything outside the list it serves.
  const kinds = useEnums().enums.contact_kind
  const editing = Boolean(contact?.id)
  const { values, patch, reset, setDirty } = useObjectForm<ContactForm>(contactForm(contact))
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Contact, ContactInput>('/contacts', { invalidates: PEOPLE_SCOPE })
  const update = useUpdate<Contact, ContactInput>(() => `/contacts/${contact?.id}`, {
    invalidates: PEOPLE_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset({ ...contactForm(contact), ...(defaults ?? {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id, JSON.stringify(defaults ?? null)])

  async function submit() {
    if (!values.name.trim()) {
      setLocalError('A contact needs a name')
      return
    }
    setLocalError(null)
    const payload: ContactInput = {
      name: values.name.trim(),
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      title: values.title.trim() || null,
      company_id: values.company_id,
      location: values.location.trim() || null,
      kind: values.kind.trim() || null,
      tags: values.tags,
      notes: values.notes.trim() || null,
    }
    try {
      const saved = editing ? await update.mutate(payload) : await create.mutate(payload)
      setDirty(false)
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch {
      /* surfaced below */
    }
  }

  const banner = localError ?? generalError(error, ['name', 'email', 'phone', 'company_id'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? `Edit ${contact?.name}` : 'New contact'}
          description="Contacts are the CRM seed data — searchable from ⌘K and linkable from notes."
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="contact-name" required error={fieldError(error, 'name')}>
              <Input
                id="contact-name"
                autoFocus
                value={values.name}
                placeholder="Ravi Kumar"
                invalid={!!fieldError(error, 'name')}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field label="Relationship" htmlFor="contact-kind" hint="free text">
              <Input
                id="contact-kind"
                list="os-contact-kinds"
                value={values.kind}
                onChange={(event) => patch({ kind: event.target.value })}
              />
              <datalist id="os-contact-kinds">
                {kinds.map((kind) => (
                  <option key={kind} value={kind} />
                ))}
              </datalist>
            </Field>
            <Field label="Email" htmlFor="contact-email" error={fieldError(error, 'email')}>
              <Input
                id="contact-email"
                type="email"
                value={values.email}
                placeholder="ravi@example.com"
                invalid={!!fieldError(error, 'email')}
                onChange={(event) => patch({ email: event.target.value })}
              />
            </Field>
            <Field label="Phone" htmlFor="contact-phone">
              <Input
                id="contact-phone"
                type="tel"
                value={values.phone}
                placeholder="+91 …"
                onChange={(event) => patch({ phone: event.target.value })}
              />
            </Field>
            <Field label="Job title" htmlFor="contact-title">
              <Input
                id="contact-title"
                value={values.title}
                placeholder="CTO"
                onChange={(event) => patch({ title: event.target.value })}
              />
            </Field>
            <Field label="Company" htmlFor="contact-company">
              <CompanySelect
                value={values.company_id}
                onChange={(company_id) => patch({ company_id })}
              />
            </Field>
            <Field label="Location" htmlFor="contact-location" className="sm:col-span-2">
              <Input
                id="contact-location"
                value={values.location}
                placeholder="Bengaluru"
                onChange={(event) => patch({ location: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Tags">
            <TagInput
              value={values.tags}
              onChange={(tags2) => patch({ tags: tags2 })}
              suggestions={(tags.data ?? []).map((item) => item.tag)}
            />
          </Field>

          <Field label="Notes" htmlFor="contact-notes">
            <Textarea
              id="contact-notes"
              rows={3}
              value={values.notes}
              placeholder="Context you want to remember before the next call"
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
            {editing ? 'Save contact' : 'Create contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CompanyForm {
  name: string
  website: string
  industry: string
  location: string
  notes: string
}

/** Create/edit company — the counterpart panel on /contacts. */
export function CompanyDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  company?: Company | null
  onSaved?: (company: Company, created: boolean) => void
}) {
  const editing = Boolean(company?.id)
  const { values, patch, reset, setDirty } = useObjectForm<CompanyForm>({
    name: company?.name ?? '',
    website: company?.website ?? '',
    industry: company?.industry ?? '',
    location: company?.location ?? '',
    notes: company?.notes ?? '',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Company, CompanyInput>('/companies', { invalidates: PEOPLE_SCOPE })
  const update = useUpdate<Company, CompanyInput>(() => `/companies/${company?.id}`, {
    invalidates: PEOPLE_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset({
      name: company?.name ?? '',
      website: company?.website ?? '',
      industry: company?.industry ?? '',
      location: company?.location ?? '',
      notes: company?.notes ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company?.id])

  async function submit() {
    if (!values.name.trim()) {
      setLocalError('A company needs a name')
      return
    }
    setLocalError(null)
    const payload: CompanyInput = {
      name: values.name.trim(),
      website: values.website.trim() || null,
      industry: values.industry.trim() || null,
      location: values.location.trim() || null,
      notes: values.notes.trim() || null,
    }
    try {
      const saved = editing ? await update.mutate(payload) : await create.mutate(payload)
      setDirty(false)
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch {
      /* surfaced below */
    }
  }

  const banner = localError ?? generalError(error, ['name', 'website'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? `Edit ${company?.name}` : 'New company'}
          description="Companies group contacts and show up in search results."
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
          <Field label="Name" htmlFor="company-name" required error={fieldError(error, 'name')}>
            <Input
              id="company-name"
              autoFocus
              value={values.name}
              placeholder="Northwind"
              invalid={!!fieldError(error, 'name')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website" htmlFor="company-website">
              <Input
                id="company-website"
                type="url"
                inputMode="url"
                value={values.website}
                placeholder="https://…"
                onChange={(event) => patch({ website: event.target.value })}
              />
            </Field>
            <Field label="Industry" htmlFor="company-industry">
              <Input
                id="company-industry"
                value={values.industry}
                placeholder="fintech"
                onChange={(event) => patch({ industry: event.target.value })}
              />
            </Field>
            <Field label="Location" htmlFor="company-location" className="sm:col-span-2">
              <Input
                id="company-location"
                value={values.location}
                placeholder="Bengaluru"
                onChange={(event) => patch({ location: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor="company-notes">
            <Textarea
              id="company-notes"
              rows={3}
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
            {editing ? 'Save company' : 'Create company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
