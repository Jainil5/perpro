'use client'

import { useEffect, useState } from 'react'

import { clampPercent, fieldError, generalError, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums, useUpdate } from '@/lib/os/hooks'
import type { Project, ProjectInput } from '@/lib/os/types'
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
import { EnumSelect } from '../pickers'
import { Progress } from '../ui/progress'

/** Cache prefixes every project write has to refresh. */
export const PROJECT_SCOPE = ['/projects', '/tasks', '/milestones', '/dashboard', '/meta', '/activity', '/search', '/notes']

interface ProjectForm {
  name: string
  description: string
  category: string
  status: string
  priority: string
  start_date: string
  target_date: string
  repository_url: string
  documentation_url: string
  next_action: string
  manual_progress: string
}

function emptyForm(defaults?: Partial<ProjectInput>): ProjectForm {
  return {
    name: defaults?.name ?? '',
    description: defaults?.description ?? '',
    category: defaults?.category ?? '',
    status: defaults?.status ?? 'planning',
    priority: defaults?.priority ?? 'medium',
    start_date: defaults?.start_date ?? '',
    target_date: defaults?.target_date ?? '',
    repository_url: defaults?.repository_url ?? '',
    documentation_url: defaults?.documentation_url ?? '',
    next_action: defaults?.next_action ?? '',
    manual_progress: String(defaults?.manual_progress ?? 0),
  }
}

function formFrom(project: Project): ProjectForm {
  return {
    name: project.name,
    description: project.description ?? '',
    category: project.category ?? '',
    status: project.status,
    priority: project.priority,
    start_date: project.start_date ?? '',
    target_date: project.target_date ?? '',
    repository_url: project.repository_url ?? '',
    documentation_url: project.documentation_url ?? '',
    next_action: project.next_action ?? '',
    manual_progress: String(project.manual_progress ?? 0),
  }
}

/**
 * Create/edit dialog covering every writable project field in API.md.
 * Derived values (`progress`, `task_counts`, `next_due`) are read-only here.
 */
export function ProjectDialog({
  open,
  onOpenChange,
  project,
  defaults,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project | null
  defaults?: Partial<ProjectInput>
  onSaved?: (project: Project, created: boolean) => void
}) {
  const { enums } = useEnums()
  const editing = Boolean(project?.id)
  const { values, patch, reset, dirty, setDirty } = useObjectForm<ProjectForm>(emptyForm(defaults))
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Project, ProjectInput>('/projects', { invalidates: PROJECT_SCOPE })
  const update = useUpdate<Project, ProjectInput>(() => `/projects/${project?.id}`, {
    invalidates: PROJECT_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset(project ? formFrom(project) : emptyForm(defaults))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, JSON.stringify(defaults ?? null)])

  const progress = clampPercent(Number(values.manual_progress))
  const autoProgress = project?.progress ?? 0

  async function submit() {
    if (!values.name.trim()) {
      setLocalError('A project needs a name')
      return
    }
    setLocalError(null)
    const payload: ProjectInput = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      category: values.category.trim() || null,
      status: values.status,
      priority: values.priority,
      start_date: values.start_date || null,
      target_date: values.target_date || null,
      repository_url: values.repository_url.trim() || null,
      documentation_url: values.documentation_url.trim() || null,
      next_action: values.next_action.trim() || null,
      manual_progress: progress,
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

  const banner =
    localError ??
    generalError(error, ['name', 'description', 'status', 'priority', 'target_date', 'manual_progress'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? `Edit ${project?.name ?? 'project'}` : 'New project'}
          description="Progress is calculated from tasks; the manual value is only used while a project has none."
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

          <Field label="Name" htmlFor="project-name" required error={fieldError(error, 'name')}>
            <Input
              id="project-name"
              autoFocus
              value={values.name}
              placeholder="OrderBook CRM"
              invalid={!!fieldError(error, 'name')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <Field label="Description" htmlFor="project-desc">
            <Textarea
              id="project-desc"
              rows={2}
              value={values.description}
              placeholder="What this project is for, in one or two sentences."
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <Field
            label="Next action"
            htmlFor="project-next"
            hint="the single next step, shown on the dashboard"
          >
            <Input
              id="project-next"
              value={values.next_action}
              placeholder="Send schema draft to Ravi"
              onChange={(event) => patch({ next_action: event.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <EnumSelect
                value={values.status}
                onChange={(status) => patch({ status })}
                options={enums.project_status}
              />
            </Field>
            <Field label="Priority">
              <EnumSelect
                value={values.priority}
                onChange={(priority) => patch({ priority })}
                options={enums.priority}
              />
            </Field>
            <Field label="Category" htmlFor="project-category" hint="free text, e.g. client">
              <Input
                id="project-category"
                value={values.category}
                placeholder="client"
                onChange={(event) => patch({ category: event.target.value })}
              />
            </Field>
            <Field label="Manual progress" htmlFor="project-manual" hint="percent">
              <div className="flex items-center gap-3">
                <input
                  id="project-manual"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(event) => patch({ manual_progress: event.target.value })}
                  className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--os-primary))] os-tap-none"
                  aria-label="Manual progress percentage"
                />
                <span className="os-num w-10 shrink-0 text-right text-xs">{progress}%</span>
              </div>
              {editing ? (
                <Progress
                  value={autoProgress}
                  showValue
                  size="sm"
                  className="pt-1"
                  label="Progress calculated from tasks"
                />
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="project-start">
              <Input
                id="project-start"
                type="date"
                value={values.start_date}
                onChange={(event) => patch({ start_date: event.target.value })}
              />
            </Field>
            <Field label="Target date" htmlFor="project-target" error={fieldError(error, 'target_date')}>
              <Input
                id="project-target"
                type="date"
                value={values.target_date}
                onChange={(event) => patch({ target_date: event.target.value })}
              />
            </Field>
            <Field label="Repository URL" htmlFor="project-repo">
              <Input
                id="project-repo"
                type="url"
                inputMode="url"
                value={values.repository_url}
                placeholder="https://github.com/…"
                onChange={(event) => patch({ repository_url: event.target.value })}
              />
            </Field>
            <Field label="Documentation URL" htmlFor="project-docs">
              <Input
                id="project-docs"
                type="url"
                inputMode="url"
                value={values.documentation_url}
                placeholder="https://www.notion.so/…"
                onChange={(event) => patch({ documentation_url: event.target.value })}
              />
            </Field>
          </div>

          <p className="text-[11px] text-faint">
            {dirty ? 'Unsaved changes' : 'Nothing changed yet'} · press ⌘↵ to save
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={pending}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            }}
          >
            {editing ? 'Save project' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
