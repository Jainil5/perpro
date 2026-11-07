'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { InboxItem } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { format, parseISO } from 'date-fns';

export default function InboxPage() {
  const inbox = useTable<InboxItem>('inbox');
  const tasks = useTable('tasks');
  const notes = useTable('notes');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function convert(item: InboxItem, to: 'task' | 'note') {
    setBusyId(item.id);
    setActionError(null);
    try {
      if (to === 'task') {
        await tasks.insert({ title: item.content });
      } else {
        await notes.insert({
          title: item.content.slice(0, 60),
          body: item.content,
        });
      }
      await inbox.remove(item.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'conversion failed');
    }
    setBusyId(null);
  }

  async function dismiss(item: InboxItem) {
    setBusyId(item.id);
    try {
      await inbox.remove(item.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
    setBusyId(null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Inbox"
        sub="Everything you captured. Triage it into a task, note, or meeting — or let it go."
      />
      {(inbox.error || actionError) && <ErrorBanner message={actionError ?? inbox.error!} />}
      {inbox.loading ? (
        <Spinner />
      ) : inbox.rows.length === 0 ? (
        <EmptyState title="Inbox zero" hint="Press Cmd+K anywhere and type to capture a thought." />
      ) : (
        <div className="space-y-2">
          {inbox.rows.map((item) => (
            <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="whitespace-pre-wrap text-sm text-zinc-200">{item.content}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[11px] text-zinc-600">
                  {format(parseISO(item.created_at), 'MMM d · h:mm a')}
                </span>
                <button
                  onClick={() => convert(item, 'task')}
                  disabled={busyId === item.id}
                  className="min-h-[44px] rounded-lg bg-indigo-600/15 px-3 text-xs font-medium text-indigo-300 transition hover:bg-indigo-600/30 disabled:opacity-50"
                >
                  → Task
                </button>
                <button
                  onClick={() => convert(item, 'note')}
                  disabled={busyId === item.id}
                  className="min-h-[44px] rounded-lg bg-zinc-800 px-3 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
                >
                  → Note
                </button>
                <Link
                  href={`/meetings?new=1&title=${encodeURIComponent(item.content.slice(0, 80))}`}
                  className="flex min-h-[44px] items-center rounded-lg bg-zinc-800 px-3 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                >
                  → Meeting
                </Link>
                <button
                  onClick={() => dismiss(item)}
                  disabled={busyId === item.id}
                  className="min-h-[44px] rounded-lg px-3 text-xs text-zinc-600 transition hover:text-red-400 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}