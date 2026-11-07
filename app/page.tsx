'use client';

import Link from 'next/link';
import { useState } from 'react';
import TaskRow from '@/components/TaskRow';
import { Button, EmptyState, ErrorBanner, Spinner } from '@/components/ui';
import { InboxItem, Meeting, Note, Task } from '@/lib/types';
import { todayISO, useTable } from '@/lib/useTable';
import { format, isFuture, parseISO } from 'date-fns';

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
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">{format(new Date(), 'EEEE, MMMM d')}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {overdue.length > 0 && <span className="text-red-400">{overdue.length} overdue · </span>}
          {dueToday.length} due today · {inbox.rows.length} in inbox
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={quickCapture} className="mb-8 flex gap-2">
        <input
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          placeholder="Capture anything before you forget it…"
          className="min-h-[44px] flex-1"
        />
        <Button type="submit" disabled={capturing || !capture.trim()}>Capture</Button>
      </form>
      {captureError && <ErrorBanner message={captureError} />}

      <div className="space-y-8">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Due today & overdue</h2>
            <Link href="/tasks" className="text-xs text-indigo-400 hover:underline">All tasks</Link>
          </div>
          {tasks.loading ? <Spinner /> : overdue.length + dueToday.length === 0 ? (
            <EmptyState title="Nothing due today" hint="Capture something above, or add tasks with due dates." />
          ) : (
            <div className="space-y-2">
              {[...overdue, ...dueToday].map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} />)}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Next meeting</h2>
            <Link href="/meetings" className="text-xs text-indigo-400 hover:underline">All meetings</Link>
          </div>
          {meetings.loading ? <Spinner /> : !nextMeeting ? (
            <EmptyState title="No upcoming meetings" />
          ) : (
            <Link href="/meetings" className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-indigo-800">
              <div className="text-sm font-semibold">{nextMeeting.title}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {format(parseISO(nextMeeting.starts_at), 'EEE MMM d · h:mm a')}
                {nextMeeting.attendees ? ` · ${nextMeeting.attendees}` : ''}
              </div>
              {nextMeeting.agenda && <div className="mt-2 line-clamp-2 text-xs text-zinc-400">{nextMeeting.agenda}</div>}
            </Link>
          )}
        </section>

        {inbox.rows.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Inbox</h2>
              <Link href="/inbox" className="text-xs text-indigo-400 hover:underline">Triage {inbox.rows.length} item{inbox.rows.length === 1 ? '' : 's'}</Link>
            </div>
            <div className="space-y-2">
              {inbox.rows.slice(0, 3).map((item) => (
                <div key={item.id} className="truncate rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-300">
                  {item.content}
                </div>
              ))}
            </div>
          </section>
        )}

        {pinned.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Pinned notes</h2>
              <Link href="/notes" className="text-xs text-indigo-400 hover:underline">All notes</Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {pinned.map((n) => (
                <Link key={n.id} href="/notes" className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 transition hover:border-zinc-700">
                  <div className="truncate text-sm font-medium">{n.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{n.body}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}