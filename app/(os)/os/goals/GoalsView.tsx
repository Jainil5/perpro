'use client'

import Link from 'next/link'
import { Target, Trash2, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage, ERROR_CODES, type OsApiError } from '@/lib/os/client'
import { invalidate, useEnums, useResource } from '@/lib/os/hooks'
import { countLabel, daysUntil, dueLabel, enumLabel, formatDate, formatPercent } from '@/lib/os/format'
import type { Goal, GoalInput, ListResponse } from '@/lib/os/types'
import { cn } from '@/lib/os/cn'
import { Button, IconButton } from '@/components/os/ui/button'
import { Card, Panel } from '@/components/os/ui/card'
import { Badge, PriorityBadge, toneFor } from '@/components/os/ui/badge'
import { Progress } from '@/components/os/ui/progress'
import { Input } from '@/components/os/ui/input'
import { Textarea } from '@/components/os/ui/textarea'
import { Field } from '@/components/os/ui/label'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/os/ui/dialog'
import { EmptyBlock, ErrorBlock, LoadingCards } from '@/components/os/states'
import { FilterBar, FilterChip } from '@/components/os/filters'
import { ProjectSelect } from '@/components/os/pickers'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { blankToNull, clampPercent, dateInputValue, numOrNull, useObjectForm } from '@/lib/os/forms'

