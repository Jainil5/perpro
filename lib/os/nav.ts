'use client'

import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  CalendarDays,
  Contact,
  Folder,
  LayoutDashboard,
  ListChecks,
  Notebook,
  Plug,
  Receipt,
  Repeat,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * The sidebar model. Anything not shipped in Phase 1 links to the roadmap
 * anchor for its phase instead of pretending to be a working screen.
 */

export type OsPhase = 2 | 3 | 4 | 5 | 6

export interface OsNavItem {
  label: string
  icon: LucideIcon
  /** Phase 1 destination. Omitted for roadmap entries. */
  href?: string
  /** Roadmap anchor for unbuilt modules (`/os/roadmap#<anchor>`). */
  anchor?: string
  phase?: OsPhase
  /** What the module will do, shown as a tooltip on disabled entries. */
  hint?: string
}

export interface OsNavGroup {
  title: string
  items: OsNavItem[]
}

export const PHASE_TITLES: Record<OsPhase, string> = {
  2: 'Career & CRM',
  3: 'Finance',
  4: 'Integrations',
  5: 'Business OS',
  6: 'AI automation',
}

export const OS_NAV_GROUPS: OsNavGroup[] = [
  {
    title: 'Personal',
    items: [
      { label: 'Overview', icon: LayoutDashboard, href: '/os' },
      { label: 'Career', icon: Briefcase, anchor: 'career', phase: 2, hint: 'Jobs, applications and interview pipeline' },
      { label: 'Freelance CRM', icon: Contact, anchor: 'crm', phase: 2, hint: 'Leads, proposals, contracts and invoices' },
      { label: 'Projects', icon: Folder, href: '/os/projects' },
      { label: 'Tasks', icon: ListChecks, href: '/os/tasks' },
      { label: 'Calendar', icon: CalendarDays, anchor: 'integrations', phase: 4, hint: 'Two-way Google Calendar sync' },
      { label: 'Notes', icon: Notebook, href: '/os/notes' },
      { label: 'Goals', icon: Target, href: '/os/goals' },
      { label: 'People', icon: Users, href: '/os/contacts', hint: 'Contacts and companies' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Income Calculator', icon: Calculator, anchor: 'finance', phase: 3, hint: 'Take-home, tax and runway maths' },
      { label: 'Currency Converter', icon: ArrowLeftRight, anchor: 'finance', phase: 3, hint: 'Live rates and multi-currency totals' },
      { label: 'Subscriptions', icon: Repeat, anchor: 'finance', phase: 3, hint: 'Recurring spend and renewal dates' },
      { label: 'Service Catalogue', icon: Boxes, anchor: 'finance', phase: 3, hint: 'Packages, rates and what you sell' },
      { label: 'Cost Scenarios', icon: TrendingUp, anchor: 'finance', phase: 3, hint: 'Compare plans against targets' },
      { label: 'Expenses', icon: Receipt, anchor: 'finance', phase: 3, hint: 'Logged spend, categories and exports' },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Business Overview', icon: Building2, anchor: 'business', phase: 5, hint: 'One screen across revenue, pipeline and delivery' },
      { label: 'Products', icon: Boxes, anchor: 'business', phase: 5, hint: 'SKUs, pricing and availability' },
      { label: 'Analytics', icon: BarChart3, anchor: 'business', phase: 5, hint: 'Trends, cohorts and monthly reports' },
      { label: 'Customers', icon: Users, anchor: 'crm', phase: 2, hint: 'Accounts, health and lifetime value' },
      { label: 'Reviews', icon: Star, anchor: 'business', phase: 5, hint: 'Collect and answer customer reviews' },
      { label: 'Integrations', icon: Plug, anchor: 'integrations', phase: 4, hint: 'Google, Stripe, Slack and WhatsApp connectors' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'AI Assistant', icon: Sparkles, anchor: 'ai', phase: 6, hint: 'Natural-language actions over your own data' },
      { label: 'Notifications', icon: Bell, href: '/os/notifications' },
      { label: 'Search', icon: Search, href: '/os/search' },
      { label: 'Activity', icon: Activity, href: '/os/activity' },
      { label: 'Settings', icon: Settings, href: '/os/settings' },
    ],
  },
]

/** Footer entries that are not part of a module group. */
export const OS_NAV_FOOTER: OsNavItem[] = [
  { label: 'Roadmap', icon: Rocket, href: '/os/roadmap' },
]

/** href → true when the current path is that page or something below it. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/os') return pathname === '/os' || pathname === '/os/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function roadmapHref(anchor: string): string {
  return `/os/roadmap#${anchor}`
}

/** Flat list of every Phase 1 destination, used by the command palette. */
export const OS_PAGE_INDEX: { label: string; href: string; group: string }[] = [
  ...OS_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => item.href).map((item) => ({ label: item.label, href: item.href!, group: group.title }))
  ),
  ...OS_NAV_FOOTER.map((item) => ({ label: item.label, href: item.href!, group: 'System' })),
]
