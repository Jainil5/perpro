'use client';

import { Task } from '@/lib/types';
import { todayISO } from '@/lib/useTable';
import { Tag } from './ui';

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-indigo-400',
  low: 'bg-zinc-500',
};

export default function TaskRow({
  task,
  onToggle,
  onEdit,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  const today = todayISO();
  const overdue = task.status === 'open' && task.due_date !== null && task.due_date < today;
  const dueToday = task.due_date === today;
  return (
    <div className={`group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 transition hover:border-zinc-700 ${task.status === 'done' ? 'opacity-50' : ''}`}>
      <button
        onClick={() => onToggle(task)}
        aria-label={task.status === 'done' ? 'Mark open' : 'Mark done'}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${task.status === 'done' ? 'text-emerald-400' : 'text-zinc-600 hover:text-indigo-400'}`}
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${task.status === 'done' ? 'border-emerald-500 bg-emerald-500/20' : 'border-current'}`}>
          {task.status === 'done' && (
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          )}
        </span>
      </button>
      <button onClick={() => onEdit?.(task)} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-sm ${task.status === 'done' ? 'line-through' : ''}`}>{task.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_COLOR[task.priority]}`} title={task.priority} />
          {task.due_date && (
            <span className={`text-[11px] ${overdue ? 'font-semibold text-red-400' : dueToday ? 'text-amber-300' : 'text-zinc-500'}`}>
              {overdue ? 'overdue · ' : dueToday ? 'today · ' : ''}{task.due_date}
            </span>
          )}
          {task.tags.map((t) => <Tag key={t}>{t}</Tag>)}
        </span>
      </button>
    </div>
  );
}