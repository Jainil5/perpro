'use client'

import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/os/cn'
import { useResource } from '@/lib/os/hooks'
import { enumLabel } from '@/lib/os/format'
import type { Company, ListResponse, NoteTag, Project } from '@/lib/os/types'
import { Input } from './ui/input'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from './ui/select'

/** Every project in one request — pickers are deliberately small lists. */
export function useProjectOptions(enabled = true) {
  return useResource<ListResponse<Project>>(enabled ? '/projects' : null, { limit: 200, sort: 'name' })
}

export function useCompanyOptions(enabled = true) {
  return useResource<ListResponse<Company>>(enabled ? '/companies' : null, { limit: 200 })
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
      <SelectTrigger id={id} size={size} className={className}>
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
      <SelectTrigger id={id} className={className}>
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

/** Comma/Enter separated tag editor with chips and suggestions. */
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
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-input p-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {tag}
            <button
              type="button"
              className="os-tap-none grid size-4 place-items-center rounded text-faint hover:bg-accent hover:text-foreground"
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
          className="os-tap-none h-6 min-w-[8rem] flex-1 border-0 bg-transparent px-1 text-[13px] outline-none focus:ring-0"
        />
      </div>
      {filtered.length ? (
        <div className="flex flex-wrap gap-1">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add([tag])}
              className="os-tap-none rounded-md border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-accent hover:text-foreground"
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
      <SelectTrigger id={id} className={className}>
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

/** Multi-purpose small input used by filter toolbars. */
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
    <Input
      type="search"
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn('h-8 min-w-0 text-xs', className)}
    />
  )
}
