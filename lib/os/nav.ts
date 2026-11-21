'use client'

import {
  Activity,
  Archive,
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
  Inbox,
  LayoutDashboard,
  ListChecks,
  Newspaper,
  Notebook,
  Plug,
  Receipt,
  Repeat,
  Rocket,
  Search,
  Settings,
  Star,
  Target,
  TrendingUp,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react'

/**
 * The navigation model for the whole app — `components/Shell.tsx` renders it in
 * the sidebar and in the mobile drawer, so there is exactly one nav source.
 * Anything not shipped yet links to the roadmap anchor for its phase instead of
 * pretending to be a working screen.
 */

export type OsPhase = 2 | 3 | 4 | 5 | 6

export interface OsNavItem {
  label: string
  icon: LucideIcon
  /** Shipped destination. Omitted for roadmap entries. */
  href?: string
  /** Roadmap anchor for unbuilt modules (`/roadmap#<anchor>`). */
  anchor?: string
  phase?: OsPhase
  /** What the module will do, shown as a tooltip on roadmap entries. */
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
      { label: 'Today', icon: LayoutDashboard, href: '/', hint: 'Personal dashboard' },
      { label: 'Inbox', icon: Inbox, href: '/inbox', hint: 'Supabase quick capture' },
      { label: 'Tasks', icon: ListChecks, href: '/tasks' },
      { label: 'Projects', icon: Folder, href: '/projects' },
      { label: 'Notes', icon: Notebook, href: '/notes' },
      { label: 'Meetings', icon: Video, href: '/meetings', hint: 'Supabase agenda and action items' },
      { label: 'People', icon: Users, href: '/contacts', hint: 'Contacts and companies' },
      { label: 'Goals', icon: Target, href: '/goals' },
      { label: 'Career', icon: Briefcase, anchor: 'career', phase: 2, hint: 'Jobs, applications and interview pipeline' },
      { label: 'Freelance CRM', icon: Contact, anchor: 'crm', phase: 2, hint: 'Leads, proposals, contracts and invoices' },
      { label: 'Calendar', icon: CalendarDays, anchor: 'integrations', phase: 4, hint: 'Two-way Google Calendar sync' },
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
      { label: 'Search', icon: Search, href: '/search' },
      { label: 'Notifications', icon: Bell, href: '/notifications' },
      { label: 'Activity', icon: Activity, href: '/activity' },
      { label: 'News', icon: Newspaper, href: '/news', hint: 'Supabase RSS feed' },
      { label: 'Settings', icon: Settings, href: '/settings' },
      { label: 'Roadmap', icon: Rocket, href: '/roadmap' },
      { label: 'Legacy', icon: Archive, href: '/legacy', hint: 'The old Supabase screens, preserved' },
    ],
  },
]

/** href → true when the current path is that page or something below it. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function roadmapHref(anchor: string): string {
  return `/roadmap#${anchor}`
}

/** Flat list of every shipped destination, used by the command palette. */
export const OS_PAGE_INDEX: { label: string; href: string; group: string }[] = [
  ...OS_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => item.href).map((item) => ({ label: item.label, href: item.href!, group: group.title }))
  ),
]
