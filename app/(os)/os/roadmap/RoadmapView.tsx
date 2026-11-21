'use client'

import Link from 'next/link'
import { Check, Clock, Rocket, Sparkles, TriangleAlert } from 'lucide-react'

import { useHealth } from '@/lib/os/hooks'
import { OS_NAV_GROUPS, PHASE_TITLES, type OsNavItem, type OsPhase } from '@/lib/os/nav'
import { cn } from '@/lib/os/cn'
import { Badge } from '@/components/os/ui/badge'
import { Panel } from '@/components/os/ui/card'
import { SkeletonCard } from '@/components/os/ui/skeleton'

/**
 * The roadmap is a promise tracker, not a marketing page: every row says what
 * exists today, what the next phase adds, and which part of the API it needs.
 */

interface PhaseRow {
  label: string
  /** live = usable today, planned = this phase builds it, blocked = needs the backend. */
  status: 'live' | 'planned' | 'blocked'
  detail: string
  needs?: string
}

const PHASES: { phase: OsPhase; title: string; summary: string; rows: PhaseRow[] }[] = [
  {
    phase: 2,
    title: PHASE_TITLES[2],
    summary: 'Job hunting and client work: the two pipelines that need their own state machines.',
    rows: [
      { label: 'Career board', status: 'planned', detail: 'Roles, applications, interviews and offers as one funnel.' },
      { label: 'Freelance CRM', status: 'planned', detail: 'Lead → proposal → contract → invoice, with follow-up tasks.' },
      {
        label: 'Contacts and companies',
        status: 'live',
        detail: 'The address book CRM builds on: search, company join, tags and full CRUD today.',
      },
      {
        label: 'Note relations',
        status: 'live',
        detail: 'Notes already link to contacts, so the CRM can reuse them for meeting records.',
        needs: 'POST /notes/{id}/relations',
      },
    ],
  },
  {
    phase: 3,
    title: PHASE_TITLES[3],
    summary: 'Money math on your own numbers, offline first.',
    rows: [
      { label: 'Income calculator', status: 'planned', detail: 'Gross to take-home, tax and runway from one form.' },
      { label: 'Currency converter', status: 'planned', detail: 'Rates need a network call, so it ships behind a setting.', needs: 'rates provider' },
      { label: 'Subscriptions', status: 'planned', detail: 'Recurring spend with renewal reminders fed into /reminders.' },
      { label: 'Service catalogue', status: 'planned', detail: 'Packages and day rates the CRM can quote from.' },
      { label: 'Cost scenarios', status: 'planned', detail: 'Compare a plan against a target with the numbers you keep.' },
      { label: 'Expenses', status: 'planned', detail: 'Logged spend, categories and CSV export.' },
      {
        label: 'Currency field',
        status: 'live',
        detail: 'The workspace already stores a currency, so Phase 3 formats money correctly from day one.',
        needs: 'PATCH /workspace',
      },
    ],
  },
  {
    phase: 4,
    title: PHASE_TITLES[4],
    summary: 'Reads first, writes second — every connector lands with an explicit sync state.',
    rows: [
      { label: 'Google Calendar', status: 'planned', detail: 'Two-way sync with a conflict view; milestones become events.' },
      { label: 'Google Contacts', status: 'planned', detail: 'Import into /contacts with de-dup by email.' },
      { label: 'Stripe', status: 'planned', detail: 'Payments and subscriptions for the finance modules.' },
      { label: 'Slack', status: 'planned', detail: 'Notifications out, commands in.' },
      { label: 'WhatsApp', status: 'planned', detail: 'Reminder delivery on the channel you actually read.' },
      {
        label: 'Notifications pipeline',
        status: 'live',
        detail: 'Derived notifications, unread counts and snoozed reminders already run; connectors only feed it.',
        needs: 'POST /notifications/refresh',
      },
    ],
  },
  {
    phase: 5,
    title: PHASE_TITLES[5],
    summary: 'The business layer: products, customers and the numbers a solo operator has to watch.',
    rows: [
      { label: 'Business overview', status: 'planned', detail: 'Revenue, pipeline and delivery on one screen.' },
      { label: 'Products', status: 'planned', detail: 'SKUs, pricing, availability.' },
      { label: 'Analytics', status: 'planned', detail: 'Trends, cohorts and a monthly report you can send.' },
      { label: 'Customers', status: 'planned', detail: 'Accounts with health and lifetime value.' },
      { label: 'Reviews', status: 'planned', detail: 'Collect, answer and publish testimonials.' },
      {
        label: 'Export and activity',
        status: 'live',
        detail: 'Every table can already be dumped as JSON, and each write is logged — the base for reporting.',
        needs: 'GET /export · GET /activity',
      },
    ],
  },
  {
    phase: 6,
    title: PHASE_TITLES[6],
    summary: 'Natural-language actions over your own data, never invented answers.',
    rows: [
      {
        label: 'AI assistant',
        status: 'blocked',
        detail: 'A chat surface that turns a sentence into real API calls, with the diff shown before it writes.',
        needs: 'server-side key + MYOS_AI_ENABLED',
      },
      {
        label: 'Import from an agent',
        status: 'live',
        detail: 'Paste JSON from any coding agent into Tasks › Import; the server cleans it and reports every rejection.',
        needs: 'POST /tasks/import',
      },
      {
        label: 'Rule-based insights',
        status: 'live',
        detail: 'Deterministic, unit-tested insight rules on the dashboard — useful today, no tokens involved.',
        needs: 'GET /dashboard',
      },
    ],
  },
]

