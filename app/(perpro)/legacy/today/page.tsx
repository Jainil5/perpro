'use client';

import Link from 'next/link';
import { useState } from 'react';
import TaskRow from '@/components/TaskRow';
import { Button, EmptyState, ErrorBanner, Spinner, PageHeader } from '@/components/ui';
import { InboxItem, Meeting, Note, Task } from '@/lib/types';
import { todayISO, useTable } from '@/lib/useTable';
import { format, isFuture, parseISO } from 'date-fns';
import LegacyBanner from '@/components/LegacyBanner';

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
    <div className="os-enter mx-auto max-w-3xl">
      <LegacyBanner live="/" />
      <PageHeader
        eyebrow="Today"
        title={format(new Date(), 'EEEE, MMMM d')}
        sub={
          <>
            {overdue.length > 0 && (
              <span className="os-mono text-danger">{overdue.length} overdue · </span>
            )}
            {dueToday.length > 0 && (
              <span className="os-mono text-warning">{dueToday.length} due today · </span>
            )}
            <span className="os-mono">{inbox.rows.length} in inbox</span>
          </>
        }
        data={[`${open.length} open`, `${upcoming.length} meetings ahead`, `${pinned.length} pinned`]}
      />

      {error && <ErrorBanner message={error} />}

      <form onSubmit={quickCapture} className="mb-8 flex gap-2">
        <input
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
          placeholder="Capture anything before you forget it…"
          aria-label="Capture"
          className="min-h-[44px] flex-1"
        />
        <Button type="submit" disabled={capturing || !capture.trim()}>
          Capture
        </Button>
      </form>
      {captureError && <ErrorBanner message={captureError} />}

      <section className="mb-9">
        <SectionHead label="Due today & overdue" href="/legacy/tasks" linkText="All tasks" />
        {tasks.loading ? (
          <Spinner />
        ) : overdue.length + dueToday.length === 0 ? (
          <EmptyState title="Nothing due today" hint="Capture something above, or add tasks with due dates." />
        ) : (
          <div className="border-t border-line">
            {[...overdue, ...dueToday].map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggle} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-9">
        <SectionHead label="Next meeting" href="/meetings" linkText="All meetings" />
        {meetings.loading ? (
          <Spinner />
        ) : !nextMeeting ? (
          <EmptyState title="No upcoming meetings" />
        ) : (
          <a
            href="/meetings"
            className="block border-y border-line py-3 transition-colors duration-150 hover:bg-canvas-deep"
          >
            <div className="text-[15px] leading-snug text-foreground">{nextMeeting.title}</div>
            <div className="os-mono mt-1.5 text-[11px] text-muted-foreground">
              {format(parseISO(nextMeeting.starts_at), 'EEE MMM d · HH:mm')}
              {nextMeeting.attendees ? ` · ${nextMeeting.attendees}` : ''}
            </div>
            {nextMeeting.agenda && (
              <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                {nextMeeting.agenda}
              </p>
            )}
          </a>
        )}
      </section>

      {inbox.rows.length > 0 && (
        <section className="mb-9">
          <SectionHead
            label="Inbox"
            href="/inbox"
            linkText={`Triage ${inbox.rows.length} item${inbox.rows.length === 1 ? '' : 's'}`}
          />
          <div className="border-t border-line">
            {inbox.rows.slice(0, 3).map((item) => (
              <div key={item.id} className="border-b border-line py-2.5">
                <p className="truncate text-[14px] text-foreground">{item.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {pinned.length > 0 && (
        <section className="mb-9">
          <SectionHead label="Pinned notes" href="/legacy/notes" linkText="All notes" />
          <div className="grid gap-x-6 border-t border-line sm:grid-cols-3">
            {pinned.map((n) => (
              <a
                key={n.id}
                href="/legacy/notes"
                className="block border-b border-line py-3 transition-colors duration-150 hover:bg-canvas-deep sm:px-2"
              >
                <div className="truncate text-[14px] text-foreground">{n.title}</div>
                <div className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                  {n.body}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Section header: `os-label` on the left, one plain link on the right. */
function SectionHead({
  label,
  href,
  linkText,
}: {
  label: string;
  href: string;
  linkText: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <h2 className="os-label">{label}</h2>
      <Link href={href} className="os-micro shrink-0 text-muted-foreground hover:text-foreground">
        {linkText}
      </Link>
    </div>
  );
}
