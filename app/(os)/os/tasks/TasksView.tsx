'use client'

import { List, LayoutGrid, Plus, Upload } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource } from '@/lib/os/hooks'
import { countLabel, enumLabel } from '@/lib/os/format'
import type {
  BulkResult,
  NoteTag,
  PagedListResponse,
  Task,
  TaskSort,
} from '@/lib/os/types'
import { Button } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { EmptyBlock, LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
import {
  FilterBar,
  FilterChip,
  InlineSearch,
  LoadMore,
  SortSelect,
  ViewToggle,
} from '@/components/os/filters'
import { ProjectSelect } from '@/components/os/pickers'
import { TaskList } from '@/components/os/TaskRow'
import { TaskBoard } from '@/components/os/TaskBoard'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { ImportTasksDialog } from '@/components/os/dialogs/ImportTasksDialog'
import { TaskDialog } from '@/components/os/dialogs/TaskDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'

const SORTS: TaskSort[] = ['due', 'priority', 'created', 'position']
const PAGE = 50
const DUE_FILTERS = ['today', 'week', 'overdue', 'upcoming', 'none']
const BULK_SCOPE = ['/tasks', '/projects', '/dashboard', '/meta', '/activity', '/notifications']

/** Any status, expressed as the documented per-status filter. */
const ALL = '__all'

/**
 * "Open" is not one of the API's statuses (`GET /tasks?status=` takes exactly
 * one of todo|in_progress|blocked|done|dropped), so it is a screen-level filter
 * applied to whatever the page returns. The URL spells it `status=open`.
 */
const OPEN = '__open'
const OPEN_ALIAS = 'open'

/**
 * `?filter=` presets, the scheme the API uses in notification, insight and
 * reminder hrefs (`/os/tasks?filter=overdue`). Anything else — `all`, or a name
 * this screen does not know — resets the filters.
 */
const FILTER_PRESETS: Record<string, { status?: string; due?: string }> = {
  overdue: { due: 'overdue' },
  today: { due: 'today' },
  week: { due: 'week' },
  upcoming: { due: 'upcoming' },
  none: { due: 'none' },
  open: { status: OPEN_ALIAS },
  done: { status: 'done' },
}

interface Seed {
  status: string
  priority: string
  due: string
  tag: string
  term: string
}

/** Empty, `all` and a repeated key all mean "no filter on this facet". */
function readParam(params: URLSearchParams, key: string): string {
  const raw = params.get(key)
  return !raw || raw === 'all' ? ALL : raw
}

/** `open` is the URL spelling of this screen's not-done filter. */
function statusFrom(raw: string): string {
  return raw === OPEN_ALIAS ? OPEN : raw
}

function readStatus(params: URLSearchParams): string {
  return statusFrom(readParam(params, 'status'))
}

/** A named preset, or a full reset for `all` and anything this screen is new to. */
function presetSeed(name: string): Seed {
  const mapped = FILTER_PRESETS[name]
  if (!mapped) return { status: ALL, priority: ALL, due: ALL, tag: ALL, term: '' }
  return {
    status: mapped.status ? statusFrom(mapped.status) : ALL,
    priority: ALL,
    due: mapped.due ?? ALL,
    tag: ALL,
    term: '',
  }
}

/** The URL is the entry point for every filter, so a shared link reloads itself. */
function seedFilters(params: URLSearchParams): Seed {
  const preset = params.get('filter')
  if (preset !== null) return presetSeed(preset)
  return {
    status: readStatus(params),
    priority: readParam(params, 'priority'),
    due: readParam(params, 'due'),
    tag: readParam(params, 'tag'),
    term: params.get('q') ?? '',
  }
}

/** `/os/tasks?filter=overdue&task=<id>` → `/os/tasks?due=overdue`, reload-safe. */
function canonicalSearch(params: URLSearchParams): string | null {
  const presetName = params.get('filter')
  if (presetName === null && !params.has('task')) return null
  const next = new URLSearchParams(params.toString())
  next.delete('task')
  const preset = presetName === null ? undefined : FILTER_PRESETS[presetName]
  if (presetName !== null) {
    next.delete('filter')
    if (preset) {
      // Write back only what the preset actually constrains.
      if (preset.status) next.set('status', preset.status)
      else next.delete('status')
      if (preset.due) next.set('due', preset.due)
      else next.delete('due')
      next.delete('priority')
      next.delete('tag')
      next.delete('q')
    } else {
      for (const key of ['status', 'due', 'priority', 'tag', 'q']) next.delete(key)
    }
  }
  return next.toString()
}

export default function TasksView() {
  const params = useSearchParams()
  const router = useRouter()
  const { enums } = useEnums()
  const initialProject = params.get('project')
  const [seed] = useState(() => seedFilters(params))
  const [status, setStatus] = useState<string>(seed.status)
  const [priority, setPriority] = useState<string>(seed.priority)
  const [due, setDue] = useState<string>(seed.due)
  const [tag, setTag] = useState<string>(seed.tag)
  const [projectId, setProjectId] = useState<string | null>(initialProject)
  const [term, setTerm] = useState<string>(seed.term)
  const [sort, setSort] = useState<TaskSort>('due')
  const [view, setView] = useState<'list' | 'board'>('list')
  const [pages, setPages] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<Task | null>(null)
  const [dialog, setDialog] = useState(false)
  const [importOpen, setImportOpen] = useState(params.get('import') === '1')
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<OsApiError | null>(null)
  const [bulkPriority, setBulkPriority] = useState<string>('medium')
  const [bulkProject, setBulkProject] = useState<string | null>(null)
  const [bulkValueOpen, setBulkValueOpen] = useState(false)
  /** The task named by `?task=` — loaded straight from the API, then released. */
  const [deep, setDeep] = useState<{ id: string; loaded: boolean } | null>(() => {
    const id = params.get('task')
    return id ? { id, loaded: false } : null
  })
  const taskId = params.get('task')
  const filterParam = params.get('filter')
  const urlString = params.toString()

  const q = useDebounced(term.trim(), 300)
  const query = useMemo(
    () => ({
      status: status === ALL || status === OPEN ? undefined : status,
      priority: priority === ALL ? undefined : priority,
      due: due === ALL ? undefined : due,
      tag: tag === ALL ? undefined : tag,
      project_id: projectId ?? undefined,
      q: q || undefined,
      sort,
      limit: PAGE * pages,
      offset: 0,
    }),
    [status, priority, due, tag, projectId, q, sort, pages]
  )

  const tasks = useResource<PagedListResponse<Task>>('/tasks', query)
  const tags = useResource<NoteTag[]>('/note-tags')

  // Filter changes always start the pager again from the first page.
  useEffect(() => {
    setPages(1)
  }, [status, priority, due, tag, projectId, q, sort])

  useEffect(() => {
    // Changing filters drops the bulk selection — except the deep-linked row,
    // which stays picked while its dialog is open.
    setSelected((prev) => (deep?.id && prev.includes(deep.id) ? [deep.id] : []))
    setBulkError(null)
  }, [status, priority, due, tag, projectId, q, sort, deep])

  const total = tasks.data?.total ?? 0
  const items = useMemo(() => {
    const list = tasks.data?.items ?? []
    return status === OPEN ? list.filter((task) => task.status !== 'done') : list
  }, [tasks.data, status])
  const ids = useMemo(() => items.map((task) => task.id), [items])
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id))
  /** True when `?task=` pointed at a row the current filters do not include. */
  const deepElsewhere = Boolean(deep?.loaded && items.some((task) => task.id === deep.id) === false)

  // Deep link: /os/tasks?task=<id> opens that task's dialog, whichever page it
  // sits on, and the id then leaves the URL so reload and ⌘K stay predictable.
  useEffect(() => {
    if (!taskId) return
    setDeep({ id: taskId, loaded: false })
    let cancelled = false
    api<Task>(`/tasks/${taskId}`)
      .then((task) => {
        if (cancelled) return
        setSelected([task.id])
        setEditing(task)
        setDialog(true)
        setDeep({ id: task.id, loaded: true })
      })
      .catch((e) => {
        if (cancelled) return
        setDeep(null)
        toastError(errorMessage(e, 'That task could not be loaded'))
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  /** A `?filter=` arriving later (⌘K, a dashboard insight) re-seeds the row. */
  const appliedFilter = useRef(filterParam)
  useEffect(() => {
    if (filterParam === appliedFilter.current) return
    appliedFilter.current = filterParam
    if (filterParam === null) return
    const next = presetSeed(filterParam)
    setStatus(next.status)
    setPriority(next.priority)
    setDue(next.due)
    setTag(next.tag)
    setTerm(next.term)
  }, [filterParam])

  // Rewrite ?filter= / ?task= into the params this screen reads on reload.
  useEffect(() => {
    const search = canonicalSearch(new URLSearchParams(urlString))
    if (search === null) return
    router.replace(`/os/tasks${search ? `?${search}` : ''}`, { scroll: false })
  }, [urlString, router])

  function toggleOne(id: string, next: boolean) {
    setSelected((prev) => (next ? [...prev, id] : prev.filter((value) => value !== id)))
  }

  function runBulk(action: BulkAction, value?: string | null) {
    if (!selected.length) return
    setBulkBusy(true)
    setBulkError(null)
    api<BulkResult>('/tasks/bulk', { method: 'POST', body: { ids: selected, action, value } })
      .then((res) => {
        const failed = res.failed?.length ?? 0
        toastSuccess(
          action === 'delete' ? `${countLabel(res.updated, 'task', 'tasks')} deleted` : `${countLabel(res.updated, 'task', 'tasks')} updated`,
          failed ? { description: `${failed} could not be changed` } : undefined
        )
        setSelected([])
        invalidate(...BULK_SCOPE)
      })
      .catch((e) => setBulkError(e))
      .finally(() => setBulkBusy(false))
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="os-eyebrow">Personal</p>
          <h1 className="os-title">Tasks</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {tasks.loading && !tasks.data
              ? 'Loading…'
              : status === OPEN
                ? `${items.length} open of ${total} tasks`
                : countLabel(total, 'task', 'tasks')}
            {status === ALL ? ' · every status' : status === OPEN ? ' · not done' : ` · ${enumLabel(status)}`}
            {due === ALL ? '' : ` · due ${enumLabel(due)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload /> Import
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialog(true) }}>
            <Plus /> New task
          </Button>
        </div>
      </header>

      <FilterBar>
        <FilterChip active={status === ALL} onClick={() => setStatus(ALL)} count={tasks.data?.total}>
          All
        </FilterChip>
        <FilterChip
          active={status === OPEN}
          onClick={() => setStatus(status === OPEN ? ALL : OPEN)}
        >
          Open
        </FilterChip>
        {enums.task_status.map((value) => (
          <FilterChip
            key={value}
            active={status === value}
            onClick={() => setStatus(status === value ? ALL : value)}
          >
            {enumLabel(value)}
          </FilterChip>
        ))}
        <span className="os-scroll-x flex items-center gap-2">
          <Select value={due} onValueChange={setDue}>
            <SelectTrigger size="sm" className="w-[7.25rem]" aria-label="Due filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <Option value={ALL}>Any due date</Option>
              {DUE_FILTERS.map((value) => (
                <Option key={value} value={value}>
                  {enumLabel(value)}
                </Option>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger size="sm" className="w-[7.25rem]" aria-label="Priority filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <Option value={ALL}>Any priority</Option>
              {enums.priority.map((value) => (
                <Option key={value} value={value}>
                  {enumLabel(value)}
                </Option>
              ))}
            </SelectContent>
          </Select>
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger size="sm" className="w-[7.25rem]" aria-label="Tag filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <Option value={ALL}>Any tag</Option>
              {(tags.data ?? []).map((row) => (
                <Option key={row.tag} value={row.tag}>
                  {row.tag} · {row.count}
                </Option>
              ))}
            </SelectContent>
          </Select>
        </span>
        <ProjectSelect
          value={projectId}
          onChange={setProjectId}
          size="sm"
          placeholder="Any project"
          className="w-[9rem]"
        />
        <InlineSearch value={term} onChange={setTerm} placeholder="Search tasks…" className="min-w-[10rem]" />
        <SortSelect value={sort} onChange={(next) => setSort(next as TaskSort)} options={SORTS} />
        <ViewToggle
          value={view}
          onChange={(next) => setView(next as 'list' | 'board')}
          options={[
            { value: 'list', label: 'List', icon: <List /> },
            { value: 'board', label: 'Board', icon: <LayoutGrid /> },
          ]}
        />
      </FilterBar>

      {selected.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-2.5 py-2 text-xs">
          <span className="os-num font-medium text-primary">{selected.length} selected</span>
          <Button size="sm" variant="outline" loading={bulkBusy} onClick={() => runBulk('complete')}>
            Mark complete
          </Button>
          <Select value={bulkPriority} onValueChange={(next) => { setBulkPriority(next); runBulk('set_priority', next) }}>
            <SelectTrigger size="sm" className="w-[8.5rem]" aria-label="Set priority">
              <SelectValue placeholder="Set priority" />
            </SelectTrigger>
            <SelectContent>
              {enums.priority.map((value) => (
                <Option key={value} value={value}>
                  {enumLabel(value)}
                </Option>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setBulkValueOpen(true)}>
            Set project
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkConfirm(true)}>
            Delete
          </Button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="os-tap-none ml-auto h-7 rounded-lg px-2 text-xs text-faint hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>
          {bulkValueOpen ? (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-primary/30 pt-2">
              <ProjectSelect value={bulkProject} onChange={setBulkProject} size="sm" placeholder="Choose a project" />
              <Button
                size="sm"
                loading={bulkBusy}
                disabled={!bulkProject}
                onClick={() => { runBulk('set_project', bulkProject); setBulkValueOpen(false) }}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBulkValueOpen(false)}>
                Cancel
              </Button>
            </div>
          ) : null}
          <SoftError error={bulkError} />
        </div>
      ) : null}

      {deepElsewhere ? (
        <p className="text-[11px] text-faint">
          That task is open in its own dialog; it sits outside the filters on this page.{' '}
          <button
            type="button"
            onClick={() => {
              setStatus(ALL)
              setDue(ALL)
              setPriority(ALL)
              setTag(ALL)
              setTerm('')
              setProjectId(null)
            }}
            className="os-tap-none h-7 rounded-lg px-2 text-[11px] text-primary underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </p>
      ) : null}

      <ResourceState
        resource={tasks}
        skeleton={<LoadingBlock rows={6} label="Loading tasks…" />}
        empty={
          <EmptyBlock
            title="No tasks match these filters"
            description={
              q || status !== ALL || due !== ALL || projectId || tag !== ALL || priority !== ALL
                ? 'Widen the filters, or clear the search.'
                : 'Add the first one — recurring tasks roll themselves forward when you complete them.'
            }
            action={
              <Button size="sm" onClick={() => { setEditing(null); setDialog(true) }}>
                <Plus /> New task
              </Button>
            }
          />
        }
      >
        {(data) =>
          view === 'board' ? (
            <TaskBoard tasks={items} onEdit={(task) => { setEditing(task); setDialog(true) }} showProject />
          ) : (
            <Panel
              dense
              title={view === 'list' ? countLabel(items.length, 'task', 'tasks') : ''}
              action={
                <button
                  type="button"
                  onClick={() => setSelected(allSelected ? [] : ids)}
                  className="os-tap-none h-7 rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              }
            >
              <TaskList
                tasks={items}
                onEdit={(task) => { setEditing(task); setDialog(true) }}
                selected={new Set(selected)}
                onSelect={toggleOne}
                emptyLabel="No tasks in this view."
              />
              <div className="pt-2">
                <LoadMore
                  loaded={data.items.length}
                  total={data.total}
                  loading={tasks.loading}
                  size={PAGE}
                  onMore={() => setPages((prev) => prev + 1)}
                  onReset={() => { setPages(1); tasks.reload() }}
                />
              </div>
            </Panel>
          )
        }
      </ResourceState>

      <p className="text-[11px] text-faint">
        Completed recurring tasks are rolled forward by the API — the next instance is reported
        right after you tick one. Drag cards in Board view, or use the arrows on a card for the
        same move with the keyboard.
      </p>

      <TaskDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) {
            setEditing(null)
            setDeep(null)
          }
        }}
        task={editing}
        onSaved={(task) => toastSuccess(editing ? 'Task saved' : 'Task created', { description: task.title })}
      />

      <ImportTasksDialog
        open={importOpen}
        onOpenChange={(next) => setImportOpen(next)}
        defaultProjectId={projectId}
        onImported={(result) =>
          toastSuccess(`${result.created} tasks imported`, {
            description: [
              result.duplicates ? `${result.duplicates} duplicates skipped` : '',
              result.rejected?.length ? `${result.rejected.length} rejected` : '',
              result.warnings?.length ? `${result.warnings.length} warnings` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          })
        }
      />

      <ConfirmDialog
        open={bulkConfirm}
        onOpenChange={setBulkConfirm}
        title={`Delete ${countLabel(selected.length, 'task', 'tasks')}`}
        description="Bulk delete runs through POST /tasks/bulk. Subtasks of a deleted task are detached, not deleted."
        confirmLabel="Delete tasks"
        onConfirm={() => {
          setBulkBusy(true)
          return api<BulkResult>('/tasks/bulk', {
            method: 'POST',
            body: { ids: selected, action: 'delete' },
          })
            .then((res) => {
              setSelected([])
              invalidate(...BULK_SCOPE)
              toastSuccess(`${countLabel(res.updated, 'task', 'tasks')} deleted`, {
                description: res.failed?.length ? `${res.failed.length} failed` : undefined,
              })
            })
            .finally(() => setBulkBusy(false))
        }}
      />
    </div>
  )
}

/** Bulk actions exactly as documented in API.md. */
type BulkAction = 'complete' | 'delete' | 'set_priority' | 'set_project'
