'use client'

import { useEffect, useMemo, useState } from 'react'

import { fieldError, generalError, numOrNull, useObjectForm } from '@/lib/os/forms'
import { useCreate, useEnums, useResource, useUpdate } from '@/lib/os/hooks'
import type { ListResponse, Task, TaskInput } from '@/lib/os/types'
import { cn } from '@/lib/os/cn'
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
import { CodeArea, Textarea } from '../ui/textarea'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '../ui/select'
import { EnumSelect, ProjectSelect, TagInput, useTagOptions } from '../pickers'
import { toastSuccess } from '../ui/toast'

/** Cache prefixes every task write has to refresh. */
export const TASK_SCOPE = ['/tasks', '/projects', '/dashboard', '/meta', '/activity', '/search']

interface TaskForm {
  title: string
  description: string
  notes: string
  project_id: string | null
  parent_task_id: string | null
  status: string
  priority: string
  due_date: string
  start_date: string
  estimated_minutes: string
  actual_minutes: string
  recurrence: string
  tags: string[]
}

function emptyForm(defaults?: Partial<TaskInput>): TaskForm {
  return {
    title: defaults?.title ?? '',
    description: defaults?.description ?? '',
    notes: defaults?.notes ?? '',
    project_id: defaults?.project_id ?? null,
    parent_task_id: defaults?.parent_task_id ?? null,
    status: defaults?.status ?? 'todo',
    priority: defaults?.priority ?? 'medium',
    due_date: defaults?.due_date ?? '',
    start_date: defaults?.start_date ?? '',
    estimated_minutes:
      defaults?.estimated_minutes != null ? String(defaults.estimated_minutes) : '',
    actual_minutes: defaults?.actual_minutes != null ? String(defaults.actual_minutes) : '',
    recurrence: defaults?.recurrence ?? 'none',
    tags: defaults?.tags ?? [],
  }
}

