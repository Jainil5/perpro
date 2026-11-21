'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TaskRow from '@/components/TaskRow';
import { Button, EmptyState, ErrorBanner, Spinner, PageHeader, Tag } from '@/components/ui';
import { InboxItem, Meeting, Note, Task } from '@/lib/types';
import { todayISO, useTable } from '@/lib/useTable';
import { format, isFuture, parseISO } from 'date-fns';

const pageVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

export default function TodayPage() {
  const tasks = useTable<Task>('tasks', 'due_date', true);
  const meetings = useTable<Meeting>('meetings', 'starts_at', true);
  const inbox = useTable<InboxItem>('inbox');
  const notes = useTable<Note>('notes', 'updated_at');
  const [capture, setCapture] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const today = todayISO();
  const open = tasks.rows.filter((t) => t.status === 'open');
  const overdue = open.filter((t) => t.due_date !== null && t.due_date < today);
  const dueToday = open.filter((t) => t.due_date === today);
  const upcoming = meetings.rows.filter((m) => isFuture(parseISO(m.starts_at)));
  const nextMeeting = upcoming[0];
  const pinned = notes.rows.filter((n) => n.pinned).slice(0, 3);

  async function quickCapture(e: React.FormEvent) {
    e.preventDefault();
    if (!capture.trim()) return;
    setCapturing(true);
    setCaptureError(null);
    const res = await fetch('/api/db/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: capture.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setCapturing(false);
    if (!res.ok) setCaptureError(data.error ?? 'capture failed');
    else {
      setCapture('');
      inbox.reload();
    }
  }

  async function toggle(task: Task) {
    await tasks.update(task.id, {
      status: task.status === 'done' ? 'open' : 'done',
      completed_at: task.status === 'done' ? null : new Date().toISOString(),
    });
  }

  const error = tasks.error ?? meetings.error ?? inbox.error;

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-3xl"
    >
      <motion.div variants={sectionVariants}>
        <PageHeader
        title={format(new Date(), 'EEEE, MMMM d')}
        sub={
          <>
            {overdue.length > 0 && (
              <span className="text-[var(--accent-critical)]">{overdue.length} overdue · </span>
            )}
            {dueToday.length} due today · {inbox.rows.length} in inbox
          </>
        }
        count={overdue.length + dueToday.length}
      />
      </motion.div>

      <AnimatePresence mode="wait">
        {error && <ErrorBanner message={error} />}
      </AnimatePresence>

      <motion.form
        variants={sectionVariants}
        onSubmit={quickCapture}
        className="mb-8 flex gap-2"
      >
        <motion.input
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          placeholder="Capture anything before you forget it…"
          whileFocus={{ scale: 1.01 }}
          className="min-h-[44px] flex-1"
        />
        <Button type="submit" disabled={capturing || !capture.trim()}>Capture</Button>
      </motion.form>
      <AnimatePresence mode="wait">
        {captureError && <ErrorBanner message={captureError} />}
      </AnimatePresence>

      <motion.div variants={pageVariants} className="space-y-8">
        <motion.section variants={sectionVariants}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subheading">Due today & overdue</h2>
            <Link href="/tasks" className="text-xs text-[var(--accent-brand)] hover:underline">All tasks</Link>
          </div>
          {tasks.loading ? (
            <Spinner />
          ) : overdue.length + dueToday.length === 0 ? (
            <EmptyState title="Nothing due today" hint="Capture something above, or add tasks with due dates." />
          ) : (
            <motion.div className="space-y-2" layout>
              {[...overdue, ...dueToday].map((t, index) => (
                <motion.div key={t.id} layout>
                  <TaskRow task={t} onToggle={toggle} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>

        <motion.section variants={sectionVariants}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subheading">Next meeting</h2>
            <Link href="/meetings" className="text-xs text-[var(--accent-brand)] hover:underline">All meetings</Link>
          </div>
          {meetings.loading ? (
            <Spinner />
          ) : !nextMeeting ? (
            <EmptyState title="No upcoming meetings" />
          ) : (
            <motion.a
              whileHover={{ y: -2, scale: 1.015 }}
              whileTap={{ scale: 0.99 }}
              href="/meetings"
              className="block rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-elevated)] p-4 transition hover:border-[var(--accent-brand)]"
            >
              <div className="text-body font-semibold">{nextMeeting.title}</div>
              <div className="mt-1 text-body-sm text-[var(--fg-muted)]">
                {format(parseISO(nextMeeting.starts_at), 'EEE MMM d · h:mm a')}
                {nextMeeting.attendees ? ` · ${nextMeeting.attendees}` : ''}
              </div>
              {nextMeeting.agenda && <div className="mt-2 line-clamp-2 text-body-sm text-[var(--fg-subtle)]">{nextMeeting.agenda}</div>}
            </motion.a>
          )}
        </motion.section>

        {inbox.rows.length > 0 && (
          <motion.section variants={sectionVariants}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-subheading">Inbox</h2>
              <Link href="/inbox" className="text-xs text-[var(--accent-brand)] hover:underline">Triage {inbox.rows.length} item{inbox.rows.length === 1 ? '' : 's'}</Link>
            </div>
            <motion.div className="space-y-2" layout>
              {inbox.rows.slice(0, 3).map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  whileHover={{ x: 4 }}
                  layout
                  className="truncate rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-body text-[var(--fg-primary)]"
                >
                  {item.content}
                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}

        {pinned.length > 0 && (
          <motion.section variants={sectionVariants}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-subheading">Pinned notes</h2>
              <Link href="/notes" className="text-xs text-[var(--accent-brand)] hover:underline">All notes</Link>
            </div>
            <motion.div className="grid gap-2 sm:grid-cols-3" layout>
              {pinned.map((n, index) => (
                <motion.a
                  key={n.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  whileHover={{ y: -4, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  href="/notes"
                  className="rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-elevated)] p-3 transition hover:border-[var(--accent-brand)]"
                >
                  <div className="truncate text-body font-medium">{n.title}</div>
                  <div className="mt-1 line-clamp-2 text-body-sm text-[var(--fg-muted)]">{n.body}</div>
                </motion.a>
              ))}
            </motion.div>
          </motion.section>
        )}
      </motion.div>
    </motion.div>
  );
}