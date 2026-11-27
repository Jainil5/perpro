/**
 * The canonical enum values from docs/MYOS/API.md, which is itself copied from
 * the running `GET /meta`. This list only covers the moment /meta has not
 * answered; it is never a stand-in for real records and never a place to
 * invent a value.
 */

import type { EnumSet } from './types'

export const CANONICAL_ENUMS: EnumSet = {
  project_status: ['backlog', 'planning', 'in_progress', 'on_hold', 'review', 'completed', 'archived'],
  task_status: ['todo', 'in_progress', 'blocked', 'done', 'dropped'],
  priority: ['low', 'medium', 'high', 'urgent'],
  recurrence: ['none', 'daily', 'weekly', 'fortnightly', 'monthly'],
  note_category: [
    'technical',
    'ai_ml',
    'business_idea',
    'meeting',
    'project_doc',
    'learning',
    'startup',
    'personal',
    'resource',
  ],
  notification_kind: [
    'task_overdue',
    'task_due',
    'milestone',
    'reminder',
    'project_stalled',
    'system',
    // Phase 3 · Finance (docs/MYOS/PHASE3_FINANCE.md §5)
    'subscription_renewing',
    'expense_recurring_due',
    'income_overdue',
    'rate_stale',
    // Phase 2 · Career & CRM (docs/MYOS/PHASE2_CAREER_CRM.md §5)
    'interview_upcoming',
    'application_stale',
    'lead_follow_up',
    'client_contract_end',
  ],
  notification_severity: ['info', 'warning', 'critical'],
  activity_verb: [
    'created',
    'updated',
    'completed',
    'reopened',
    'deleted',
    'commented',
    'moved',
    // Phase 2 · a funnel hop and a win are their own verbs, not a generic `updated`
    'transitioned',
    'promoted',
  ],
  goal_status: ['active', 'completed', 'abandoned'],
  milestone_status: ['open', 'done'],
  reminder_status: ['pending', 'done'],
  contact_kind: ['client', 'prospect', 'partner', 'vendor', 'mentor', 'personal', 'other'],
  note_relation_target_type: ['task', 'note', 'project', 'milestone', 'contact', 'company', 'goal'],
  source: ['user', 'demo', 'import', 'ai'],
  /* Phase 3 · Finance — the keys §5 of the contract adds to /meta. */
  income_kind: ['salary', 'freelance', 'contract', 'business', 'mixed'],
  income_status: ['expected', 'invoiced', 'paid', 'overdue', 'written_off'],
  income_method: ['bank', 'card', 'upi', 'cash', 'crypto', 'other'],
  tax_regime: ['none', 'flat', 'slab', 'presumptive'],
  service_unit: ['hour', 'day', 'fixed', 'retainer', 'seat'],
  plan_interval: ['monthly', 'quarterly', 'yearly', 'one_time'],
  subscription_status: ['trialing', 'active', 'paused', 'cancelled', 'expired'],
  expense_category_kind: ['fixed', 'variable', 'one_off', 'tax'],
  expense_recurrence: ['none', 'weekly', 'monthly', 'quarterly', 'yearly'],
  scenario_kind: ['personal', 'business', 'hybrid'],
  scenario_status: ['draft', 'active', 'archived'],
  scenario_item_direction: ['income', 'cost'],
  /* Phase 2 · Career & CRM (docs/MYOS/PHASE2_CAREER_CRM.md §3) */
  job_application_status: [
    'saved',
    'applied',
    'screening',
    'interview',
    'offer',
    'hired',
    'rejected',
    'withdrawn',
  ],
  job_application_channel: ['referral', 'job_board', 'recruiter', 'website', 'event', 'other'],
  job_interview_type: ['phone', 'video', 'onsite', 'technical', 'hr', 'other'],
  job_interview_status: ['scheduled', 'completed', 'cancelled', 'no_show'],
  job_interview_outcome: ['positive', 'neutral', 'negative', 'pending'],
  lead_status: ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'dormant'],
  lead_origin: ['website', 'referral', 'inbound', 'outbound', 'event', 'social', 'other'],
  client_stage: ['onboarding', 'active', 'at_risk', 'churned', 'archived'],
  client_health: ['green', 'amber', 'red', 'unknown'],
  meeting_status: ['scheduled', 'completed', 'cancelled', 'no_show'],
  // `meeting.entity_type` is a polymorphic tag with no CHECK, exactly like `reminders`:
  // Phase 1's targets plus the Phase 2 records, and never `meeting` itself.
  meeting_entity_type: [
    'task',
    'note',
    'project',
    'milestone',
    'contact',
    'company',
    'goal',
    'job_application',
    'lead',
    'client',
  ],
}

/** Kanban columns, in board order. `dropped` is shown in list views only. */
export const TASK_BOARD_COLUMNS = ['todo', 'in_progress', 'blocked', 'done'] as const

export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'] as const

export const ACTIVE_PROJECT_STATUSES = ['backlog', 'planning', 'in_progress', 'on_hold', 'review'] as const

export function isOpenStatus(status: string): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(status)
}

export function isActiveProject(status: string): boolean {
  return (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(status)
}
