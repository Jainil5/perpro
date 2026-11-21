'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Folder, Plus, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource } from '@/lib/os/hooks'
import { daysUntil } from '@/lib/os/format'
import type { ListResponse, Project, ProjectSort } from '@/lib/os/types'
import { Badge } from '@/components/os/ui/badge'
import { Button } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { EmptyBlock, LoadingCards, ResourceState } from '@/components/os/states'
import { FilterBar, FilterChip, InlineSearch, SortSelect } from '@/components/os/filters'
import { ProjectCard } from '@/components/os/ProjectCard'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { ProjectDialog } from '@/components/os/dialogs/ProjectDialog'
import { toastSuccess } from '@/components/os/ui/toast'

const SORTS: ProjectSort[] = ['updated', 'target', 'name']
const PAST_TARGET = '__past_target'

/**
 * `GET /search` points its "see all" links at `/projects?q=<term>`, and
 * dashboard chips at `/projects?status=in_progress`, so the URL seeds the
 * filter row. Unknown or `all` values simply mean "no filter".
 */
function readFilter(params: URLSearchParams, key: string): string {
  const raw = params.get(key)
  return !raw || raw === 'all' ? 'all' : raw
}

export default function ProjectsView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const [status, setStatus] = useState<string>(() => readFilter(params, 'status'))
  const [priority, setPriority] = useState<string>(() => readFilter(params, 'priority'))
  const [term, setTerm] = useState(() => params.get('q') ?? '')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)

  const urlString = params.toString()
  // The same links arriving while the page is already mounted (⌘K, an activity
  // row, a search "see all") have to move the filter row, not just the first
  // render's initial state.
  useEffect(() => {
    const next = new URLSearchParams(urlString)
    const termParam = next.get('q')
    if (termParam !== null) setTerm(termParam)
    if (next.get('status') !== null) setStatus(readFilter(next, 'status'))
    if (next.get('priority') !== null) setPriority(readFilter(next, 'priority'))
  }, [urlString])

  const q = useDebounced(term.trim(), 300)
  const pastTarget = status === PAST_TARGET
  const projects = useResource<ListResponse<Project>>('/projects', {
    status: pastTarget || status === 'all' ? undefined : status,
    priority: priority === 'all' ? undefined : priority,
    q: q || undefined,
    sort,
    limit: 200,
  })

  const items = useMemo(() => {
    const list = projects.data?.items ?? []
    if (!pastTarget) return list
    return list.filter((project) => {
      const left = daysUntil(project.target_date)
      return left != null && left < 0 && project.status !== 'completed' && project.status !== 'archived'
    })
  }, [pastTarget, projects.data])

  const counts = projects.data?.total ?? 0

  function openCreate() {
    setEditing(null)
    setDialog(true)
  }

  function openEdit(project: Project) {
    setEditing(project)
    setDialog(true)
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Projects</p>
          <h1 className="os-title mt-0.5">Everything you are building</h1>
          <p className="os-micro mt-2">
            {projects.loading && !projects.data
              ? 'Loading…'
              : `${items.length} shown${counts !== items.length ? ` of ${counts}` : ''} · progress comes from task counts, not vibes`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> New project
        </Button>
      </div>

      <FilterBar>
        <FilterChip active={status === 'all'} onClick={() => setStatus('all')}>
          All
        </FilterChip>
        <FilterChip
          active={status === PAST_TARGET}
          onClick={() => setStatus(PAST_TARGET)}
          tone="warning"
        >
          <Target className="size-3.5" /> Past target
        </FilterChip>
        {enums.project_status.map((value) => (
          <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
            {value.replace(/_/g, ' ')}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line lg:block" />
        <FilterChip active={priority === 'urgent'} onClick={() => setPriority(priority === 'urgent' ? 'all' : 'urgent')} tone="danger">
          Urgent only
        </FilterChip>
        <InlineSearch value={term} onChange={setTerm} placeholder="Search name or description…" className="min-w-[10rem] flex-1" />
        <SortSelect value={sort} onChange={(next) => setSort(next as ProjectSort)} options={SORTS} label="Sort projects" />
      </FilterBar>

      <ResourceState
        resource={projects}
        skeleton={<LoadingCards count={6} />}
        empty={
          <EmptyBlock
            title="No projects match this filter"
            description={
              term || status !== 'all' || priority !== 'all'
                ? 'Clear the filters, or create a project for what you are working on.'
                : 'Projects group tasks, milestones and notes. The first one takes ten seconds.'
            }
            icon={<Folder />}
            action={
              <>
                <Button size="sm" onClick={openCreate}>
                  <Plus /> New project
                </Button>
                {term || status !== 'all' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTerm('')
                      setStatus('all')
                      setPriority('all')
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </>
            }
          />
        }
      >
        {() =>
          items.length ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((project) => (
                <ProjectCard key={project.id} project={project} onEdit={openEdit} />
              ))}
            </div>
          ) : (
            <EmptyBlock
              title={pastTarget ? 'Nothing is past its target date' : 'No projects match this filter'}
              description="Adjust the chips above — filters are applied by the API, so this is the real result set."
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTerm('')
                    setStatus('all')
                    setPriority('all')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )
        }
      </ResourceState>

      <Panel title="How projects work here" icon={<Folder />} className="max-w-3xl">
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            <Badge tone="outline" size="sm">progress</Badge> completed/archived ⇒ 100; otherwise
            done ÷ total tasks, falling back to the manual percentage while a project has no tasks.
          </li>
          <li>
            <Badge tone="outline" size="sm">delete</Badge> keeps its tasks (they become unassigned) and
            removes milestones — the API cascades, the UI only warns.
          </li>
          <li>
            <Badge tone="outline" size="sm">links</Badge> repository and documentation URLs open in a new
            tab; nothing is fetched through the proxy.
          </li>
        </ul>
      </Panel>

      <ProjectDialog
        open={dialog}
        onOpenChange={setDialog}
        project={editing}
        onSaved={(project, created) =>
          toastSuccess(created ? 'Project created' : 'Project saved', { description: project.name })
        }
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.name ?? 'project'}`}
        description="Milestones are deleted and the project's tasks become unassigned. Deleting a project needs its name typed back."
        requireText={deleting?.name ?? ''}
        confirmLabel="Delete project"
        onConfirm={() =>
          api(`/projects/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            invalidate('/projects', '/tasks', '/milestones', '/dashboard', '/meta', '/activity')
            toastSuccess('Project deleted', { description: deleting?.name })
          })
        }
      />

      <p className="text-[11px] text-faint">
        Looking for a record?{' '}
        <Link href="/search" className="text-primary underline-offset-2 hover:underline">
          Full-text search
        </Link>{' '}
        covers tasks, notes, milestones and people too.
      </p>
    </div>
  )
}