export default function RoadmapView() {
  const health = useHealth()

  return (
    <div className="os-enter space-y-4">
      <header className="min-w-0">
        <p className="os-eyebrow">System</p>
        <h1 className="os-title">Roadmap</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Phase 1 is the personal operating layer you can use today: projects, tasks, notes, people,
          notifications, activity and settings, all against the real API. Later phases are listed
          with the endpoint they need, so nothing here looks more finished than it is.
        </p>
      </header>

      <AiPanel aiEnabled={health.data?.ai_enabled ?? null} loading={health.loading && !health.data} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {PHASES.map((entry) => (
          <div key={entry.phase} id={`phase-${entry.phase}`} className="min-w-0 scroll-mt-20">
            {ANCHORS_BY_PHASE[entry.phase].map((anchor) => (
              <span key={anchor} id={anchor} className="block scroll-mt-20" aria-hidden />
            ))}
            <Panel
              dense
              icon={<Rocket />}
              title={`Phase ${entry.phase} · ${entry.title}`}
              description={entry.summary}
            >
              <ul className="min-w-0 space-y-1.5">
                {entry.rows.map((row) => (
                  <RoadmapRow key={row.label} row={row} />
                ))}
              </ul>
            </Panel>
          </div>
        ))}
      </div>

      <Panel dense title="What Phase 1 ships" description="The sidebar entries without a phase badge">
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {OS_NAV_GROUPS.flatMap((group) => group.items)
            .filter((item: OsNavItem) => item.href)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href!}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2 transition-colors hover:border-line-strong"
              >
                <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
                  <item.icon />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                  {item.label}
                </span>
                <Check className="size-3.5 shrink-0 text-success" aria-label="Available" />
              </Link>
            ))}
        </div>
      </Panel>

      <p className="text-[11px] text-faint">
        Anchors are stable: the sidebar links unbuilt modules here as{' '}
        <span className="os-mono">/os/roadmap#crm</span>, <span className="os-mono">#career</span>,{' '}
        <span className="os-mono">#finance</span>, <span className="os-mono">#business</span>,{' '}
        <span className="os-mono">#integrations</span> and <span className="os-mono">#ai</span>.
      </p>
    </div>
  )
}

function RoadmapRow({ row }: { row: PhaseRow }) {
  const tone =
    row.status === 'live'
      ? 'border-success/35 bg-success/5'
      : row.status === 'blocked'
        ? 'border-warning/35 bg-warning/5'
        : 'border-line bg-card/50'
  return (
    <li className={cn('rounded-lg border px-2.5 py-2', tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-foreground">{row.label}</span>
        <Badge
          tone={row.status === 'live' ? 'success' : row.status === 'blocked' ? 'warning' : 'outline'}
          size="sm"
        >
          {row.status}
        </Badge>
      </div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{row.detail}</p>
      {row.needs ? (
        <p className="os-mono mt-1 text-[10.5px] text-faint">needs {row.needs}</p>
      ) : null}
    </li>
  )
}

/** Says exactly what to configure. Never pretends the assistant is available. */
function AiPanel({ aiEnabled, loading }: { aiEnabled: boolean | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <SkeletonCard />
      </div>
    )
  }

  return (
    <Panel dense icon={<Sparkles />} title="AI assistant" description="Reported by GET /health">
      {aiEnabled === null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          <TriangleAlert className="size-3.5" />
          The API is not reachable, so the assistant state is unknown.
          <span className="text-[11px] text-muted-foreground">
            Start the backend, then reload this page.
          </span>
        </div>
      ) : aiEnabled ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-[12.5px] text-foreground">
            <Badge tone="success" size="sm">
              enabled
            </Badge>
            The backend reports an AI provider is configured.
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            The chat surface itself is Phase 6, so there is no assistant screen to use yet — today
            the AI-ready part of Phase 1 is <span className="os-mono">Tasks › Import</span>, which
            takes JSON produced by any agent and reports exactly what it accepted.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-[12.5px] text-warning">
            <Clock className="size-3.5" />
            <Badge tone="warning" size="sm">
              ai_enabled: false
            </Badge>
            Nothing is installed server-side, so no answers are simulated here.
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            To turn the assistant on: give the backend a provider key, expose an AI route, and flip{' '}
            <span className="os-mono">ai_enabled</span> in <span className="os-mono">GET /health</span>.
            Until then, the import path in Tasks is the fastest way to get agent output into MyOS.
          </p>
        </div>
      )}
    </Panel>
  )
}

/** Every `/os/roadmap#<slug>` the sidebar can produce, grouped by its phase. */
const ANCHORS_BY_PHASE: Record<OsPhase, string[]> = OS_NAV_GROUPS.reduce(
  (acc, group) => {
    for (const item of group.items) {
      if (!item.anchor || !item.phase) continue
      const list = acc[item.phase] ?? []
      if (!list.includes(item.anchor)) acc[item.phase] = [...list, item.anchor]
    }
    return acc
  },
  {} as Record<OsPhase, string[]>
)