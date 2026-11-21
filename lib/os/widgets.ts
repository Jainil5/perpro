/**
 * Dashboard widget configuration: order + visibility, persisted per workspace
 * in localStorage (`myos.widgets.<slug>`) as required by the Phase 1 brief.
 */

export type WidgetId =
  | 'insights'
  | 'agenda'
  | 'today'
  | 'overdue'
  | 'projects'
  | 'milestones'
  | 'notifications'
  | 'notes'
  | 'activity'

export interface WidgetDef {
  id: WidgetId
  title: string
  hint: string
  /** Column span in the default grid. */
  width: 'full' | 'half'
}

export const WIDGET_DEFS: WidgetDef[] = [
  { id: 'insights', title: 'Insights', hint: 'Rule-based readings of your data', width: 'full' },
  { id: 'agenda', title: "Today's agenda", hint: 'Tasks, reminders and milestones dated today', width: 'half' },
  { id: 'today', title: "Today's tasks", hint: 'Tick items off without leaving the dashboard', width: 'half' },
  { id: 'overdue', title: 'Overdue', hint: 'Everything past its due date', width: 'half' },
  { id: 'projects', title: 'Active projects', hint: 'Progress and the next action on each', width: 'full' },
  { id: 'milestones', title: 'Upcoming milestones', hint: 'Dates you are steering towards', width: 'half' },
  { id: 'notifications', title: 'Notifications', hint: 'Unread digest with severity', width: 'half' },
  { id: 'notes', title: 'Recent notes', hint: 'The last few things you wrote', width: 'half' },
  { id: 'activity', title: 'Activity', hint: 'Everything that changed, newest first', width: 'half' },
]

export interface WidgetPrefs {
  order: WidgetId[]
  hidden: WidgetId[]
}

export const WIDGET_IDS: WidgetId[] = WIDGET_DEFS.map((w) => w.id)

export function defaultWidgetPrefs(): WidgetPrefs {
  return { order: [...WIDGET_IDS], hidden: [] }
}

export function widgetPrefsKey(slug: string): string {
  return `myos.widgets.${slug || 'default'}`
}

/** Repairs prefs stored by an older build (missing or removed widgets). */
export function normaliseWidgetPrefs(prefs: Partial<WidgetPrefs> | null | undefined): WidgetPrefs {
  const base = defaultWidgetPrefs()
  if (!prefs || !Array.isArray(prefs.order)) return base
  const known = prefs.order.filter((id): id is WidgetId => WIDGET_IDS.includes(id))
  const missing = WIDGET_IDS.filter((id) => !known.includes(id))
  const hidden = (prefs.hidden ?? []).filter((id): id is WidgetId => WIDGET_IDS.includes(id))
  return { order: [...known, ...missing], hidden }
}

/** Moves a widget up or down inside the visible order. */
export function moveWidget(order: WidgetId[], id: WidgetId, direction: -1 | 1): WidgetId[] {
  const next = [...order]
  const from = next.indexOf(id)
  const to = from + direction
  if (from === -1 || to < 0 || to >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
