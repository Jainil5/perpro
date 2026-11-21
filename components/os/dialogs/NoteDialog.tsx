'use client'

import { useEffect, useState } from 'react'

import { generalError, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums } from '@/lib/os/hooks'
import type { Note, NoteInput } from '@/lib/os/types'
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
import { CodeArea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import { EnumSelect, ProjectSelect, TagInput, useTagOptions } from '../pickers'

export const NOTE_SCOPE = ['/notes', '/note-tags', '/dashboard', '/meta', '/search', '/activity']

interface NoteForm {
  title: string
  content: string
  category: string
  tags: string[]
  project_id: string | null
  is_favorite: boolean
}

/**
 * Quick-create note. Editing an existing note happens in the /notes editor,
 * where the markdown source, preview, relations and backlinks live.
 */
export function NoteDialog({
  open,
  onOpenChange,
  defaults,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaults?: Partial<NoteForm>
  onSaved?: (note: Note) => void
}) {
  const { enums } = useEnums()
  const tags = useTagOptions()
  const { values, patch, reset, setDirty } = useObjectForm<NoteForm>({
    title: '',
    content: '',
    category: 'technical',
    tags: [],
    project_id: null,
    is_favorite: false,
  })
  const [localError, setLocalError] = useState<string | null>(null)
  const create = useCreate<Note, NoteInput>('/notes', { invalidates: NOTE_SCOPE })

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    reset({
      title: defaults?.title ?? '',
      content: defaults?.content ?? '',
      category: defaults?.category ?? 'technical',
      tags: defaults?.tags ?? [],
      project_id: defaults?.project_id ?? null,
      is_favorite: defaults?.is_favorite ?? false,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(defaults ?? null)])

  async function submit() {
    if (!values.title.trim()) {
      setLocalError('A note needs a title')
      return
    }
    setLocalError(null)
    try {
      const note = await create.mutate({
        title: values.title.trim(),
        content: values.content || null,
        category: values.category,
        tags: values.tags,
        project_id: values.project_id,
        is_favorite: values.is_favorite,
      })
      setDirty(false)
      onOpenChange(false)
      onSaved?.(note)
    } catch {
      /* shown below */
    }
  }

  const banner = localError ?? generalError(create.error, ['title', 'category'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="New note"
          description="Markdown is stored as written and rendered on the Notes screen."
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
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Title" htmlFor="note-title" required>
              <Input
                id="note-title"
                autoFocus
                value={values.title}
                placeholder="RLS patterns"
                onChange={(event) => patch({ title: event.target.value })}
              />
            </Field>
            <Field label="Category">
              <EnumSelect
                value={values.category}
                onChange={(category) => patch({ category })}
                options={enums.note_category}
              />
            </Field>
          </div>
          <Field label="Body" htmlFor="note-content" hint="markdown">
            <CodeArea
              id="note-content"
              className="min-h-[180px]"
              value={values.content}
              placeholder={'## Why\n\n…\n\n- [ ] follow-up'}
              onChange={(event) => patch({ content: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags">
              <TagInput
                value={values.tags}
                onChange={(next) => patch({ tags: next })}
                suggestions={(tags.data ?? []).map((item) => item.tag)}
              />
            </Field>
            <Field label="Project" hint="link the note to work">
              <ProjectSelect value={values.project_id} onChange={(project_id) => patch({ project_id })} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              checked={values.is_favorite}
              onCheckedChange={(next) => patch({ is_favorite: next === true })}
            />
            Mark as favorite
          </label>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.pending}
            className="rounded-os border border-line bg-transparent hover:bg-transparent"
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={create.pending} className="rounded-os">
            Create note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
