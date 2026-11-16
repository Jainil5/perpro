import { daysUntil } from './projects.ts';
import type { Project, ProjectTask } from './types';

export interface PromptContext {
  project: Pick<Project, 'name' | 'description' | 'status' | 'target_date'>;
  stats: { total: number; done: number; open: number; overdue: number };
  related?: ProjectTask[];
  nextMilestone?: { title: string; date: string | null } | null;
  today: string;
}

const FOLLOW_UP_SHAPE = `{
  "tasks": [
    { "title": "<new task title>", "category": "<same or new category>", "notes": "<what is left and why>", "completed": false, "priority": "Low | Medium | High | Urgent", "due_date": "YYYY-MM-DD" }
  ]
}`;

function statusLine(task: ProjectTask, today: string): string {
  if (task.completed) return 'done (it is already marked complete — treat this as a review or follow-up pass)';
  if (!task.due_date) return 'open, no due date';
  const days = daysUntil(task.due_date, today);
  if (days < 0) return `open, OVERDUE by ${-days} day${-days === 1 ? '' : 's'} (was due ${task.due_date})`;
  if (days === 0) return 'open, due today';
  return `open, due ${task.due_date} (in ${days} day${days === 1 ? '' : 's'})`;
}

/**
 * A self-contained brief for a coding agent: the task, its full notes as the spec,
 * and just enough project context that it does not have to ask what the thing is.
 */
export function implementPrompt(task: ProjectTask, ctx: PromptContext): string {
  const { project, stats, today } = ctx;
  const lines: string[] = [];

  lines.push(`Implement the task below end to end. The notes are the spec — read them before touching anything.`);
  lines.push('');

  lines.push(`PROJECT`);
  lines.push(`Name: ${project.name}`);
  if (project.description) lines.push(`About: ${project.description}`);
  lines.push(`Status: ${project.status}${project.target_date ? `, target date ${project.target_date}` : ''}`);
  lines.push(
    `Progress: ${stats.done}/${stats.total} done, ${stats.open} open${stats.overdue ? `, ${stats.overdue} overdue` : ''}`
  );
  lines.push('');

  lines.push(`TASK`);
  lines.push(`Title: ${task.title}`);
  lines.push(`Category: ${task.category ?? 'uncategorised'}`);
  lines.push(`Priority: ${task.priority}`);
  lines.push(`Status: ${statusLine(task, today)}`);
  if (task.source === 'import') lines.push(`Source: imported from JSON`);
  lines.push('');

  lines.push(`NOTES — this is the specification, follow it`);
  lines.push(task.notes?.trim() ? task.notes.trim() : 'No notes recorded. Infer intent from the title and ask me before making product decisions.');
  lines.push('');

  const related = (ctx.related ?? []).filter((t) => t.id !== task.id).slice(0, 12);
  if (related.length) {
    lines.push(`OTHER TASKS IN THIS CATEGORY — context only, do not implement them`);
    for (const other of related) {
      lines.push(`- [${other.completed ? 'x' : ' '}] ${other.title}${!other.completed && other.due_date ? ` (due ${other.due_date})` : ''}`);
    }
    lines.push('');
  }

  const milestone = ctx.nextMilestone;
  if (milestone) {
    const days = milestone.date ? daysUntil(milestone.date, today) : null;
    const when = milestone.date ? `${milestone.date}${days !== null ? ` (${days < 0 ? `${-days}d late` : days === 0 ? 'today' : `in ${days}d`})` : ''}` : 'undated';
    lines.push(`THIS IS DRIVING TOWARDS`);
    lines.push(`Next milestone: ${milestone.title} — ${when}`);
    lines.push(`If the shortest path to that milestone cuts this task short, tell me instead of silently shrinking scope.`);
    lines.push('');
  }

  lines.push(`HOW TO WORK`);
  lines.push(`- Stay inside this task. No drive-by refactors, no reformatting of untouched files.`);
  lines.push(`- Ask before adding a dependency, changing the schema, or touching auth/payments.`);
  lines.push(`- Anything the notes leave ambiguous: pick the smallest reversible option and flag it explicitly.`);
  lines.push(`- Cover the behaviour with tests where there is logic; show me how to verify it by hand too.`);
  lines.push(`- Wherever possible, make the change so the task can be marked done without a follow-up.`);
  lines.push('');

  lines.push(`WHEN YOU ARE DONE, REPLY WITH`);
  lines.push(`1. What changed, file by file, and how to verify it.`);
  lines.push(`2. Blockers or decisions you need from me.`);
  lines.push(`3. Any follow-up work as JSON in exactly this shape — brand new titles, not the one above, so it imports as new tasks:`);
  lines.push(FOLLOW_UP_SHAPE);

  return lines.join('\n');
}
