'use client';

import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { Meeting, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { format, isFuture, parseISO } from 'date-fns';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

const EMPTY_FORM = {
  title: '',
  starts_at: '',
  ends_at: '',
  attendees: '',
  location: '',
  agenda: '',
  notes: '',
};

export default function MeetingsPage() {
  const meetings = useTable<Meeting>('meetings', 'starts_at');
  const tasks = useTable<Task>('tasks');
  const [modal, setModal] = useState<'closed' | 'new' | Meeting>('closed');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') {
      setForm({ ...EMPTY_FORM, title: params.get('title') ?? '' });
      setModal('new');
    }
  }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setAiResult(null);
    setModal('new');
  }

  function openEdit(m: Meeting) {
    setForm({
      title: m.title,
      starts_at: toLocalInput(m.starts_at),
      ends_at: toLocalInput(m.ends_at),
      attendees: m.attendees ?? '',
      location: m.location ?? '',
      agenda: m.agenda ?? '',
      notes: m.notes ?? '',
    });
    setFormError(null);
    setAiResult(null);
    setModal(m);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.starts_at) return;
    setSaving(true);
    setFormError(null);
    const values = {
      title: form.title.trim(),
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      attendees: form.attendees.trim() || null,
      location: form.location.trim() || null,
      agenda: form.agenda.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (modal === 'new') await meetings.insert(values);
      else if (modal !== 'closed') await meetings.update(modal.id, values);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    }
    setSaving(false);
  }

  async function deleteMeeting() {
    if (modal === 'closed' || modal === 'new') return;
    setSaving(true);
    try {
      await meetings.remove(modal.id);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'delete failed');
    }
    setSaving(false);
  }

  async function extractActions() {
    if (modal === 'closed' || modal === 'new') return;
    const text = [modal.agenda, form.notes].filter(Boolean).join('\n\n');
    if (!text.trim()) {
      setAiResult('Add agenda or notes first, then extract action items.');
      return;
    }
    setAiBusy(true);
    setAiResult(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'actions', text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'AI failed');
      const items: string[] = data.items;
      if (items.length === 0) {
        setAiResult('No action items found.');
      } else {
        for (const title of items) {
          await tasks.insert({ title, meeting_id: modal.id, notes: `From meeting: ${modal.title}` });
        }
        setAiResult(`Created ${items.length} task${items.length === 1 ? '' : 's'} from this meeting.`);
      }
    } catch (err) {
      setAiResult(err instanceof Error ? err.message : 'AI request failed');
    }
    setAiBusy(false);
  }

  const upcoming = meetings.rows.filter((m) => isFuture(parseISO(m.starts_at)));
  const past = meetings.rows.filter((m) => !isFuture(parseISO(m.starts_at))).reverse();
  const linkedTasks = modal !== 'closed' && modal !== 'new'
    ? tasks.rows.filter((t) => t.meeting_id === modal.id)
    : [];

  function MeetingCard({ m }: { m: Meeting }) {
    return (
      <button onClick={() => openEdit(m)} className="block w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition hover:border-zinc-700">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">{m.title}</span>
          <span className="shrink-0 text-xs text-zinc-500">{format(parseISO(m.starts_at), 'MMM d · h:mm a')}</span>
        </div>
        {(m.attendees || m.location) && (
          <div className="mt-1 truncate text-xs text-zinc-500">
            {m.attendees}{m.attendees && m.location ? ' · ' : ''}{m.location}
          </div>
        )}
        {m.agenda && <div className="mt-2 line-clamp-2 text-xs text-zinc-400">{m.agenda}</div>}
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Meetings" sub="Agenda in, action items out." action={<Button onClick={openNew}>+ New meeting</Button>} />
      {meetings.error && <ErrorBanner message={meetings.error} />}
      {meetings.loading ? (
        <Spinner />
      ) : meetings.rows.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Schedule one, or convert an inbox capture into a meeting." />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Upcoming</h2>
            {upcoming.length === 0 ? <EmptyState title="Nothing scheduled" /> : (
              <div className="space-y-2">{upcoming.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Past</h2>
              <div className="space-y-2 opacity-70">{past.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
            </section>
          )}
        </div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New meeting' : modal.title} onClose={() => setModal('closed')} wide>
          <form onSubmit={save} className="space-y-4">
            <Field label="Title">
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full" placeholder="Investor call, sprint planning…" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Starts">
                <input type="datetime-local" required value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className="w-full" />
              </Field>
              <Field label="Ends">
                <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="w-full" />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Attendees">
                <input value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} className="w-full" placeholder="Names or emails" />
              </Field>
              <Field label="Location / link">
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full" placeholder="Meet link or room" />
              </Field>
            </div>
            <Field label="Agenda">
              <textarea value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} rows={3} className="w-full" />
            </Field>
            <Field label="Meeting notes">
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className="w-full" placeholder="Decisions, discussion, follow-ups…" />
            </Field>

            {modal !== 'new' && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">
                    {linkedTasks.length} linked task{linkedTasks.length === 1 ? '' : 's'}
                  </span>
                  <Button variant="ghost" onClick={extractActions} disabled={aiBusy}>
                    {aiBusy ? 'Thinking…' : 'AI: extract action items → tasks'}
                  </Button>
                </div>
                {linkedTasks.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-zinc-500">
                    {linkedTasks.map((t) => (
                      <li key={t.id} className={t.status === 'done' ? 'line-through opacity-60' : ''}>· {t.title}</li>
                    ))}
                  </ul>
                )}
                {aiResult && <p className="mt-2 text-xs text-indigo-300">{aiResult}</p>}
              </div>
            )}

            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-between gap-2">
              {modal !== 'new' ? <Button variant="danger" onClick={deleteMeeting} disabled={saving}>Delete</Button> : <span />}
              <Button type="submit" disabled={saving || !form.title.trim() || !form.starts_at}>{saving ? 'Saving…' : 'Save meeting'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}