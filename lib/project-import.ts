import type { Priority } from './types';

/**
 * Shared JSON import logic for project tasks. Used by the import modal for live
 * validation and by /api/projects/import for the actual write, so the preview and
 * the result can never disagree.
 */

export const MAX_NOTES_LENGTH = 20_000;

/** What goes in the textarea placeholder — the exact shape agents should produce. */
export const IMPORT_EXAMPLE = `{
  "tasks": [
    {
      "title": "OrderBook: Configure Supabase RLS & brand isolation policies",
      "category": "Database & Security",
      "notes": "Ensure brand_id is enforced across all tables using Row Level Security.",
      "completed": false,
      "priority": "High",
      "due_date": "2026-11-03"
    }
  ]
}`;

export const IMPORT_FIELDS_HELP = `- title      required, non-empty string
- category   optional string — tasks group by it in the project view
- notes      optional string — can be long (capped at ${MAX_NOTES_LENGTH.toLocaleString()} characters)
- completed  optional boolean — "done"/"status" are also accepted
- priority   optional — Low | Medium | High | Urgent, case-insensitive, "Critical" maps to Urgent
- due_date   optional — YYYY-MM-DD (a full timestamp is fine, the date is kept)

A bare array of task objects works too. Any "id" in the payload is ignored: the
server always assigns a fresh id, so the same JSON can be imported into several projects.`;

/** Ready to paste into an agent so it produces exactly what the importer expects. */
export function agentPrompt(projectName: string): string {
  return `Add tasks to my "${projectName}" project. Reply with JSON only — no prose, no markdown fence — in exactly this shape:

${IMPORT_EXAMPLE}

Rules:
${IMPORT_FIELDS_HELP}
- write every title as a standalone imperative sentence, prefixed with "${projectName}: " where it helps
- keep notes long if they need to be: decisions, constraints, and acceptance criteria belong there
- use a small set of repeated categories so tasks group cleanly
- completed work comes back with "completed": true
- use real YYYY-MM-DD due dates, never "soon" or "next week"`;
}

export interface ImportedTask {
  title: string;
  category: string | null;
  notes: string | null;
  priority: Priority;
  completed: boolean;
  due_date: string | null;
}

export interface ParseResult {
  tasks: ImportedTask[];
  /** Kept items that needed normalising — surfaced, but imported. */
  warnings: string[];
  /** Items we could not read at all, with the reason. */
  rejected: string[];
  /** Fatal: the payload was unreadable end to end. */
  error: string | null;
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  low: 'low',
  lo: 'low',
  minor: 'low',
  p4: 'low',
  medium: 'medium',
  med: 'medium',
  mid: 'medium',
  normal: 'medium',
  p3: 'medium',
  high: 'high',
  hi: 'high',
  important: 'high',
  p2: 'high',
  urgent: 'urgent',
  critical: 'urgent',
  blocker: 'urgent',
  asap: 'urgent',
  p1: 'urgent',
  highest: 'urgent',
};

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'done', 'complete', 'completed', 'closed', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'open', 'todo', 'to-do', 'pending', 'in progress', '0', '']);

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    // Agents occasionally hand back notes as a bullet list or nested object.
    return JSON.stringify(value, null, 2);
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (TRUE_WORDS.has(key)) return true;
    if (FALSE_WORDS.has(key)) return false;
  }
  return null;
}

/** Accepts YYYY-MM-DD, ISO timestamps and plain dates; returns YYYY-MM-DD or null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const direct = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (direct) return direct[0];
    if (!trimmed) return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${parsed.getUTCFullYear()}-${month}-${day}`;
}

function stripFences(raw: string): string {
  // Agents often wrap the payload in a fence plus a sentence of prose either side.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : raw).trim();
}

/** Tolerant parse: code fences, trailing commas (very common in hand-written JSON). */
export function looseJsonParse(raw: string): { value?: unknown; error?: string } {
  const text = stripFences(raw);
  if (!text) return { error: 'Nothing to import — paste the JSON first.' };
  try {
    return { value: JSON.parse(text) };
  } catch (first) {
    const repaired = text.replace(/,(\s*[}\]])/g, '$1');
    if (repaired !== text) {
      try {
        return { value: JSON.parse(repaired) };
      } catch {
        // fall through with the original error
      }
    }
    return { error: `That is not valid JSON. ${(first as Error).message}` };
  }
}

