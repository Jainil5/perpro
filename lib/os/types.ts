/**
 * TypeScript mirror of docs/MYOS/API.md. Nothing here is invented: field names,
 * enum members and response envelopes follow the contract exactly, because the
 * FastAPI backend is written against the same document.
 */

/* ------------------------------------------------------------------ enums -- */

export type ProjectStatus =
  | 'backlog'
  | 'planning'
  | 'in_progress'
  | 'on_hold'
  | 'review'
  | 'completed'
  | 'archived'

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'dropped'

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'

export type NoteCategory =
  | 'technical'
  | 'ai_ml'
  | 'business_idea'
  | 'meeting'
  | 'project_doc'
  | 'learning'
  | 'startup'
  | 'personal'
  | 'resource'

export type NotificationKind =
  | 'task_overdue'
  | 'task_due'
  | 'milestone'
  | 'reminder'
  | 'project_stalled'
  | 'system'

export type ActivityVerb =
  | 'created'
  | 'updated'
  | 'completed'
  | 'reopened'
  | 'deleted'
  | 'commented'
  | 'moved'

export type MilestoneStatus = 'open' | 'done'

/** `critical | warning | info | success` in practice; the API may add more. */
export type Severity = 'critical' | 'warning' | 'info' | 'success' | (string & {})

/** Task `due` filter, verbatim from the contract. */
export type DueFilter = 'today' | 'week' | 'overdue' | 'none' | 'upcoming'

export type TaskSort = 'due' | 'priority' | 'created' | 'position'
export type ProjectSort = 'updated' | 'target' | 'name'
export type NoteSort = 'updated' | 'created' | 'title'

export type RelationTargetType = 'task' | 'project' | 'contact' | 'company' | 'note' | 'milestone'

/* -------------------------------------------------------------- envelopes -- */

export interface ListResponse<T> {
  items: T[]
  total: number
}

export interface PagedListResponse<T> extends ListResponse<T> {
  limit: number
  offset: number
}

/* ------------------------------------------------------------------- meta -- */

export interface Health {
  status: string
  version: string
  workspace: string
  database: string
  ai_enabled: boolean
}

export interface Workspace {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  created_at: string
}

/**
 * Enumerations the UI reads. `GET /meta` serves them keyed exactly as API.md
 * writes them (`task.status`, `note.category`); `useEnums` re-keys them into
 * these property names, so no screen has to care which spelling the server used.
 * The declared keys are guaranteed; anything the backend adds later arrives
 * through the index signature and renders as the raw string.
 */
export interface EnumSet {
  project_status: string[]
  task_status: string[]
  priority: string[]
  recurrence: string[]
  note_category: string[]
  notification_kind: string[]
  notification_severity: string[]
  activity_verb: string[]
  goal_status: string[]
  milestone_status: string[]
  reminder_status: string[]
  contact_kind: string[]
  note_relation_target_type: string[]
  source: string[]
  [key: string]: string[] | undefined
}

export interface Meta {
  /** Wire shape, straight from `/meta` — dotted keys; see `useEnums`. */
  enums: Record<string, string[]>
  counts: Record<string, number>
}

/* ---------------------------------------------------------------- project -- */

export interface TaskCounts {
  total: number
  done: number
  open: number
  overdue: number
}

export interface NextDue {
  title: string
  due_date: string | null
}

export interface Project {
  id: string
  name: string
  description: string | null
  category: string | null
  status: ProjectStatus | string
  priority: Priority | string
  start_date: string | null
  target_date: string | null
  repository_url: string | null
  documentation_url: string | null
  next_action: string | null
  manual_progress: number
  progress: number
  task_counts: TaskCounts
  next_due: NextDue | null
  milestone_count: number
  milestones_done: number
  created_at: string
  updated_at: string
}

export interface ProjectInput {
  name: string
  description?: string | null
  category?: string | null
  status?: ProjectStatus | string
  priority?: Priority | string
  start_date?: string | null
  target_date?: string | null
  repository_url?: string | null
  documentation_url?: string | null
  next_action?: string | null
  manual_progress?: number
}

