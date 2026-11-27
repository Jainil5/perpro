'use client'

import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { useResource } from '@/lib/os/hooks'
import { enumLabel } from '@/lib/os/format'
import type { Company, Contact, ListResponse, NoteTag, Project } from '@/lib/os/types'
import type { Client } from '@/lib/os/crm'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from './ui/select'

/** Every project in one request — pickers are deliberately small lists. */
export function useProjectOptions(enabled = true) {
  return useResource<ListResponse<Project>>(enabled ? '/projects' : null, { limit: 200, sort: 'name' })
}

export function useCompanyOptions(enabled = true) {
  return useResource<ListResponse<Company>>(enabled ? '/companies' : null, { limit: 200 })
}

/** People are picked by id in Phase 2 (recruiter, hiring manager, lead contact, client contact). */
export function useContactOptions(enabled = true) {
  return useResource<ListResponse<Contact>>(enabled ? '/contacts' : null, { limit: 200, sort: 'name' })
}

/** Accounts are picked by id for income rows and subscriptions (Phase 2 anchors the money to a client). */
export function useClientOptions(enabled = true) {
  return useResource<ListResponse<Client>>(enabled ? '/clients' : null, { limit: 200, sort: 'name' })
}

export function useTagOptions(enabled = true) {
  return useResource<NoteTag[]>(enabled ? '/note-tags' : null)
}

