'use client'

import {
  Database,
  Download,
  HeartPulse,
  RefreshCw,
  Save,
  ServerCrash,
  Moon,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useHealth, useWorkspace } from '@/lib/os/hooks'
import { formatDate, formatDateTime } from '@/lib/os/format'
import type { ExportPayload, Health, SeedResult, Workspace } from '@/lib/os/types'
import { cn } from '@/lib/os/cn'
import { Button } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { Badge } from '@/components/os/ui/badge'
import { Input } from '@/components/os/ui/input'
import { Field } from '@/components/os/ui/label'
import { Separator } from '@/components/os/ui/separator'
import { ErrorBlock, LoadingBlock } from '@/components/os/states'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'
import { useOsTheme } from '@/components/os/os-bootstrap'
import { blankToNull } from '@/lib/os/forms'

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Lisbon',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Singapore',
  'Australia/Sydney',
]
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY']

export default function SettingsView() {
  const health = useHealth()
  const workspace = useWorkspace()
  const [theme, setTheme] = useOsTheme()

  return (
    <div className="os-enter space-y-4">
      <header className="min-w-0 border-b border-line pb-4">
        <p className="os-label">System</p>
        <h1 className="os-title">Settings</h1>
        <p className="os-micro mt-2">
          Everything here is stored by the API, not by the browser — except the theme and dashboard
          layout, which stay on this device.
        </p>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <WorkspacePanel workspace={workspace} />
        <ApiPanel health={health} />
      </div>

      <Panel dense title="Appearance" description="Saved in this browser, applied before paint">
        <div className="flex flex-wrap items-center gap-2">
          {(['light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              aria-pressed={theme === option}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-os border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                theme === option
                  ? 'border-line-strong text-foreground'
                  : 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground'
              )}
            >
              {option === 'light' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {option === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
          <span className="text-[11px] text-faint">
            The sidebar toggle does the same thing; the choice survives a reload.
          </span>
        </div>
      </Panel>

      <DemoPanel />

      <Panel dense title="Your data" icon={<Database />} description="No cloud, no sync">
        <div className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
          <p>
            MyOS writes to a single local SQLite file owned by the API process. Nothing is uploaded
            anywhere; this frontend only ever talks to your own backend.
          </p>
          <p>
            The backend reports where that file lives in <span className="os-mono">GET /health</span>
            {health.data?.database ? (
              <>
                {' '}
                — right now <span className="os-mono text-foreground">{health.data.database}</span>
              </>
            ) : (
              ', which is not reachable at the moment'
            )}
            . Copy that file (or the{' '}
            <span className="os-mono">/export</span> JSON below) to move or back a workspace up.
          </p>
          <ExportButton />
        </div>
      </Panel>
    </div>
  )
}

function WorkspacePanel({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [currency, setCurrency] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<OsApiError | null>(null)

  useEffect(() => {
    if (!workspace.data) return
    setName(workspace.data.name)
    setTimezone(workspace.data.timezone)
    setCurrency(workspace.data.currency)
    setDirty(false)
    setError(null)
  }, [workspace.data])

  function save() {
    setSaving(true)
    setError(null)
    api<Workspace>('/workspace', {
      method: 'PATCH',
      body: {
        name: name.trim(),
        timezone: blankToNull(timezone) ?? undefined,
        currency: blankToNull(currency) ?? undefined,
      },
    })
      .then((next) => {
        workspace.setData(next)
        setDirty(false)
        invalidate('/workspace', '/meta', '/dashboard')
        toastSuccess('Workspace saved', { description: next.name })
      })
      .catch((e) => setError(e as OsApiError))
      .finally(() => setSaving(false))
  }

  if (workspace.error && !workspace.data)
    return (
      <Panel dense title="Workspace">
        <ErrorBlock error={workspace.error} onRetry={workspace.reload} />
      </Panel>
    )
  if (!workspace.data)
    return (
      <Panel dense title="Workspace">
        <LoadingBlock rows={3} label="Loading workspace…" />
      </Panel>
    )

  return (
    <Panel
      dense
      title="Workspace"
      description={`${workspace.data.slug} · created ${formatDate(workspace.data.created_at)}`}
      action={
        <>
          {dirty ? <Badge tone="warning">Unsaved</Badge> : null}
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty || !name.trim()}>
            <Save /> Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" htmlFor="ws-name" error={name.trim() ? null : 'A workspace needs a name'}>
          <Input
            id="ws-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setDirty(true)
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="ws-tz" hint="IANA name">
            <Input
              id="ws-tz"
              list="os-timezones"
              value={timezone}
              onChange={(event) => {
                setTimezone(event.target.value)
                setDirty(true)
              }}
              placeholder="Asia/Kolkata"
            />
            <datalist id="os-timezones">
              {TIMEZONES.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <Field label="Currency" htmlFor="ws-currency" hint="ISO code">
            <Input
              id="ws-currency"
              list="os-currencies"
              value={currency}
              maxLength={3}
              onChange={(event) => {
                setCurrency(event.target.value.toUpperCase())
                setDirty(true)
              }}
              placeholder="INR"
            />
            <datalist id="os-currencies">
              {CURRENCIES.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
        </div>

        <Separator />
        <dl className="grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="min-w-0">
            <dt className="os-label">Workspace id</dt>
            <dd className="os-mono mt-0.5 truncate text-foreground" title={workspace.data.id}>
              {workspace.data.id}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="os-label">Created</dt>
            <dd className="os-num mt-0.5 text-foreground">
              {formatDateTime(workspace.data.created_at)}
            </dd>
          </div>
        </dl>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(error)}
          </p>
        ) : null}
        <p className="text-[11px] text-faint">
          The time zone changes how the API buckets &quot;today&quot; on the dashboard; the currency
          formats money in the Phase 3 finance modules.
        </p>
      </div>
    </Panel>
  )
}

function ApiPanel({ health }: { health: ReturnType<typeof useHealth> }) {
  const [probing, setProbing] = useState(false)

  function probe() {
    setProbing(true)
    api<Health>('/health')
      .then(() => {
        health.reload()
        toastSuccess('Backend answered')
      })
      .catch((e) => toastError(errorMessage(e, 'Backend still down')))
      .finally(() => setProbing(false))
  }

  return (
    <Panel
      dense
      title="API"
      icon={<HeartPulse />}
      description="GET /health"
      action={
        <Button size="sm" variant="outline" loading={probing} onClick={probe}>
          <RefreshCw /> Re-test
        </Button>
      }
    >
      {health.error && !health.data ? (
        <div className="space-y-2">
          <ErrorBlock error={health.error} onRetry={health.reload} />
          <p className="text-[11px] text-faint">
            The UI proxy sends everything to{' '}
            <span className="os-mono">MYOS_API_URL</span> (default{' '}
            <span className="os-mono">http://127.0.0.1:8000</span>) under{' '}
            <span className="os-mono">/api/os/v1</span>.
          </p>
        </div>
      ) : !health.data ? (
        <LoadingBlock rows={3} label="Checking the API…" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={health.data.status === 'ok' ? 'success' : 'warning'}>{health.data.status}</Badge>
            <span className="os-mono text-[11px] text-muted-foreground">
              v{health.data.version}
            </span>
            <span className="text-[11px] text-muted-foreground">
              workspace {health.data.workspace}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div className="min-w-0">
              <dt className="os-label">Database</dt>
              <dd className="os-mono mt-0.5 truncate text-foreground" title={health.data.database}>
                {health.data.database}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="os-label">AI assistant</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-foreground">
                <Sparkles className="size-3 text-faint" />
                {health.data.ai_enabled ? 'enabled' : 'not configured'}
              </dd>
            </div>
          </dl>
          <p className="text-[11px] text-faint">
            {health.data.ai_enabled
              ? 'The AI module is live server-side; the Phase 6 screen will show it here.'
              : 'Phase 6 unlocks once the backend is started with an AI key — nothing is simulated in the UI.'}
          </p>
        </div>
      )}
    </Panel>
  )
}

function DemoPanel() {
  const [seeding, setSeeding] = useState(false)
  const [seed, setSeed] = useState<SeedResult | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [resetArmed, setResetArmed] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetStatus, setResetStatus] = useState<number | null>(null)

  function runSeed() {
    setSeeding(true)
    setSeedError(null)
    api<SeedResult>('/demo/seed', { method: 'POST' })
      .then((res) => {
        setSeed(res)
        invalidate(
          '/projects',
          '/tasks',
          '/notes',
          '/milestones',
          '/contacts',
          '/companies',
          '/dashboard',
          '/meta',
          '/activity'
        )
        toastSuccess(res.skipped ? 'Demo data already present' : 'Demo data created')
      })
      .catch((e) => setSeedError(errorMessage(e)))
      .finally(() => setSeeding(false))
  }

  /**
   * `POST /demo/reset` is guarded server-side. We only reveal the retry affordance
   * after the API has actually answered 409, so the screen never claims a reset
   * is possible.
   */
  function runReset() {
    setResetError(null)
    api('/demo/reset', { method: 'POST' })
      .then(() => {
        setResetArmed(false)
        setResetStatus(200)
        invalidate(
          '/projects',
          '/tasks',
          '/notes',
          '/milestones',
          '/contacts',
          '/companies',
          '/dashboard',
          '/meta',
          '/activity',
          '/notifications'
        )
        toastSuccess('Demo data reset')
      })
      .catch((e) => {
        const err = e as OsApiError
        const status = typeof err?.status === 'number' ? err.status : null
        setResetStatus(status)
        setResetError(errorMessage(e))
        if (status === 409) setResetArmed(true)
      })
  }

  return (
    <Panel
      dense
      title="Demo data"
      icon={<Wand2 />}
      description="Idempotent seed for trying MyOS out"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" loading={seeding} onClick={runSeed}>
            <Sparkles /> Seed demo data
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResetOpen(true)}>
            <Trash2 /> Reset demo rows
          </Button>
        </div>

        {seed ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone={seed.skipped ? 'outline' : 'success'}>
              {seed.skipped ? 'nothing to do — demo rows already exist' : 'created'}
            </Badge>
            {Object.entries(seed.created ?? {}).map(([table, count]) => (
              <span key={table} className="os-num text-muted-foreground">
                {table}: {count}
              </span>
            ))}
          </div>
        ) : null}
        {seedError ? (
          <p role="alert" className="text-xs text-destructive">
            {seedError}
          </p>
        ) : null}

        <Separator />

        {resetStatus === 409 ? (
          <div className="space-y-2 border-y border-line px-3 py-2">
            <p className="flex items-center gap-2 text-[12px] font-medium text-warning">
              <ServerCrash className="size-3.5" /> The server refused the reset
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {resetError ??
                'Demo reset is guarded so it cannot be triggered by accident.'}{' '}
              Start the backend with <span className="os-mono">MYOS_ALLOW_DEMO_RESET=1</span> and
              press retry below. Only rows tagged <span className="os-mono">source = demo</span> are
              touched.
            </p>
            {resetArmed ? (
              <Button size="sm" variant="outline" onClick={runReset}>
                <RefreshCw /> Retry reset
              </Button>
            ) : null}
          </div>
        ) : resetStatus && resetStatus !== 200 ? (
          <p role="alert" className="text-xs text-destructive">
            {resetError}
          </p>
        ) : resetStatus === 200 ? (
          <p className="text-[11px] text-success">Demo rows wiped and reseeded.</p>
        ) : (
          <p className="text-[11px] text-faint">
            Reset only affects rows the seeder created, and the backend can refuse it — the exact
            reason appears here after the API answers.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset demo data"
        description="Removes rows tagged as demo data and reseeds. Your own records stay."
        confirmLabel="Reset demo rows"
        onConfirm={runReset}
      />
    </Panel>
  )
}

function ExportButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function download() {
    setBusy(true)
    setError(null)
    api<ExportPayload>('/export')
      .then((payload) => {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `myos-export-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toastSuccess('Export downloaded', {
          description: `${Object.keys(payload.tables ?? {}).length} tables`,
        })
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button size="sm" variant="outline" loading={busy} onClick={download}>
        <Download /> Download JSON export
      </Button>
      <span className="text-[11px] text-faint">GET /export · every table, one file</span>
      {error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  )
}