const GOAL_SCOPE = ['/goals', '/dashboard', '/meta', '/activity']
/** Statuses that mean "this one is finished with", so a past target is not red. */
const CLOSED_STATUSES = ['completed', 'abandoned']
const GOAL_STATUS_TONE: Record<string, 'primary' | 'success' | 'outline'> = {
  active: 'primary',
  completed: 'success',
  achieved: 'success',
  abandoned: 'outline',
  paused: 'outline',
}
const ALL = '__all'
/** Keys that mean "the slider is where I want it". */
const COMMIT_KEYS = ['Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

/** Progress that a missing endpoint cannot fake: this mirrors the API verb list. */
export default function GoalsView() {
  const { enums } = useEnums()
  const statuses = enums.goal_status
  const [status, setStatus] = useState<string>(ALL)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [deleting, setDeleting] = useState<Goal | null>(null)

  const goals = useResource<ListResponse<Goal>>('/goals', {
    status: status === ALL ? undefined : status,
  })

  const missing = goals.error?.code === ERROR_CODES.notFound || goals.error?.status === 404

  const items = goals.data?.items ?? []

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="os-eyebrow">Personal</p>
          <h1 className="os-title">Goals</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {goals.loading && !goals.data
              ? 'Loading…'
              : goals.data
                ? `${countLabel(goals.data.total, 'goal', 'goals')} · progress is yours to set, the link is the project's`
                : 'Outcome goals, with the outcome written down'}
          </p>
        </div>
        <Button
          size="sm"
          disabled={missing}
          onClick={() => {
            setEditing(null)
            setDialog(true)
          }}
        >
          <Plus /> New goal
        </Button>
      </header>

      <FilterBar>
        <FilterChip active={status === ALL} onClick={() => setStatus(ALL)}>
          All
        </FilterChip>
        {statuses.map((value) => (
          <FilterChip
            key={value}
            active={status === value}
            onClick={() => setStatus(status === value ? ALL : value)}
          >
            {enumLabel(value)}
          </FilterChip>
        ))}
      </FilterBar>

      {missing ? (
        <ErrorBlock
          error={goals.error as OsApiError}
          onRetry={goals.reload}
          title="This API has no /goals endpoints yet"
          className="border-line bg-muted/40"
        />
      ) : goals.error && !goals.data ? (
        <ErrorBlock error={goals.error} onRetry={goals.reload} />
      ) : !goals.data ? (
        <LoadingCards count={3} />
      ) : items.length ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => {
                setEditing(goal)
                setDialog(true)
              }}
              onDelete={() => setDeleting(goal)}
              onProgress={(progress) =>
                api<Goal>(`/goals/${goal.id}`, { method: 'PATCH', body: { progress } })
                  .then(() => {
                    invalidate(...GOAL_SCOPE)
                    goals.reload()
                  })
                  .catch((e) => toastError(errorMessage(e, 'Could not save progress')))
              }
            />
          ))}
        </div>
      ) : (
        <EmptyBlock
          title="No goals yet"
          description="A goal is an outcome with a date and a number. Write it down, link the project it belongs to, then move the slider as the work actually happens."
          icon={<Target className="size-5" />}
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialog(true)
              }}
            >
              <Plus /> New goal
            </Button>
          }
        />
      )}

      <Panel dense title="How progress works" description="Written by you, not derived">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Progress is a number between 0 and 100 that you own. Linking a goal to a project does not
          copy that project's percentage — it gives the goal a home, and the link is the API's own:
          delete the project and the goal stays, with the link cleared. Drag the slider on a card and
          it saves the moment you let go; only a status change closes a goal out.
        </p>
      </Panel>

      <GoalDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) setEditing(null)
        }}
        goal={editing}
        onSaved={(goal, created) => {
          invalidate(...GOAL_SCOPE)
          goals.reload()
          toastSuccess(created ? 'Goal created' : 'Goal saved', { description: goal.title })
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.title ?? 'goal'}`}
        description="Deleting a goal leaves its linked project and that project's tasks exactly as they are."
        confirmLabel="Delete goal"
        onConfirm={() =>
          api(`/goals/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            invalidate(...GOAL_SCOPE)
            goals.reload()
            toastSuccess('Goal deleted')
          })
        }
      />
    </div>
  )
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
  onProgress,
}: {
  goal: Goal
  onEdit: () => void
  onDelete: () => void
  onProgress: (progress: number) => void
}) {
  const [draft, setDraft] = useState(goal.progress)
  const [busy, setBusy] = useState(false)
  const left = daysUntil(goal.target_date)
  const late = !CLOSED_STATUSES.includes(goal.status) && left != null && left < 0

  useEffect(() => {
    setDraft(goal.progress)
  }, [goal.progress])

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">{goal.title}</p>
          {goal.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {goal.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={`Edit ${goal.title}`} size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`Delete ${goal.title}`} size="icon-sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Badge tone={toneFor(GOAL_STATUS_TONE, goal.status)} size="sm">
            {enumLabel(goal.status)}
          </Badge>
          <span className="os-num text-[11px] text-muted-foreground">{formatPercent(draft)}</span>
        </div>
        <Progress value={draft} label={`Progress: ${formatPercent(draft)}`} />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft}
          aria-label={`Progress for ${goal.title}`}
          onChange={(event) => setDraft(clampPercent(numOrNull(event.target.value)))}
          onMouseUp={() => {
            if (draft === goal.progress) return
            setBusy(true)
            onProgress(draft)
            setBusy(false)
          }}
          onTouchEnd={() => {
            if (draft === goal.progress) return
            setBusy(true)
            onProgress(draft)
            setBusy(false)
          }}
          onKeyUp={(event) => {
            if (!COMMIT_KEYS.includes(event.key)) return
            if (draft === goal.progress) return
            onProgress(draft)
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px]">
        {goal.target_date ? (
          <span className={cn('os-num', late ? 'text-destructive' : 'text-muted-foreground')}>
            {late ? 'past target · ' : ''}
            {dueLabel(goal.target_date)}
          </span>
        ) : (
          <span className="text-faint">no target date</span>
        )}
        {goal.project ? (
          <Link
            href={`/os/projects/${goal.project.id}`}
            className="min-w-0 truncate underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {goal.project.name}
          </Link>
        ) : (
          <span className="text-faint">no project</span>
        )}
        {goal.category ? <Badge tone="neutral" size="sm">{enumLabel(goal.category)}</Badge> : null}
        <PriorityBadge value={goal.priority} />
        <span className="os-num ml-auto text-faint">{formatDate(goal.updated_at)}</span>
      </div>
      {busy ? <p className="text-[11px] text-faint">Saving progress…</p> : null}
    </Card>
  )
}