function formFrom(task: Task): TaskForm {
  return {
    title: task.title,
    description: task.description ?? '',
    notes: task.notes ?? '',
    project_id: task.project_id,
    parent_task_id: task.parent_task_id,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date ?? '',
    start_date: task.start_date ?? '',
    estimated_minutes: task.estimated_minutes != null ? String(task.estimated_minutes) : '',
    actual_minutes: task.actual_minutes != null ? String(task.actual_minutes) : '',
    recurrence: task.recurrence,
    tags: task.tags ?? [],
  }
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Create/edit dialog covering every writable task field in API.md, including
 * subtask link, recurrence, tags and estimated/actual minutes.
 */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaults,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: Task | null
  defaults?: Partial<TaskInput>
  onSaved?: (task: Task, created: boolean) => void
}) {
  const { enums } = useEnums()
  const tags = useTagOptions()
  const editing = Boolean(task?.id)
  const { values, patch, reset, dirty, setDirty } = useObjectForm<TaskForm>(emptyForm(defaults))
  const [localError, setLocalError] = useState<string | null>(null)

  const create = useCreate<Task, TaskInput>('/tasks', { invalidates: TASK_SCOPE })
  const update = useUpdate<Task, TaskInput>(() => `/tasks/${task?.id}`, {
    invalidates: TASK_SCOPE,
  })
  const pending = create.pending || update.pending
  const error = create.error ?? update.error

  // Recent tasks offered as the parent (subtask of) target.
  const candidates = useResource<ListResponse<Task>>(open ? '/tasks' : null, {
    limit: 100,
    sort: 'created',
  })
  const parentOptions = useMemo(
    () => (candidates.data?.items ?? []).filter((item) => item.id !== task?.id).slice(0, 60),
    [candidates.data, task?.id]
  )

  useEffect(() => {
    if (!open) return
    setLocalError(null)
    create.reset()
    update.reset()
    reset(task ? formFrom(task) : emptyForm(defaults))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id, JSON.stringify(defaults ?? null)])

  function validate(): string | null {
    if (!values.title.trim()) return 'A task needs a title'
    if (values.start_date && values.due_date && values.start_date > values.due_date)
      return 'Start date cannot be after the due date'
    return null
  }

  function body(): TaskInput {
    return {
      title: values.title.trim(),
      description: values.description.trim() || null,
      notes: values.notes.trim() || null,
      project_id: values.project_id,
      parent_task_id: values.parent_task_id,
      status: values.status,
      priority: values.priority,
      due_date: values.due_date || null,
      start_date: values.start_date || null,
      estimated_minutes: numOrNull(values.estimated_minutes),
      actual_minutes: numOrNull(values.actual_minutes),
      recurrence: values.recurrence,
      tags: values.tags,
    }
  }

  async function submit() {
    const problem = validate()
    setLocalError(problem)
    if (problem) return
    try {
      const payload = body()
      const saved = editing
        ? await update.mutate(payload)
        : await create.mutate(payload)
      toastSuccess(editing ? 'Task saved' : 'Task created', { description: saved.title })
      setDirty(false)
      onOpenChange(false)
      onSaved?.(saved, !editing)
    } catch {
      /* shown by SoftError + field messages below */
    }
  }

  const fields = ['title', 'description', 'notes', 'due_date', 'estimated_minutes']
  const banner = localError ?? generalError(error, fields)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={editing ? 'Edit task' : 'New task'}
          description={
            editing
              ? 'Everything here is stored on the task record.'
              : 'Only the title is required — the rest is optional.'
          }
        />
        <DialogBody className="space-y-4">
          {banner ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {banner}
            </p>
          ) : null}
          <Field
            label="Title"
            htmlFor="task-title"
            required
            error={fieldError(error, 'title')}
          >
            <Input
              id="task-title"
              autoFocus
              value={values.title}
              placeholder="Write migration notes"
              invalid={!!fieldError(error, 'title')}
              onChange={(event) => patch({ title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <EnumSelect
                value={values.status}
                onChange={(status) => patch({ status })}
                options={enums.task_status}
              />
            </Field>
            <Field label="Priority">
              <EnumSelect
                value={values.priority}
                onChange={(priority) => patch({ priority })}
                options={enums.priority}
              />
            </Field>
            <Field label="Project" hint="links the task">
              <ProjectSelect
                value={values.project_id}
                onChange={(project_id) => patch({ project_id })}
              />
            </Field>
            <Field label="Subtask of" hint="optional parent">
              <Select
                value={values.parent_task_id ?? '__none'}
                onValueChange={(next) =>
                  patch({ parent_task_id: next === '__none' ? null : next })
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={candidates.loading ? 'Loading tasks…' : 'Not a subtask'}
                  />
                </SelectTrigger>
                <SelectContent>
                  <Option value="__none">Not a subtask</Option>
                  {parentOptions.map((item) => (
                    <Option key={item.id} value={item.id}>
                      {item.title}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date" htmlFor="task-due" error={fieldError(error, 'due_date')}>
              <Input
                id="task-due"
                type="date"
                value={values.due_date}
                onChange={(event) => patch({ due_date: event.target.value })}
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  { label: 'Today', value: addDays(0) },
                  { label: 'Tomorrow', value: addDays(1) },
                  { label: 'In a week', value: addDays(7) },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => patch({ due_date: chip.value })}
                    className="os-tap-none rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {chip.label}
                  </button>
                ))}
                {values.due_date ? (
                  <button
                    type="button"
                    onClick={() => patch({ due_date: '' })}
                    className="os-tap-none rounded-md border border-line px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </Field>
            <Field label="Start date" htmlFor="task-start">
              <Input
                id="task-start"
                type="date"
                value={values.start_date}
                onChange={(event) => patch({ start_date: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estimate" htmlFor="task-estimate" hint="minutes">
              <Input
                id="task-estimate"
                inputMode="numeric"
                value={values.estimated_minutes}
                placeholder="90"
                onChange={(event) => patch({ estimated_minutes: event.target.value })}
              />
            </Field>
            <Field label="Actual" htmlFor="task-actual" hint="minutes">
              <Input
                id="task-actual"
                inputMode="numeric"
                value={values.actual_minutes}
                onChange={(event) => patch({ actual_minutes: event.target.value })}
              />
            </Field>
            <Field label="Recurrence" hint="creates the next one on completion">
              <EnumSelect
                value={values.recurrence}
                onChange={(recurrence) => patch({ recurrence })}
                options={enums.recurrence}
              />
            </Field>
          </div>

          <Field label="Tags" hint="enter or comma-separate">
            <TagInput
              value={values.tags}
              onChange={(next) => patch({ tags: next })}
              suggestions={(tags.data ?? []).map((item) => item.tag)}
            />
          </Field>

          <Field label="Description" htmlFor="task-desc" error={fieldError(error, 'description')}>
            <Textarea
              id="task-desc"
              rows={2}
              value={values.description}
              placeholder="What does done look like?"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>

          <details className={cn('group rounded-lg border border-line px-3 py-2')}>
            <summary className="cursor-pointer list-none text-[11px] uppercase tracking-wide text-muted-foreground">
              Notes (private, not shown in lists)
            </summary>
            <CodeArea
              className="mt-2 min-h-[120px]"
              value={values.notes}
              placeholder="Links, decisions, context…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </details>

          <p className="text-[11px] text-faint">
            {dirty ? 'Unsaved changes' : 'Nothing changed yet'} · press ⌘↵ to save
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            {editing ? 'Save task' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
