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
      {
        label: 'Career board',
        status: 'live',
        detail: 'Roles, applications, interviews and offers as one funnel. Only legal stage hops are offered, and the interview slot is built from today rather than typed.',
        needs: 'GET /job-applications · POST /job-applications/{id}/transition',
      },
      {
        label: 'Freelance CRM',
        status: 'live',
        detail: 'Lead → contacted → qualified → proposal → won, with the follow-up clock on every row. Winning opens the account in the same call, so nothing is entered twice.',
        needs: 'GET /leads · POST /leads/{id}/transition · POST /leads/{id}/promote',
      },
      {
        label: 'Customer accounts',
        status: 'live',
        detail: 'Contract window, renewal warnings, health and lifetime value per currency. Monthly revenue is derived from the live subscriptions billing that account, never typed in.',
        needs: 'GET /clients · GET /clients/{id} · GET /crm/summary',
      },
      {
        label: 'Meetings on records',
        status: 'live',
        detail: 'One calendar for applications, interviews, leads and accounts. /meetings stays the Supabase screen; every Phase 2 link points at the record that owns the meeting.',
        needs: 'GET /meetings?entity_type=&entity_id=',
      },
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
      {
        label: 'Finance overview',
        status: 'live',
        detail: 'Net, runway, MRR, a 12-month in/out series and per-currency totals — all derived server-side.',
        needs: 'GET /finance/summary',
      },
      {
        label: 'Income calculator',
        status: 'live',
        detail: 'Profiles with slabs, deductions and presumptive tax; take-home, effective rate and runway come back from the API.',
        needs: 'GET /income-profiles · POST /income-profiles/preview',
      },
      {
        label: 'Income ledger',
        status: 'live',
        detail: 'Expected → invoiced → paid, with overdue days counted by the server and a breakdown by service.',
        needs: 'GET /income/summary · POST /income/{id}/mark-paid',
      },
      {
        label: 'Currency converter',
        status: 'live',
        detail: 'Works entirely on stored rate rows, so it answers offline; a sync is an explicit button, never a background call.',
        needs: 'GET /convert · POST /exchange-rates/sync',
      },
      {
        label: 'Subscriptions',
        status: 'live',
        detail: 'Renewal dates normalised from any interval, pause/resume/cancel as real states, and the burn they add.',
        needs: 'GET /subscriptions · POST /subscriptions/{id}/pause',
      },
      {
        label: 'Service catalogue',
        status: 'live',
        detail: 'Units, plans and the revenue each service earned — the detail pane reads one endpoint, so it cannot disagree with itself.',
        needs: 'GET /services/{id}',
      },
      {
        label: 'Cost scenarios',
        status: 'live',
        detail: 'Lines in, curve out: break-even, runway and a two-plan comparison on one month axis, rebuilt on every read.',
        needs: 'GET /cost-scenarios/{id}/projection · GET /cost-scenarios/compare',
      },
      {
        label: 'Expenses',
        status: 'live',
        detail: 'Categories with a tree, recurring lines feeding the burn, top vendors and CSV export.',
        needs: 'GET /expenses/summary · GET /expenses/export.csv',
      },
      {
        label: 'Currency field',
        status: 'live',
        detail: 'The workspace stores a currency and a timezone, so every money screen formats and derives dates the same way.',
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
      {
        label: 'Stripe',
        status: 'planned',
        detail: 'Payouts and webhook-driven renewals. The ledger works without it — the connector would only import what already happened.',
        needs: 'POST /integrations/stripe/webhook',
      },
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
      {
        label: 'Customers',
        status: 'live',
        detail: 'Shipped in Phase 2 as /customers — accounts, contracts, health and per-currency lifetime value. This phase adds the product and review layer around them.',
        needs: 'GET /clients',
      },
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
      <header className="min-w-0 border-b border-line pb-4">
        <p className="os-label">System</p>
        <h1 className="os-title">Roadmap</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Phase 1 is the personal operating layer you can use today: projects, tasks, notes, people,
          notifications, activity and settings, all against the real API. Later phases are listed
          with the endpoint they need, so nothing here looks more finished than it is.
        </p>
      </header>

      <AiPanel aiEnabled={health.data?.ai_enabled ?? null} loading={health.loading && !health.data} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {PHASES.map((entry) => (
          <div key={entry.phase} id={`phase-${entry.phase}`} className="min-w-0 scroll-mt-20">
            {(ANCHORS_BY_PHASE[entry.phase] ?? []).map((anchor) => (
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

      <Panel
        dense
        title="What you can click today"
        description="Every sidebar entry with a real route. The entries without one are anchored to the phase that builds them, above."
    >
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {OS_NAV_GROUPS.flatMap((group) => group.items)
            .filter((item: OsNavItem) => item.href)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href!}
                className="flex min-w-0 items-center gap-2 rounded-os border border-line px-2.5 py-2 transition-colors hover:border-line-strong"
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
        <span className="os-mono">/roadmap#crm</span>, <span className="os-mono">#career</span>,{' '}
        <span className="os-mono">#finance</span>, <span className="os-mono">#business</span> and{' '}
        <span className="os-mono">#integrations</span>.
      </p>
    </div>
  )
}

function RoadmapRow({ row }: { row: PhaseRow }) {
  const tone =
    row.status === 'live'
      ? 'border-success'
      : row.status === 'blocked'
        ? 'border-warning'
        : 'border-line'
  return (
    <li className={cn('rounded-os border px-2.5 py-2', tone)}>
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
        <div className="flex flex-wrap items-center gap-2 border-y border-line px-3 py-2 text-[12px] text-destructive">
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

/** Every `/roadmap#<slug>` the sidebar can produce, grouped by its phase. */
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