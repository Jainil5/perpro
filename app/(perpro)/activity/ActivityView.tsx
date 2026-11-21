'use client'

import { Activity as ActivityIcon } from 'lucide-react'
import { useState } from 'react'

import { invalidate, useEnums, useResource } from '@/lib/os/hooks'
import { countLabel } from '@/lib/os/format'
import type { ActivityLog, ListResponse } from '@/lib/os/types'
import { Panel } from '@/components/os/ui/card'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'
import { EmptyBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterBar, FilterChip, LoadMore } from '@/components/os/filters'
import { ActivityTimeline } from '@/components/os/ActivityTimeline'
import { useProjectOptions } from '@/components/os/pickers'

const DAYS = [1, 7, 30, 90]
const PAGE = 100
const ALL = '__all'

export default function ActivityView() {
  const { enums } = useEnums()
  const [entityType, setEntityType] = useState<string>(ALL)
  const [days, setDays] = useState(7)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [pages, setPages] = useState(1)

  const projects = useProjectOptions()
  const activity = useResource<ListResponse<ActivityLog>>('/activity', {
    entity_type: entityType === ALL ? undefined : entityType,
    project_id: projectId ?? undefined,
    days,
    limit: PAGE * pages,
  })

  return (
    <div className="os-enter space-y-4">
      <header className="min-w-0 border-b border-line pb-4">
        <p className="os-label">System</p>
        <h1 className="os-title">Activity</h1>
        <p className="os-micro mt-2">
          {activity.loading && !activity.data
            ? 'Loading…'
            : `${countLabel(activity.data?.total ?? 0, 'event', 'events')} in the last ${days} days`}
          {' · every write to the API lands here'}
        </p>
      </header>

      <FilterBar>
        <FilterChip active={entityType === ALL} onClick={() => setEntityType(ALL)}>
          Everything
        </FilterChip>
        <span className="os-scroll-x flex items-center gap-2">
          {['task', 'project', 'note', 'milestone', 'contact', 'company'].map((type) => (
            <FilterChip
              key={type}
              active={entityType === type}
              onClick={() => setEntityType(entityType === type ? ALL : type)}
            >
              {type}
            </FilterChip>
          ))}
        </span>
        <Select value={String(days)} onValueChange={(next) => { setDays(Number(next)); setPages(1) }}>
          <SelectTrigger size="sm" className="w-[7.5rem]" aria-label="Time window">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAYS.map((value) => (
              <Option key={value} value={String(value)}>
                Last {value} days
              </Option>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={projectId ?? ALL}
          onValueChange={(next) => {
            setProjectId(next === ALL ? null : next)
            setPages(1)
          }}
        >
          <SelectTrigger size="sm" className="w-[10rem]" aria-label="Project filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <Option value={ALL}>All projects</Option>
            {(projects.data?.items ?? []).map((project) => (
              <Option key={project.id} value={project.id}>
                {project.name}
              </Option>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <ResourceState
        resource={activity}
        skeleton={<LoadingBlock rows={6} label="Loading activity…" />}
        empty={
          <EmptyBlock
            title="No activity in this window"
            description="Widen the range, or clear the project and entity filters. Activity is written by the API on every create, update, complete and delete."
            icon={<ActivityIcon className="size-5" />}
          />
        }
      >
        {(data) => (
          <div className="min-w-0 space-y-3">
            {data.items.length ? (
              <>
                <ActivityTimeline items={data.items} />
                <Panel dense bodyClassName="pt-3">
                  <LoadMore
                    loaded={data.items.length}
                    total={data.total}
                    loading={activity.loading}
                    size={PAGE}
                    onMore={() => setPages((prev) => prev + 1)}
                    onReset={() => {
                      setPages(1)
                      invalidate('/activity')
                      activity.reload()
                    }}
                  />
                </Panel>
              </>
            ) : (
              <p className="px-2 py-6 text-xs text-muted-foreground">
                Nothing recorded for these filters.
              </p>
            )}
          </div>
        )}
      </ResourceState>

      <p className="text-[11px] text-faint">
        {enums.activity_verb.length} verbs are documented; each line links to the record it changed,
        so a deleted task is the only thing that ever goes missing.
      </p>
    </div>
  )
}
