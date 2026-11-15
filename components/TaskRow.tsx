'use client';

import { Task } from '@/lib/types';
import { todayISO } from '@/lib/useTable';
import { Tag } from './ui';
import { motion, AnimatePresence } from 'framer-motion';

const PRIORITY_COLORS: Record<Task['priority'], { start: string; end: string; glow: string }> = {
  urgent: { start: '#F87171', end: '#DC2626', glow: 'rgba(239, 68, 68, 0.4)' },
  high: { start: '#FBBF24', end: '#EA580C', glow: 'rgba(245, 158, 11, 0.4)' },
  medium: { start: '#818CF8', end: '#4F46E5', glow: 'rgba(99, 102, 241, 0.4)' },
  low: { start: '#A1A1AA', end: '#52525B', glow: 'rgba(113, 113, 122, 0.3)' },
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
  const colors = PRIORITY_COLORS[task.priority];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={{ x: 4 }}
      layout
      style={{ '--priority-start': colors.start, '--priority-end': colors.end, '--priority-glow': colors.glow } as React.CSSProperties}
      className={`group relative flex items-center gap-3 rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 transition hover:border-[var(--accent-brand)]/50 ${task.status === 'done' ? 'opacity-50' : ''}`}
    >
      {/* Priority gradient bar - left edge */}
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 0.1 }}
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-gradient-to-b"
        style={{ background: `linear-gradient(to bottom, var(--priority-start), var(--priority-end))` }}
      />

      <motion.button
        onClick={() => onToggle(task)}
        aria-label={task.status === 'done' ? 'Mark open' : 'Mark done'}
        whileTap={{ scale: 0.9 }}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg relative ${task.status === 'done' ? 'text-[var(--accent-success)]' : 'text-[var(--fg-muted)] hover:text-[var(--accent-brand)]'}`}
      >
        <motion.span
          animate={{ scale: task.status === 'done' ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${task.status === 'done' ? 'border-[var(--accent-success)] bg-[var(--accent-success)]/20' : 'border-current'}`}
        >
          <motion.svg
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: 1, pathLength: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 13l4 4L19 7" />
          </motion.svg>
        </motion.span>
      </motion.button>

      <motion.button
        onClick={() => onEdit?.(task)}
        whileTap={{ scale: 0.98 }}
        className="min-w-0 flex-1 text-left"
      >
        <span className={`block truncate text-body ${task.status === 'done' ? 'line-through text-[var(--fg-muted)]' : 'text-[var(--fg-primary)]'}`}>{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* Due date with icon and color coding */}
          {task.due_date && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="flex items-center gap-1 text-body-sm"
            >
              <svg
                className={`h-3 w-3 shrink-0 ${overdue ? 'text-[var(--accent-critical)]' : dueToday ? 'text-[var(--accent-warn)]' : 'text-[var(--fg-subtle)]'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                {overdue ? (
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
              <span className={`${overdue ? 'font-semibold text-[var(--accent-critical)]' : dueToday ? 'text-[var(--accent-warn)]' : 'text-[var(--fg-muted)]'}`}>
                {overdue ? 'Overdue' : dueToday ? 'Today' : task.due_date}
              </span>
            </motion.span>
          )}
          <AnimatePresence mode="wait">
            {task.tags.map((t, i) => (
              <Tag key={t} delay={i * 0.04}>{t}</Tag>
            ))}
          </AnimatePresence>
        </span>
      </motion.button>
    </motion.div>
  );
}