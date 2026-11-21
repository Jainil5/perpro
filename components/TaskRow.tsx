'use client';

import { Task } from '@/lib/types';
import { dueTone } from '@/lib/os/format';
import { StatusDot } from '@/components/os/marks';
import {
  DueText,
  PriorityText,
  dotStateFor,
  dotToneForDue,
} from '@/components/os/TaskRow';
import { Tag } from './ui';

/**
 * One task = one hairline row: the shared row vocabulary from
 * components/os/TaskRow (status disc, mono priority code, mono right-aligned
 * date) on PerPro's own Supabase data. No card, no gradient bar, no spring.
 */
export default function TaskRow({
  task,
  onToggle,
  onEdit,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit?: (task: Task) => void;
}) {
  const done = task.status === 'done';
  const tone = dotToneForDue(done ? 'none' : dueTone(task.due_date));

  const body = (
    <>
      <span
        className={`block truncate text-[14px] ${
          done ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        {task.title}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-2">
        <PriorityText value={task.priority} />
        {task.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </span>
    </>
  );

  return (
    <div className={`flex min-h-[36px] items-center gap-3 border-b border-line py-2 ${done ? 'opacity-60' : ''}`}>
      <button
        onClick={() => onToggle(task)}
        aria-label={done ? 'Mark open' : 'Mark done'}
        className="os-tap-none flex h-9 w-5 shrink-0 items-center justify-start"
      >
        <StatusDot
          state={dotStateFor(task.status)}
          tone={tone}
          title={done ? 'Completed' : 'Open'}
        />
      </button>

      {onEdit ? (
        <button onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}

      <DueText value={task.due_date} muted={done} />
    </div>
  );
}