export function ProjectSelect({
  value,
  onChange,
  id,
  size = 'md',
  placeholder = 'No project',
  disabled,
  className,
}: {
  value: string | null
  onChange: (next: string | null) => void
  id?: string
  size?: 'sm' | 'md'
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const projects = useProjectOptions()
  return (
    <Select
      value={value ?? '__none'}
      onValueChange={(next) => onChange(next === '__none' ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn('rounded-os bg-transparent', className)}
      >
        <SelectValue placeholder={projects.loading ? 'Loading projects…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <Option value="__none">{placeholder}</Option>
        {(projects.data?.items ?? []).map((project) => (
          <Option key={project.id} value={project.id}>
            {project.name}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CompanySelect({
  value,
  onChange,
  id,
  placeholder = 'No company',
  disabled,
  className,
}: {
  value: string | null
  onChange: (next: string | null) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const companies = useCompanyOptions()
  return (
    <Select
      value={value ?? '__none'}
      onValueChange={(next) => onChange(next === '__none' ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn('rounded-os bg-transparent', className)}>
        <SelectValue placeholder={companies.loading ? 'Loading companies…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <Option value="__none">{placeholder}</Option>
        {(companies.data?.items ?? []).map((company) => (
          <Option key={company.id} value={company.id}>
            {company.name}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A person picker over the whole contact list. Empty list says where to add people
 * rather than presenting an unexplained blank dropdown.
 */
export function ContactSelect({
  value,
  onChange,
  id,
  placeholder = 'No person',
  emptyLabel,
  disabled,
  className,
}: {
  value: string | null
  onChange: (next: string | null) => void
  id?: string
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
}) {
  const contacts = useContactOptions()
  const rows = contacts.data?.items ?? []
  return (
    <Select
      value={value ?? '__none'}
      onValueChange={(next) => onChange(next === '__none' ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn('rounded-os bg-transparent', className)}>
        <SelectValue placeholder={contacts.loading ? 'Loading people…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <Option value="__none">{placeholder}</Option>
        {rows.length === 0 && !contacts.loading ? (
          <Option value="__empty" disabled>
            {emptyLabel ?? 'No contacts yet — add them under People'}
          </Option>
        ) : null}
        {rows.map((contact) => (
          <Option key={contact.id} value={contact.id}>
            {contact.name}
            {contact.company ? ` · ${contact.company}` : ''}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Account picker over `/clients`. A client's display name is resolved by the API (company, else
 * contact), so the option shows what the CRM screens show; `hint` adds the stage so two accounts
 * with similar names stay distinguishable.
 */
export function ClientSelect({
  value,
  onChange,
  id,
  placeholder = 'No account',
  emptyLabel,
  disabled,
  className,
}: {
  value: string | null
  onChange: (next: string | null) => void
  id?: string
  placeholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
}) {
  const clients = useClientOptions()
  const rows = clients.data?.items ?? []
  return (
    <Select
      value={value ?? '__none'}
      onValueChange={(next) => onChange(next === '__none' ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn('rounded-os bg-transparent', className)}>
        <SelectValue placeholder={clients.loading ? 'Loading accounts…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <Option value="__none">{placeholder}</Option>
        {rows.length === 0 && !clients.loading ? (
          <Option value="__empty" disabled>
            {emptyLabel ?? 'No accounts yet — win a lead under CRM'}
          </Option>
        ) : null}
        {rows.map((client) => (
          <Option key={client.id} value={client.id}>
            {client.name || 'Untitled account'}
            {client.stage && client.stage !== 'active' ? ` · ${enumLabel(client.stage)}` : ''}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Multi-pick over people, for `interviewer_ids`. Hairline chips rather than a native
 * multiselect: one tap toggles, and the chosen set is legible without scrolling a
 * list box. Ordering is selection order, which is how the round's panel reads.
 */
export function ContactMultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Nobody picked',
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  options: Array<{ id: string; name: string }>
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      {options.length === 0 ? <span className="os-micro">{placeholder}</span> : null}
      {options.map((option) => {
        const picked = value.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={picked}
            onClick={() =>
              onChange(picked ? value.filter((v) => v !== option.id) : [...value, option.id])
            }
            className={cn(
              'os-tap-none rounded-os border px-1.5 py-0.5 text-[11px] transition-colors',
              picked
                ? 'border-line-strong text-foreground'
                : 'border-line text-faint hover:border-line-strong hover:text-muted-foreground'
            )}
          >
            {option.name}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Comma/Enter separated tag editor. The field is the line: a bottom hairline
 * that brightens to ink on focus; tags are hairline text chips, never fills.
 */
export function TagInput({
  value,
  onChange,
  id,
  suggestions = [],
  placeholder = 'Type a tag, press Enter',
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  id?: string
  suggestions?: string[]
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const filtered = useMemo(() => {
    const term = draft.trim().toLowerCase()
    return suggestions
      .filter((tag) => !value.some((v) => v.toLowerCase() === tag.toLowerCase()))
      .filter((tag) => (term ? tag.toLowerCase().includes(term) : true))
      .slice(0, 6)
  }, [draft, suggestions, value])

  /** Adds any new, de-duplicated tags in one state write. */
  function add(raws: string[]) {
    const existing = new Set(value.map((v) => v.toLowerCase()))
    const additions: string[] = []
    for (const raw of raws) {
      const tag = raw.trim().replace(/^#/, '')
      if (!tag || existing.has(tag.toLowerCase())) continue
      existing.add(tag.toLowerCase())
      additions.push(tag)
    }
    if (additions.length) onChange([...value, ...additions])
    setDraft('')
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-line pb-1.5 transition-colors focus-within:border-foreground">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-os border border-line px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {tag}
            <button
              type="button"
              className="os-tap-none grid size-4 place-items-center text-faint transition-colors hover:text-foreground"
              onClick={() => onChange(value.filter((v) => v !== tag))}
              aria-label={`Remove tag ${tag}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => {
            const raw = event.target.value
            if (raw.includes(',')) {
              const parts = raw.split(',')
              add(parts.slice(0, -1))
              setDraft(parts.at(-1) ?? '')
              return
            }
            setDraft(raw)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add([draft])
            } else if (event.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => add([draft])}
          placeholder={value.length ? '' : placeholder}
          aria-label="Tags"
          className="os-tap-none h-6 min-w-[8rem] flex-1 rounded-none border-0 bg-transparent px-1 text-[13px] text-foreground outline-none"
        />
      </div>
      {filtered.length ? (
        <div className="flex flex-wrap gap-1.5">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add([tag])}
              className="os-tap-none rounded-os border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:border-line-strong hover:text-foreground"
            >
              + {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A plain `<select>`-style enum picker built on the Radix primitive. */
export function EnumSelect({
  value,
  onChange,
  options,
  id,
  disabled,
  className,
}: {
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  id?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn('rounded-os bg-transparent', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <Option key={option} value={option}>
            {enumLabel(option)}
          </Option>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Multi-purpose small input used by filter toolbars. A bare input: the token
 * CSS already restyles it as transparent with a bottom hairline.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  autoFocus,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <input
      type="search"
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn('os-tap-none h-8 w-full min-w-0 rounded-none text-xs text-foreground', className)}
    />
  )
}
