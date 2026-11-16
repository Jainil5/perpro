'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Tag } from './ui';
import { todayISO } from '@/lib/useTable';
import { Priority, ProjectTask } from '@/lib/types';

const PRIORITY_COLORS: Record<Priority, { start: string; end: string }> = {
  urgent: { start: '#F87171', end: '#DC2626' },
  high: { start: '#FBBF24', end: '#EA580C' },
  medium: { start: '#818CF8', end: '#4F46E5' },
  low: { start: '#A1A1AA', end: '#52525B' },
};

function dueTone(date: string | null, completed: boolean) {
  if (!date || completed) return { label: date ?? '', className: 'text-[var(--fg-muted)]' };
  const today = todayISO();
  if (date < today) return { label: `Overdue · ${date}`, className: 'font-semibold text-[var(--accent-critical)]' };
  if (date === today) return { label: 'Due today', className: 'text-[var(--accent-warn)]' };
  return { label: date, className: 'text-[var(--fg-muted)]' };
}

export default function ProjectTaskRow({
  task,
  onToggle,
  onEdit,
  onCopyPrompt,
}: {
  task: ProjectTask;
  onToggle: (task: ProjectTask) => void;
  onEdit: (task: ProjectTask) => void;
  onCopyPrompt: (task: ProjectTask) => Promise<boolean>;
}) {
  const [openNotes, setOpenNotes] = useState(false);
  const [copied, setCopied] = useState(false);
  const colors = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium;
  const due = dueTone(task.due_date, task.completed);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`group relative rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-surface)] transition hover:border-[var(--accent-brand)]/50 ${
        task.completed ? 'opacity-55' : ''
      }`}
    >
      <div className="absolute bottom-0 left-0 top-0 w-1 rounded-l-lg" style={{ background: `linear-gradient(to bottom, ${colors.start}, ${colors.end})` }} />

      <div className="flex items-start gap-2 px-3 py-2.5 pl-4">
        <motion.button
          onClick={() => onToggle(task)}
          aria-label={task.completed ? 'Mark open' : 'Mark done'}
          whileTap={{ scale: 0.9 }}
          className={`mt-0.5 flex h-11 w-8 shrink-0 items-center justify-center rounded-lg ${
            task.completed ? 'text-[var(--accent-success)]' : 'text-[var(--fg-muted)] hover:text-[var(--accent-brand)]'
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
              task.completed ? 'border-[var(--accent-success)] bg-[var(--accent-success)]/20' : 'border-current'
            }`}
          >
            {task.completed && (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
        </motion.button>

        <motion.button onClick={() => onEdit(task)} whileTap={{ scale: 0.99 }} className="min-w-0 flex-1 text-left">
          <span className={`block text-body ${task.completed ? 'line-through text-[var(--fg-muted)]' : 'text-[var(--fg-primary)]'}`}>
            {task.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.category && <Tag>{task.category}</Tag>}
            {due.label && <span className={`text-body-sm ${due.className}`}>{due.label}</span>}
            {task.priority !== 'medium' && (
              <span className="text-[11px] capitalize text-[var(--fg-subtle)]">{task.priority}</span>
            )}
            {task.source === 'import' && <span className="text-[11px] text-[var(--fg-subtle)]">imported</span>}
          </span>
        </motion.button>

        <motion.button
          onClick={async () => {
            if (await onCopyPrompt(task)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
          whileTap={{ scale: 0.9 }}
          title="Copy an implementation brief for this task"
          aria-label={`Copy implement prompt for ${task.title}`}
          className={`mt-0.5 flex h-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] ${
            copied
              ? 'bg-[var(--accent-success)]/15 text-[var(--accent-success)]'
              : 'text-[var(--fg-subtle)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]'
          }`}
        >
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 4h6a1 1 0 011 1v1H8V5a1 1 0 011-1zM8 6H6a2 2 0 00-2 2v11a2 2 0 002 2h9a2 2 0 002-2v-2" />
                <path d="M13 10h7v7a2 2 0 01-2 2h-5" />
              </svg>
              Prompt
            </>
          )}
        </motion.button>

        {task.notes && (
          <button
            onClick={() => setOpenNotes((v) => !v)}
            aria-expanded={openNotes}
            aria-label={openNotes ? 'Hide notes' : 'Show notes'}
            className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--fg-subtle)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <motion.svg viewBox="0 0 24 24" animate={{ rotate: openNotes ? 90 : 0 }} className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </motion.svg>
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {openNotes && task.notes && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden border-t border-[var(--fg-subtle)]"
          >
            <div className="markdown-body max-h-72 overflow-y-auto px-4 py-3 text-xs">
              <ReactMarkdown>{task.notes}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