function GoalDialog({
  open,
  onOpenChange,
  goal,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  goal: Goal | null
  onSaved: (goal: Goal, created: boolean) => void
}) {
  const { enums } = useEnums()
  const statuses = enums.goal_status
  const editing = Boolean(goal?.id)
  const { values, patch, reset, dirty, setDirty } = useObjectForm<GoalInput>({
    title: '',
    description: null,
    category: null,
    priority: 'medium',
    status: 'active',
    progress: 0,
    target_date: null,
    project_id: null,
  })
  const [localError, setLocalError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    reset({
      title: goal?.title ?? '',
      description: goal?.description ?? null,
      category: goal?.category ?? null,
      priority: goal?.priority ?? 'medium',
      status: goal?.status ?? 'active',
      progress: goal?.progress ?? 0,
      target_date: goal?.target_date ?? null,
      project_id: goal?.project_id ?? null,
    })
    setDirty(false)
    setLocalError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id])

  function submit() {
    if (!values.title.trim()) {
      setLocalError('A goal needs a title.')
      return
    }
    setLocalError(null)
    setPending(true)
    const body: GoalInput = { ...values, title: values.title.trim() }
    api<Goal>(editing ? `/goals/${goal?.id}` : '/goals', {
      method: editing ? 'PATCH' : 'POST',
      body,
    })
      .then((saved) => {
        onSaved(saved, !editing)
        onOpenChange(false)
      })
      .catch((e) => setLocalError(errorMessage(e)))
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit goal' : 'New goal'}
          description="Keep it to one outcome you can point at."
        />
        <DialogBody className="space-y-3">
          <Field label="Title" required error={localError && !values.title.trim() ? localError : null}>
            <Input
              value={values.title}
              onChange={(event) => {
                patch({ title: event.target.value })
                setDirty(true)
              }}
              placeholder="Ship MyOS phase 1"
            />
          </Field>

          <Field label="Why this matters">
            <Textarea
              rows={3}
              value={values.description ?? ''}
              onChange={(event) => {
                patch({ description: blankToNull(event.target.value) })
                setDirty(true)
              }}
              placeholder="What changes if this is done?"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">
              <Select
                value={values.status ?? 'active'}
                onValueChange={(next) => {
                  patch({ status: next })
                  setDirty(true)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((value) => (
                    <Option key={value} value={value}>
                      {enumLabel(value)}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Target date">
              <Input
                type="date"
                value={dateInputValue(values.target_date)}
                onChange={(event) => {
                  patch({ target_date: blankToNull(event.target.value) })
                  setDirty(true)
                }}
              />
            </Field>
          </div>

          <Field label="Progress" hint={`${formatPercent(values.progress ?? 0)} · drag or type`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={values.progress ?? 0}
                aria-label="Progress"
                onChange={(event) => {
                  patch({ progress: clampPercent(numOrNull(event.target.value)) })
                  setDirty(true)
                }}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={String(values.progress ?? 0)}
                onChange={(event) => {
                  patch({ progress: clampPercent(numOrNull(event.target.value)) })
                  setDirty(true)
                }}
                className="w-20"
                aria-label="Progress percent"
              />
            </div>
          </Field>

          <Field label="Linked project" hint="Optional — choosing “No project” detaches it">
            <ProjectSelect
              value={values.project_id ?? null}
              onChange={(next) => {
                patch({ project_id: next })
                setDirty(true)
              }}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" hint="Free text — it is not an enum">
              <Input
                value={values.category ?? ''}
                onChange={(event) => {
                  patch({ category: blankToNull(event.target.value) })
                  setDirty(true)
                }}
                placeholder="learning"
              />
            </Field>

            <Field label="Priority">
              <Select
                value={values.priority ?? 'medium'}
                onValueChange={(next) => {
                  patch({ priority: next })
                  setDirty(true)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enums.priority.map((value) => (
                    <Option key={value} value={value}>
                      {enumLabel(value)}
                    </Option>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {localError && values.title.trim() ? (
            <p role="alert" className="text-xs text-destructive">
              {localError}
            </p>
          ) : null}
          <p className="text-[11px] text-faint">
            {dirty ? 'Unsaved changes' : 'Nothing to save yet'}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {editing ? 'Save goal' : 'Create goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