function pickList(value: unknown): { items?: unknown[]; error?: string } {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['tasks', 'items', 'todo', 'todos']) {
      if (Array.isArray(record[key])) return { items: record[key] };
    }
    if (record.task && typeof record.task === 'object') return { items: [record.task] };
    return { error: 'Expected an array of tasks, or an object with a "tasks" array.' };
  }
  return { error: 'Expected a JSON array, or an object with a "tasks" array.' };
}

function normalizeEntry(raw: unknown, index: number, warnings: string[], rejected: string[]): ImportedTask | null {
  const where = `Task ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    rejected.push(`${where}: not an object, skipped.`);
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const title = asText(entry.title ?? entry.name);
  if (!title) {
    rejected.push(`${where}: missing a title, skipped.`);
    return null;
  }

  let priority: Priority = 'medium';
  const rawPriority = entry.priority ?? entry.prio;
  if (rawPriority !== undefined && rawPriority !== null) {
    const mapped = PRIORITY_ALIASES[String(rawPriority).trim().toLowerCase()];
    if (mapped) {
      priority = mapped;
    } else {
      warnings.push(`${where}: unknown priority "${String(rawPriority)}" — imported as Medium.`);
    }
  }

  let completed = false;
  const rawCompleted = entry.completed ?? entry.done ?? entry.status ?? entry.state;
  if (rawCompleted !== undefined && rawCompleted !== null) {
    const flag = asBoolean(rawCompleted);
    if (flag === null) {
      warnings.push(`${where}: unreadable completion value — imported as open.`);
    } else {
      completed = flag;
    }
  }

  let notes = asText(entry.notes ?? entry.note ?? entry.description);
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    warnings.push(`${where}: notes trimmed from ${notes.length} to ${MAX_NOTES_LENGTH} characters.`);
    notes = notes.slice(0, MAX_NOTES_LENGTH);
  }

  let due_date: string | null = null;
  const rawDue = entry.due_date ?? entry.dueDate ?? entry.due ?? entry.deadline;
  if (rawDue !== undefined && rawDue !== null && rawDue !== '') {
    due_date = normalizeDate(rawDue);
    if (!due_date) warnings.push(`${where}: could not read the due date — imported without one.`);
  }

  const known = new Set([
    'title', 'name', 'category', 'notes', 'note', 'description', 'completed', 'done', 'status',
    'state', 'priority', 'prio', 'due_date', 'dueDate', 'due', 'deadline', 'id',
  ]);
  const extras = Object.keys(entry).filter((key) => !known.has(key));
  if (extras.length) warnings.push(`${where}: ignored unsupported field(s) ${extras.join(', ')}.`);

  return {
    title: title.slice(0, 300),
    category: asText(entry.category),
    notes,
    priority,
    completed,
    due_date,
  };
}

export function parseProjectImport(raw: string): ParseResult {
  const result: ParseResult = { tasks: [], warnings: [], rejected: [], error: null };
  const parsed = looseJsonParse(raw);
  if (parsed.error) {
    result.error = parsed.error;
    return result;
  }
  const list = pickList(parsed.value);
  if (list.error || !list.items) {
    result.error = list.error ?? 'Nothing to import.';
    return result;
  }
  if (!list.items.length) {
    result.error = 'That JSON has no tasks in it.';
    return result;
  }

  const seen = new Map<string, number>();
  list.items.forEach((item, index) => {
    const task = normalizeEntry(item, index, result.warnings, result.rejected);
    if (!task) return;
    const key = task.title.toLowerCase().replace(/\s+/g, ' ');
    const previous = seen.get(key);
    if (previous !== undefined) {
      result.rejected.push(`Task ${index + 1}: same title as task ${previous + 1}, skipped as a duplicate.`);
      return;
    }
    seen.set(key, index);
    result.tasks.push(task);
  });

  if (!result.tasks.length && !result.error) {
    result.error = 'No importable tasks — every entry was rejected.';
  }
  return result;
}

export function categoriesOf(tasks: ImportedTask[]): string[] {
  const names = tasks.map((t) => t.category).filter((c): c is string => !!c);
  return Array.from(new Set(names)).sort();
}

export function summarizeParse(parsed: ParseResult): string {
  const parts = [`${parsed.tasks.length} task${parsed.tasks.length === 1 ? '' : 's'} ready`];
  const cats = categoriesOf(parsed.tasks);
  if (cats.length) parts.push(`${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`);
  if (parsed.rejected.length) parts.push(`${parsed.rejected.length} skipped`);
  return parts.join(' · ');
}
