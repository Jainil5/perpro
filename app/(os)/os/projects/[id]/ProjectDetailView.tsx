'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  FolderGit2,
  List,
  LayoutGrid,
  Milestone as MilestoneIcon,
  Pencil,
  Undo2,
  Plus,
  Table as TableIcon,
  Target,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useResource } from '@/lib/os/hooks'
import {
  countLabel,
  daysUntil,
  dueLabel,
  DUE_TONE_TEXT,
  dueTone,
  enumLabel,
  formatDate,
  formatNumber,
  formatPercent,
  relativeTime,
} from '@/lib/os/format'
import { isActiveProject } from '@/lib/os/enums'
import type {
  ActivityLog,
  ListResponse,
  Milestone,
  Project,
  ProjectStats,
  Task,
} from '@/lib/os/types'
import { Button, IconButton } from '@/components/os/ui/button'
import { Card, Panel } from '@/components/os/ui/card'
import { Badge, PriorityBadge, PROJECT_STATUS_TONE, StatusBadge } from '@/components/os/ui/badge'
import { Progress } from '@/components/os/ui/progress'
import { BucketBar, Stat } from '@/components/os/ui/stats'
import { Separator } from '@/components/os/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/os/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/os/ui/table'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterChip, FilterBar, ViewToggle } from '@/components/os/filters'
import { TaskList } from '@/components/os/TaskRow'
import { TaskBoard } from '@/components/os/TaskBoard'
import { ActivityTimeline } from '@/components/os/ActivityTimeline'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { MilestoneDialog } from '@/components/os/dialogs/MilestoneDialog'
import { ProjectDialog } from '@/components/os/dialogs/ProjectDialog'
import { TaskDialog } from '@/components/os/dialogs/TaskDialog'
import { toastSuccess } from '@/components/os/ui/toast'
import { cn } from '@/lib/os/cn'

const PROJECT_SCOPE = ['/projects', '/tasks', '/milestones', '/dashboard', '/meta', '/activity', '/search']

