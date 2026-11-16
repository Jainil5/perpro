import type { ProjectTask } from './types';

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  overdue: number;
  dueToday: number;
  nextDue: string | null;
  pct: number;
}

export function projectStats(tasks: ProjectTask[], today: string): ProjectStats {
  const done = tasks.filter((t) => t.completed);
  const open = tasks.filter((t) => !t.completed);
  const dated = open.filter((t) => t.due_date !== null);
  return {
    total: tasks.length,
    done: done.length,
    open: open.length,
    overdue: dated.filter((t) => (t.due_date as string) < today).length,
    dueToday: dated.filter((t) => t.due_date === today).length,
    nextDue: dated.map((t) => t.due_date as string).sort()[0] ?? null,
    pct: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
  };
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export type TaskSort = 'due' | 'priority' | 'category' | 'added';

export function sortTasks(tasks: ProjectTask[], sort: TaskSort): ProjectTask[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    switch (sort) {
      case 'due': {
        const ad = a.due_date ?? '9999-12-31';
        const bd = b.due_date ?? '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
      case 'priority': {
        const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (rank !== 0) return rank;
        return (a.due_date ?? '9999-12-31') < (b.due_date ?? '9999-12-31') ? -1 : 1;
      }
      case 'category': {
        const cat = (a.category ?? 'zzzz').localeCompare(b.category ?? 'zzzz');
        if (cat !== 0) return cat;
        return (a.due_date ?? '9999-12-31') < (b.due_date ?? '9999-12-31') ? -1 : 1;
      }
      default:
        return a.created_at < b.created_at ? 1 : -1;
    }
  });
}

export function groupByCategory(tasks: ProjectTask[]): [string, ProjectTask[]][] {
  const groups = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    const key = task.category ?? 'Uncategorised';
    const list = groups.get(key);
    if (list) list.push(task);
    else groups.set(key, [task]);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export function categoryNames(tasks: ProjectTask[]): string[] {
  return Array.from(new Set(tasks.map((t) => t.category).filter((c): c is string => !!c))).sort();
}

/** Days from today to a YYYY-MM-DD date; negative means it has passed. */
export function daysUntil(date: string, today: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(now)) return 0;
  return Math.round((target - now) / 86_400_000);
}