export interface ProjectStats {
  total: number
  done: number
  open: number
  overdue: number
  due_today: number
  pct: number
  next_due: NextDue | null
  by_status: Record<string, number>
  by_priority: Record<string, number>
}

export interface DeadlineSoon {
  id: string
  name: string
  target_date: string | null
  days_left: number
}

/* ------------------------------------------------------------------- task -- */

export interface TaskRef {
  id: string
  name: string
  status: ProjectStatus | string
}

export interface Task {
  id: string
  title: string
  description: string | null
  notes: string | null
  project_id: string | null
  project: TaskRef | null
  parent_task_id: string | null
  status: TaskStatus | string
  priority: Priority | string
  due_date: string | null
  start_date: string | null
  estimated_minutes: number | null
  actual_minutes: number | null
  recurrence: TaskRecurrence | string
  tags: string[] | null
  position: number
  is_overdue: boolean
  is_due_today: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TaskInput {
  title: string
  description?: string | null
  notes?: string | null
  project_id?: string | null
  parent_task_id?: string | null
  status?: TaskStatus | string
  priority?: Priority | string
  due_date?: string | null
  start_date?: string | null
  estimated_minutes?: number | null
  actual_minutes?: number | null
  recurrence?: TaskRecurrence | string
  tags?: string[]
}

export interface CompleteResult {
  task: Task
  next: Task | null
}

export interface BulkInput {
  ids: string[]
  action: 'complete' | 'delete' | 'set_priority' | 'set_project'
  value?: string | null
}

export interface BulkResult {
  updated: number
  failed: { id: string; error: string }[]
}

export interface ImportInput {
  raw: string
  project_id?: string | null
  allow_duplicates?: boolean
}

export interface ImportResult {
  created: number
  duplicates: number
  rejected: { index: number; title: string | null; reason: string }[]
  warnings: string[]
}

/* -------------------------------------------------------------- milestone -- */

export interface Milestone {
  id: string
  project_id: string
  title: string
  description: string | null
  date: string | null
  status: MilestoneStatus | string
  completed_at: string | null
  days_away: number | null
  created_at: string
  updated_at: string
}

export interface MilestoneInput {
  project_id: string
  title: string
  description?: string | null
  date?: string | null
  status?: MilestoneStatus | string
}

/* ------------------------------------------------------------------- note -- */

export interface NoteRelation {
  id: string
  target_type: RelationTargetType | string
  target_id: string
  target_title: string | null
}

export interface NoteBacklink {
  note_id: string
  note_title: string
}

export interface Note {
  id: string
  title: string
  content: string
  category: NoteCategory | string | null
  tags: string[] | null
  is_favorite: boolean
  project_id: string | null
  word_count: number
  relations: NoteRelation[]
  backlinks: NoteBacklink[]
  created_at: string
  updated_at: string
}

export interface NoteSummary {
  id: string
  title: string
  category: NoteCategory | string | null
  tags: string[] | null
  is_favorite: boolean
  project_id: string | null
  word_count: number
  excerpt: string | null
  created_at: string
  updated_at: string
}

export interface NoteInput {
  title: string
  content?: string | null
  category?: NoteCategory | string | null
  tags?: string[]
  project_id?: string | null
  is_favorite?: boolean
  relations?: { target_type: RelationTargetType | string; target_id: string }[]
}

export interface NotesListResponse extends ListResponse<NoteSummary> {
  categories: { category: string; count: number }[]
}

export interface NoteTag {
  tag: string
  count: number
}

/* ------------------------------------------------------------ people ------ */

export interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  title: string | null
  company_id: string | null
  company: string | null
  location: string | null
  kind: string | null
  tags: string[] | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ContactInput {
  name: string
  email?: string | null
  phone?: string | null
  title?: string | null
  company_id?: string | null
  location?: string | null
  kind?: string | null
  tags?: string[]
  notes?: string | null
}

export interface Company {
  id: string
  name: string
  website: string | null
  industry: string | null
  location: string | null
  notes: string | null
  contact_count: number
  created_at: string
  updated_at: string
}

export interface CompanyInput {
  name: string
  website?: string | null
  industry?: string | null
  location?: string | null
  notes?: string | null
}

/* --------------------------------------------------------- notifications -- */

export interface Notification {
  id: string
  kind: NotificationKind | string
  severity: Severity
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  href: string | null
  read: boolean
  read_at: string | null
  dedupe_key: string | null
  created_at: string
  updated_at: string
}

export interface Reminder {
  id: string
  title: string
  due_at: string | null
  status: string
  entity_type: string | null
  entity_id: string | null
  notes: string | null
  snoozed_until: string | null
  created_at: string
  updated_at: string
}

export interface ReminderInput {
  title: string
  due_at?: string | null
  entity_type?: string | null
  entity_id?: string | null
  notes?: string | null
}

/** `GET /notifications` adds an `unread` count next to the standard envelope. */
export interface NotificationsResponse extends ListResponse<Notification> {
  unread: number
}

export interface RefreshResult {
  created: number
  resolved: number
}

/* --------------------------------------------------------------- activity -- */

export interface ActivityLog {
  id: string
  verb: ActivityVerb | string
  entity_type: string
  entity_id: string | null
  entity_title: string | null
  summary: string
  project_id: string | null
  href: string | null
  actor: string | null
  created_at: string
}

/* ----------------------------------------------------------------- search -- */

export interface SearchItem {
  id: string
  title: string
  subtitle: string | null
  href: string
  badge: string | null
}

export interface SearchGroup {
  type: string
  label: string
  href: string
  items: SearchItem[]
}

export interface SearchResponse {
  query: string
  groups: SearchGroup[]
  total: number
}

/* -------------------------------------------------------------- dashboard -- */

export interface Insight {
  kind: string
  severity: Severity
  text: string
  /** Deep link into whatever triggered the rule, e.g. `/os/tasks?filter=overdue`. */
  href?: string | null
}

export interface Dashboard {
  today: string
  tasks: {
    due_today: Task[]
    overdue: Task[]
    upcoming: Task[]
    completed_this_week: number
    open: number
  }
  projects: {
    active: Project[]
    deadline_soon: DeadlineSoon[]
  }
  people: { new_contacts_30d: number }
  notes: { recent: NoteSummary[] }
  milestones: { upcoming: Milestone[] }
  reminders: { due: Reminder[] }
  notifications: { unread: number; items: Notification[] }
  activity: ActivityLog[]
  insights: Insight[]
}

/* ------------------------------------------------------------------- goal -- */

/**
 * Goal, as served by `GET /goals` (docs/MYOS/API.md §Goals): the standard
 * `{ items, total }` envelope plus these fields.
 *
 * `project_id` is a nullable FK with ON DELETE SET NULL — an unknown id is a 422
 * `project_id not found`, `null` detaches the goal, and deleting the project
 * keeps the goal and nulls the link. `project` is served, never joined here, and
 * goal progress stays independent of that project's task-derived percentage.
 */
export interface Goal {
  id: string
  title: string
  description: string | null
  /** Free text on this table (`learning`, `client`, …) — `/meta` serves no enum for it. */
  category: string | null
  priority: string
  status: string
  progress: number
  target_date: string | null
  completed_at: string | null
  project_id: string | null
  project: TaskRef | null
  created_at: string
  updated_at: string
}

export interface GoalInput {
  title: string
  description?: string | null
  category?: string | null
  priority?: string
  status?: string
  progress?: number
  target_date?: string | null
  project_id?: string | null
}

/* ------------------------------------------------------------------ export -- */

export interface ExportPayload {
  exported_at: string
  workspace: Workspace | null
  tables: Record<string, unknown[]>
}

export interface SeedResult {
  created: Record<string, number>
  skipped: boolean
}
