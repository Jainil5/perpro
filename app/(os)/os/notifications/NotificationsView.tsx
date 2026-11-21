'use client'

import { BellOff, CheckCheck, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useEnums, useResource } from '@/lib/os/hooks'
import { countLabel, enumLabel } from '@/lib/os/format'
import type { NotificationsResponse, RefreshResult } from '@/lib/os/types'
import { Button } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { Badge } from '@/components/os/ui/badge'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'
import { EmptyBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterBar, FilterChip } from '@/components/os/filters'
import { NotificationRow } from '@/components/os/NotificationRow'
import { ReminderPanel } from '@/components/os/ReminderPanel'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

const SCOPE = ['/notifications', '/dashboard', '/meta', '/activity', '/reminders']
const ALL = '__all'

export default function NotificationsView() {
  const { enums } = useEnums()
  const [unreadOnly, setUnreadOnly] = useState(true)
  const [kind, setKind] = useState<string>(ALL)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)
  const [refreshError, setRefreshError] = useState<OsApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const feed = useResource<NotificationsResponse>('/notifications', {
    unread: unreadOnly ? true : undefined,
    limit: 100,
  })

  const items = (feed.data?.items ?? []).filter(
    (item) => kind === ALL || item.kind === kind
  )

  function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    api<RefreshResult>('/notifications/refresh', { method: 'POST' })
      .then((res) => {
        setRefreshResult(res)
        invalidate(...SCOPE)
        toastSuccess('Notifications regenerated', {
          description: `${res.created} created · ${res.resolved} resolved`,
        })
      })
      .catch((e) => setRefreshError(e as OsApiError))
      .finally(() => setRefreshing(false))
  }

  function readAll() {
    setBusy(true)
    api('/notifications/read-all', { method: 'POST' })
      .then(() => {
        invalidate(...SCOPE)
        toastSuccess('Everything marked read')
      })
      .catch((e) => toastError(errorMessage(e, 'Could not mark notifications read')))
      .finally(() => setBusy(false))
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="os-eyebrow">System</p>
          <h1 className="os-title">Notifications</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {feed.loading && !feed.data
              ? 'Loading…'
              : `${countLabel(feed.data?.unread ?? 0, 'unread notification', 'unread notifications')} · derived rules plus reminders`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" loading={refreshing} onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={!feed.data?.unread}
            onClick={readAll}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
      </header>

      <FilterBar>
        <FilterChip
          active={unreadOnly}
          onClick={() => setUnreadOnly((prev) => !prev)}
          count={feed.data?.unread}
          tone="warning"
        >
          Unread only
        </FilterChip>
        <FilterChip active={kind === ALL} onClick={() => setKind(ALL)}>
          Every kind
        </FilterChip>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Notification kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <Option value={ALL}>All kinds</Option>
            {enums.notification_kind.map((value) => (
              <Option key={value} value={value}>
                {enumLabel(value)}
              </Option>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">
          {feed.data ? countLabel(items.length, 'shown notification', 'shown notifications') : ''}
        </span>
      </FilterBar>

      {refreshError ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(refreshError)}
        </p>
      ) : null}
      {refreshResult ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge tone={refreshResult.created ? 'success' : 'outline'}>
            {refreshResult.created} created
          </Badge>
          <Badge tone={refreshResult.resolved ? 'primary' : 'outline'}>
            {refreshResult.resolved} resolved
          </Badge>
          <span>
            Refreshing is idempotent — an open notification is never duplicated.
          </span>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <ResourceState
          resource={feed}
          skeleton={<LoadingBlock rows={5} label="Loading notifications…" />}
          empty={
            <EmptyBlock
              title="Nothing waiting"
              description="Derived notifications appear after a refresh, when overdue work or stale projects show up."
              icon={<BellOff className="size-5" />}
            />
          }
        >
          {(data) => (
            <Panel
              dense
              title={unreadOnly ? 'Unread' : 'All notifications'}
              description={`${items.length} of ${data.items.length} loaded`}
            >
              {items.length ? (
                <ul className="min-w-0 space-y-1.5">
                  {items.map((notification) => (
                    <li key={notification.id}>
                      <NotificationRow notification={notification} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  {unreadOnly
                    ? 'Inbox zero. Switch to “All” to see what was already read.'
                    : `No notifications of kind ${enumLabel(kind)}.`}
                </p>
              )}
            </Panel>
          )}
        </ResourceState>

        <Panel dense title="Reminders" description="Pending, oldest first">
          <ReminderPanel title="Due reminders" />
        </Panel>
      </div>

      <p className="text-[11px] text-faint">
        GET requests never create notifications — the API only derives them in{' '}
        <span className="os-mono">POST /notifications/refresh</span>, which is what the button above
        calls.
      </p>
    </div>
  )
}