export default function ProjectDetailView({ id }: { id: string }) {
  const [dialog, setDialog] = useState(false)
  const [taskDialog, setTaskDialog] = useState(false)
  const [milestoneDialog, setMilestoneDialog] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)
  const [view, setView] = useState<'board' | 'list' | 'table'>('board')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const router = useRouter()

  const project = useResource<Project>(`/projects/${id}`)
  const stats = useResource<ProjectStats>(`/projects/${id}/stats`)
  const tasks = useResource<ListResponse<Task>>('/tasks', { project_id: id, sort: 'due', limit: 200 })
  const milestones = useResource<ListResponse<Milestone>>('/milestones', { project_id: id })
  const activity = useResource<ListResponse<ActivityLog>>('/activity', { project_id: id, limit: 60 })

  const reload = useCallback(() => {
    project.reload()
    stats.reload()
    tasks.reload()
  }, [project, stats, tasks])

  const rows = useMemo(() => {
    const all = tasks.data?.items ?? []
    return onlyOpen ? all.filter((task) => task.status !== 'done' && task.status !== 'dropped') : all
  }, [tasks.data, onlyOpen])

  const timeline = useMemo(() => {
    const all = milestones.data?.items ?? []
    return [...all].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  }, [milestones.data])

  return (
    <div className="os-enter space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/os/projects"
          className="inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All projects
        </Link>
        <span className="text-faint">/</span>
        <span className="truncate text-foreground">{project.data?.name ?? 'Loading…'}</span>
      </div>

      <ResourceState
        resource={project}
        skeleton={<LoadingBlock rows={4} label="Loading project…" />}
        empty={
          <EmptyBlock
            title="No project here"
            description="This id returned nothing. The project may have been deleted."
            action={
              <Link href="/os/projects" className="text-xs">
                Back to projects
              </Link>
            }
          />
        }
      >
        {(data) => (
          <>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="os-title truncate">{data.name}</h1>
                  {data.description ? (
                    <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                      {data.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <StatusBadge value={data.status} table={PROJECT_STATUS_TONE} />
                    <PriorityBadge value={data.priority} />
                    {data.category ? <Badge tone="outline">{data.category}</Badge> : null}
                    <span className="os-num text-faint">
                      target {data.target_date ? formatDate(data.target_date) : 'not set'}
                      {daysUntil(data.target_date) != null
                        ? ` · ${daysUntil(data.target_date)! <= 0 ? 'overdue' : 'on track'}`
                        : ''}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button size="sm" onClick={() => setDialog(true)}>
                    <Pencil /> Edit
                  </Button>
                  <IconButton label="Delete project" size="icon-sm" onClick={() => setDeleting(true)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="os-eyebrow">Progress</span>
                    <span className="os-num text-muted-foreground">
                      {formatPercent(data.progress)} ·{' '}
                      {data.manual_progress !== data.progress
                        ? `manual ${formatPercent(data.manual_progress)}`
                        : 'from tasks'}
                    </span>
                  </div>
                  <Progress value={data.progress} label={`Progress: ${formatPercent(data.progress)}`} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
                    <Stat label="Tasks" value={formatNumber(data.task_counts.total)} />
                    <Stat label="Open" value={formatNumber(data.task_counts.open)} tone="primary" />
                    <Stat
                      label="Overdue"
                      value={formatNumber(data.task_counts.overdue)}
                      tone={data.task_counts.overdue ? 'danger' : 'default'}
                    />
                    <Stat
                      label="Milestones"
                      value={`${formatNumber(data.milestones_done)}/${formatNumber(data.milestone_count)}`}
                    />
                  </div>
                </div>

                <NextActionPanel
                  nextAction={data.next_action}
                  nextDue={data.next_due}
                  onEdit={() => setDialog(true)}
                  href={`/os/tasks?project=${data.id}`}
                />
              </div>

              {data.repository_url || data.documentation_url ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {data.repository_url ? (
                    <a
                      href={data.repository_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2 text-[11px] text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground"
                    >
                      <FolderGit2 className="size-3.5" /> Repository
                      <ExternalLink className="size-3 text-faint" />
                    </a>
                  ) : null}
                  {data.documentation_url ? (
                    <a
                      href={data.documentation_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2 text-[11px] text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground"
                    >
                      <FileText className="size-3.5" /> Documentation
                      <ExternalLink className="size-3 text-faint" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </Card>

            {data.status && isActiveProject(data.status) && !rows.length ? (
              <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                This project has no tasks yet, so progress can only come from the manual number.{' '}
                <button
                  type="button"
                  onClick={() => { setEditingTask(null); setTaskDialog(true) }}
                  className="underline underline-offset-2"
                >
                  Add one
                </button>
                .
              </p>
            ) : null}

            <Tabs defaultValue="tasks">
              <TabsList>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="milestones">
                  <MilestoneIcon /> Milestones
                </TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="tasks" className="space-y-3">
                <FilterBar>
                  <ViewToggle
                    value={view}
                    onChange={(next) => setView(next as typeof view)}
                    options={[
                      { value: 'board', label: 'Board', icon: <LayoutGrid /> },
                      { value: 'list', label: 'List', icon: <List /> },
                      { value: 'table', label: 'Table', icon: <TableIcon /> },
                    ]}
                  />
                  <FilterChip active={onlyOpen} onClick={() => setOnlyOpen((prev) => !prev)}>
                    Open only
                  </FilterChip>
                  <span className="text-[11px] text-muted-foreground">
                    {tasks.data ? countLabel(tasks.data.total, 'task', 'tasks') : 'Loading…'}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => { setEditingTask(null); setTaskDialog(true) }}>
                      <Plus /> New task
                    </Button>
                  </span>
                </FilterBar>

                {tasks.error && !tasks.data ? (
                  <ErrorBlock error={tasks.error} onRetry={tasks.reload} />
                ) : !tasks.data ? (
                  <LoadingBlock rows={4} label="Loading tasks…" />
                ) : view === 'board' ? (
                  <TaskBoard
                    tasks={rows}
                    onEdit={(task) => { setEditingTask(task); setTaskDialog(true) }}
                  />
                ) : view === 'list' ? (
                  <Panel dense title={countLabel(rows.length, 'task', 'tasks')} bodyClassName="pt-1">
                    <TaskList
                      tasks={rows}
                      showProject={false}
                      onEdit={(task) => { setEditingTask(task); setTaskDialog(true) }}
                      emptyLabel="No tasks here yet."
                    />
                  </Panel>
                ) : (
                  <Panel dense title="As a table" bodyClassName="pt-1">
                    <TaskTable tasks={rows} onEdit={(task) => { setEditingTask(task); setTaskDialog(true) }} />
                  </Panel>
                )}
              </TabsContent>

              <TabsContent value="milestones" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {milestones.data
                      ? `${countLabel(timeline.length, 'milestone', 'milestones')} · completed milestones keep their date`
                      : 'Loading milestones…'}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingMilestone(null); setMilestoneDialog(true) }}
                  >
                    <Plus /> Add milestone
                  </Button>
                </div>
                {milestones.error && !milestones.data ? (
                  <ErrorBlock error={milestones.error} onRetry={milestones.reload} />
                ) : !milestones.data ? (
                  <LoadingBlock rows={3} label="Loading milestones…" />
                ) : timeline.length ? (
                  <MilestoneTimeline
                    milestones={timeline}
                    onEdit={(milestone) => { setEditingMilestone(milestone); setMilestoneDialog(true) }}
                  />
                ) : (
                  <EmptyBlock
                    title="No milestones"
                    description="Milestones are dated checkpoints. Add the first one and it shows up on the dashboard too."
                    icon={<CalendarClock className="size-5" />}
                  />
                )}
              </TabsContent>

              <TabsContent value="details" className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Panel title="Task statistics" dense description="GET /projects/{id}/stats">
                    {stats.error && !stats.data ? (
                      <ErrorBlock error={stats.error} onRetry={stats.reload} />
                    ) : !stats.data ? (
                      <LoadingBlock rows={4} label="Loading stats…" />
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Total" value={formatNumber(stats.data.total)} />
                          <Stat label="Done" value={formatNumber(stats.data.done)} tone="success" />
                          <Stat label="Open" value={formatNumber(stats.data.open)} tone="primary" />
                          <Stat
                            label="Overdue"
                            value={formatNumber(stats.data.overdue)}
                            tone={stats.data.overdue ? 'danger' : 'default'}
                          />
                          <Stat label="Due today" value={formatNumber(stats.data.due_today)} />
                          <Stat label="Progress" value={formatPercent(stats.data.pct)} />
                        </div>
                        <Separator />
                        <BucketBar title="Tasks by status" values={stats.data.by_status} />
                        <BucketBar title="Tasks by priority" values={stats.data.by_priority} />
                        {stats.data.next_due ? (
                          <p className="text-[11px] text-muted-foreground">
                            Next due: <span className="text-foreground">{stats.data.next_due.title}</span>{' '}
                            <span className={cn('os-num', DUE_TONE_TEXT[dueTone(stats.data.next_due.due_date)])}>
                              {dueLabel(stats.data.next_due.due_date)}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    )}
                  </Panel>

                  <Panel title="Project record" dense description="Everything the API stores here">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                      <Detail label="Status" value={enumLabel(data.status)} />
                      <Detail label="Priority" value={enumLabel(data.priority)} />
                      <Detail label="Category" value={data.category ?? '—'} />
                      <Detail label="Manual progress" value={formatPercent(data.manual_progress)} />
                      <Detail label="Start date" value={formatDate(data.start_date)} />
                      <Detail label="Target date" value={formatDate(data.target_date)} />
                      <Detail label="Created" value={formatDate(data.created_at)} />
                      <Detail label="Updated" value={relativeTime(data.updated_at)} />
                      <Detail label="Identifier" value={data.id} mono className="col-span-2" />
                    </dl>
                  </Panel>
                </div>
              </TabsContent>

              <TabsContent value="activity" className="space-y-3">
                {activity.error && !activity.data ? (
                  <ErrorBlock error={activity.error} onRetry={activity.reload} />
                ) : !activity.data ? (
                  <LoadingBlock rows={4} label="Loading activity…" />
                ) : activity.data.items.length ? (
                  <ActivityTimeline items={activity.data.items} />
                ) : (
                  <EmptyBlock title="Nothing has happened here yet" />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </ResourceState>

      <ProjectDialog
        open={dialog}
        onOpenChange={setDialog}
        project={project.data ?? null}
        onSaved={() => reload()}
      />

      <TaskDialog
        open={taskDialog}
        onOpenChange={(next) => { setTaskDialog(next); if (!next) setEditingTask(null) }}
        task={editingTask}
        defaults={editingTask ? undefined : { project_id: id }}
        onSaved={(task, created) => {
          tasks.reload()
          invalidate(...PROJECT_SCOPE)
          toastSuccess(created ? 'Task created' : 'Task saved', { description: task.title })
        }}
      />

      <MilestoneDialog
        open={milestoneDialog}
        onOpenChange={(next) => { setMilestoneDialog(next); if (!next) setEditingMilestone(null) }}
        milestone={editingMilestone}
        projectId={id}
        onSaved={(milestone, created) => {
          milestones.reload()
          project.reload()
          invalidate('/milestones', '/dashboard', '/activity')
          toastSuccess(created ? 'Milestone added' : 'Milestone saved', { description: milestone.title })
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${project.data?.name ?? 'project'}`}
        description="Milestones are deleted and this project's tasks become unassigned. Type the project name to confirm."
        requireText={project.data?.name ?? ''}
        confirmLabel="Delete project"
        onConfirm={() =>
          api(`/projects/${id}`, { method: 'DELETE' }).then(() => {
            invalidate(...PROJECT_SCOPE)
            toastSuccess('Project deleted')
            router.push('/os/projects')
          })
        }
      />
    </div>
  )
}

function NextActionPanel({
  nextAction,
  nextDue,
  onEdit,
  href,
}: {
  nextAction: string | null
  nextDue: { title: string; due_date: string | null } | null
  onEdit: () => void
  href: string
}) {
  const set = Boolean(nextAction?.trim())
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-3 sm:w-[19rem]',
        set ? 'border-primary/40 bg-primary/5' : 'border-warning/40 bg-warning/10'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="os-eyebrow">
          <Target className="mr-1 inline size-3" /> Next action
        </p>
        <Button size="sm" variant={set ? 'outline' : 'default'} onClick={onEdit}>
          {set ? 'Update' : 'Set one'}
        </Button>
      </div>
      <p className={cn('mt-2 text-[13px] leading-relaxed', set ? 'text-foreground' : 'text-warning')}>
        {set ? nextAction : 'Not set — add one concrete, physical next step.'}
      </p>
      {nextDue ? (
        <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted-foreground">
          Earliest scheduled task:{' '}
          <Link href={href} className="text-foreground underline-offset-2 hover:underline">
            {nextDue.title}
          </Link>
          {nextDue.due_date ? (
            <span className={cn('os-num ml-1', DUE_TONE_TEXT[dueTone(nextDue.due_date)])}>
              {dueLabel(nextDue.due_date)}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function MilestoneTimeline({
  milestones,
  onEdit,
}: {
  milestones: Milestone[]
  onEdit: (milestone: Milestone) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<OsApiError | null>(null)

  function complete(milestone: Milestone) {
    setBusyId(milestone.id)
    setError(null)
    api(`/milestones/${milestone.id}/${milestone.status === 'done' ? 'reopen' : 'complete'}`, {
      method: 'POST',
    })
      .then(() => invalidate('/milestones', '/projects', '/dashboard', '/activity'))
      .catch((e) => setError(e as OsApiError))
      .finally(() => setBusyId(null))
  }

  return (
    <div className="min-w-0 space-y-2">
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(error)}
        </p>
      ) : null}
      <ol className="relative space-y-2 border-l border-line pl-4">
        {milestones.map((milestone) => {
          const done = milestone.status === 'done'
          const tone = done ? 'none' : dueTone(milestone.date)
          return (
            <li key={milestone.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[21px] top-2 size-2.5 rounded-full border-2',
                  done
                    ? 'border-success bg-success'
                    : tone === 'overdue'
                      ? 'border-destructive bg-card'
                      : 'border-line-strong bg-card'
                )}
                aria-hidden
              />
              <div className="rounded-xl border border-line bg-card px-3 py-2 transition-colors hover:border-line-strong">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(milestone)}
                    className="min-w-0 flex-1 text-left text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn(done && 'text-faint line-through')}>{milestone.title}</span>
                    {milestone.description ? (
                      <span className="mt-0.5 block text-[11.5px] font-normal leading-relaxed text-muted-foreground">
                        {milestone.description}
                      </span>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className={cn('os-num text-[11px]', DUE_TONE_TEXT[tone])}>
                      {milestone.date ? dueLabel(milestone.date) : 'no date'}
                    </span>
                    <IconButton
                      label={done ? `Reopen ${milestone.title}` : `Complete ${milestone.title}`}
                      size="icon-sm"
                      disabled={busyId === milestone.id}
                      onClick={() => complete(milestone)}
                    >
                      {done ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
                    </IconButton>
                  </div>
                </div>
                {milestone.days_away != null && !done ? (
                  <p className="mt-1 text-[11px] text-faint">
                    {milestone.days_away < 0
                      ? `${-milestone.days_away} days late`
                      : milestone.days_away === 0
                        ? 'today'
                        : `in ${milestone.days_away} days`}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function TaskTable({ tasks, onEdit }: { tasks: Task[]; onEdit: (task: Task) => void }) {
  if (!tasks.length) return <p className="px-2 py-3 text-xs text-muted-foreground">No tasks here yet.</p>
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[42rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Est.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onEdit(task)}
                    className="min-w-0 text-left text-[12.5px] text-foreground hover:underline"
                  >
                    {task.title}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge tone="outline" size="sm">
                    {enumLabel(task.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge tone="outline" size="sm">
                    {task.priority}
                  </Badge>
                </TableCell>
                <TableCell className={cn('os-num text-[11px]', DUE_TONE_TEXT[dueTone(task.due_date)])}>
                  {task.due_date ? dueLabel(task.due_date) : '—'}
                </TableCell>
                <TableCell className="os-num text-right text-[11px] text-muted-foreground">
                  {task.estimated_minutes ? `${task.estimated_minutes}m` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
      </Table>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="os-eyebrow">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-foreground', mono && 'os-mono text-[11px]')} title={value}>
        {value}
      </dd>
    </div>
  )
}
