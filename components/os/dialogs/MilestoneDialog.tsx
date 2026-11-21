'use client'

import { useEffect, useState } from 'react'

import { fieldError, generalError, useObjectForm } from '@/lib/os/forms'
import { useCreate, useUpdate } from '@/lib/os/hooks'
import type { Milestone, MilestoneInput } from '@/lib/os/types'
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
import { EnumSelect, ProjectSelect } from '../pickers'

export const MILESTONE_SCOPE = ['/milestones', '/projects', '/dashboard', '/meta', '/activity']

interface MilestoneForm {
  project_id: string | null
  title: string
  date: string
  description: string
  status: string
}

/** Add/edit milestone — `project_id`, `title` and `date` are required by the API. */
export function MilestoneDialog({
  open,
  onOpenChange,
  milestone,
  projectId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  milestone?: Milestone | null
  /** Locks the project when the dialog is opened from a project page. */
  projectId?: string | null
  onSaved?: (milestone: Milestone, created: boolean) => void
}) {
  const editing = Boolean(milestone?.id)
  const lockedProject = projectId ?? milestone?.project_id ?? null
  const { values, patch, reset, setDirty } = useObjectForm<MilestoneForm>({
    project_id: lockedProject,
    title: '',
    date: '',
    description: '',
    status: 'open',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Milestone, MilestoneInput>('/milestones', {
    invalidates: MILESTONE_SCOPE,
  })
  const update = useUpdate<Milestone, MilestoneInput>(() => `/milestones/${milestone?.id}`, {
    invalidates: MILESTONE_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset({
      project_id: projectId ?? milestone?.project_id ?? null,
      title: milestone?.title ?? '',
      date: milestone?.date ?? '',
      description: milestone?.description ?? '',
      status: milestone?.status ?? 'open',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id, projectId])

  async function submit() {
    if (!values.title.trim()) {
      setLocalError('A milestone needs a title')
      return
    }
    if (!values.project_id) {
      setLocalError('Pick the project this milestone belongs to')
      return
    }
    if (!values.date) {
      setLocalError('A milestone needs a date')
      return
    }
    setLocalError(null)
    const payload: MilestoneInput = {
      project_id: values.project_id,
      title: values.title.trim(),
      date: values.date || null,
      description: values.description.trim() || null,
      status: values.status,
    }
    try {
      const saved = editing ? await update.mutate(payload) : await create.mutate(payload)
      setDirty(false)
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch {
      /* shown below */
    }
  }

  const banner = localError ?? generalError(error, ['title', 'date', 'project_id', 'status'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? 'Edit milestone' : 'New milestone'}
          description="Milestones drive the dashboard countdown and the project timeline."
        />
        <DialogBody className="space-y-4">
          {banner ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {banner}
            </p>
          ) : null}
          {!projectId ? (
            <Field label="Project" htmlFor="milestone-project" required>
              <ProjectSelect
                value={values.project_id}
                onChange={(project_id) => patch({ project_id })}
                placeholder="Choose a project"
              />
            </Field>
          ) : null}
          <Field label="Title" htmlFor="milestone-title" required>
            <Input
              id="milestone-title"
              autoFocus
              value={values.title}
              placeholder="Beta to first client"
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="milestone-date" required error={fieldError(error, 'date')}>
              <Input
                id="milestone-date"
                type="date"
                value={values.date}
                onChange={(event) => patch({ date: event.target.value })}
              />
            </Field>
            <Field label="Status">
              <EnumSelect
                value={values.status}
                onChange={(status) => patch({ status })}
                options={['open', 'done']}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="milestone-desc">
            <Textarea
              id="milestone-desc"
              rows={2}
              value={values.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save milestone' : 'Create milestone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
