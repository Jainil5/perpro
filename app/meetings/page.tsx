'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressRing, Spinner } from '@/components/ui';
import { Meeting, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { runAI } from '@/lib/ai-client';
import { format, isFuture, parseISO } from 'date-fns';

type Filter = 'upcoming' | 'past';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
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

function MeetingCard({ m, onOpen }: { m: Meeting; onOpen: (m: Meeting) => void }) {
  return (
    <motion.button
      onClick={() => onOpen(m)}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -2, scale: 1.01 }}
      className="block w-full rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--accent-brand)]/50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold text-[var(--fg-primary)]">{m.title}</span>
        <span className="shrink-0 text-mono text-[var(--fg-muted)]">{format(parseISO(m.starts_at), 'MMM d · h:mm a')}</span>
      </div>
      {(m.attendees || m.location) && (
        <div className="mt-1 truncate text-body-sm text-[var(--fg-muted)]">
          {m.attendees}{m.attendees && m.location ? ' · ' : ''}{m.location}
        </div>
      )}
      {m.agenda && <div className="mt-2 line-clamp-2 text-body-sm text-[var(--fg-subtle)]">{m.agenda}</div>}
    </motion.button>
  );
}

export default function MeetingsPage() {
  const meetings = useTable<Meeting>('meetings', 'starts_at');
  const tasks = useTable<Task>('tasks');
  const [tab, setTab] = useState<Filter>('upcoming');
  const [modal, setModal] = useState<'closed' | 'new' | Meeting>('closed');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [newLinkedTitle, setNewLinkedTitle] = useState('');
  const [orderError, setOrderError] = useState<string | null>(null);

  const modalId = modal !== 'closed' && modal !== 'new' ? modal.id : null;
  const linkedTasks = useMemo(
    () =>
      tasks.rows
        .filter((t) => t.meeting_id === modalId)
        .sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)),
    [tasks.rows, modalId]
  );
  const [ordered, setOrdered] = useState<Task[]>([]);
  useEffect(() => {
    setOrdered(linkedTasks);
  }, [linkedTasks]);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insertChain = useRef<Promise<void>>(Promise.resolve());

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
    setOrderError(null);
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
    setOrderError(null);
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

  function handleReorder(next: Task[]) {
    setOrdered(next);
    setOrderError(null);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      try {
        await Promise.all(
          next.map((t, i) =>
            fetch(`/api/db/tasks?id=${encodeURIComponent(t.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sort_order: i }),
            }).then((res) => {
              if (!res.ok) throw new Error('reorder failed');
            })
          )
        );
        await tasks.reload();
      } catch {
        setOrderError('Could not save order — re-run supabase/schema.sql to add the sort_order column.');
      }
    }, 500);
  }

  async function addLinkedTask() {
    const title = newLinkedTitle.trim();
    if (!title || modal === 'closed' || modal === 'new') return;
    setNewLinkedTitle('');
    try {
      await tasks.insert({
        title,
        meeting_id: modal.id,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'could not add task');
    }
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
    let count = 0;
    try {
      await runAI('actions', text, {
        onItem: (title) => {
          count++;
          const meeting = modal;
          insertChain.current = insertChain.current.then(async () => {
            await tasks.insert({ title, meeting_id: meeting.id, notes: `From meeting: ${meeting.title}` });
          });
        },
      });
      await insertChain.current;
      setAiResult(count === 0 ? 'No action items found.' : `Created ${count} task${count === 1 ? '' : 's'} from this meeting.`);
    } catch (err) {
      await insertChain.current.catch(() => {});
      setAiResult(err instanceof Error ? err.message : 'AI request failed');
    }
    setAiBusy(false);
  }

  const upcoming = meetings.rows.filter((m) => isFuture(parseISO(m.starts_at)));
  const past = meetings.rows.filter((m) => !isFuture(parseISO(m.starts_at))).reverse();
  const visible = tab === 'upcoming' ? upcoming : past;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto max-w-3xl"
    >
      <PageHeader title="Meetings" sub="Agenda in, action items out." action={<Button onClick={openNew}>+ New meeting</Button>} />
      <AnimatePresence mode="wait">
        {meetings.error && <ErrorBanner message={meetings.error} />}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mb-4 flex gap-1 border-b border-[var(--fg-subtle)]"
      >
        {(['upcoming', 'past'] as Filter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative min-h-[44px] px-4 text-sm font-medium capitalize transition ${tab === t ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg-primary)]'}`}
          >
            {t}
            {t === 'upcoming' && upcoming.length > 0 && (
              <span className="ml-1.5 text-xs text-[var(--fg-subtle)]">{upcoming.length}</span>
            )}
            {tab === t && (
              <motion.span
                layoutId="meeting-tab-underline"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--accent-brand)]"
              />
            )}
          </button>
        ))}
      </motion.div>

      {meetings.loading ? (
        <Spinner />
      ) : meetings.rows.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Schedule one, or convert an inbox capture into a meeting." />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            {visible.length === 0 ? (
              <EmptyState title={tab === 'upcoming' ? 'Nothing scheduled' : 'No past meetings'} />
            ) : (
              visible.map((m, index) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className={tab === 'past' ? 'opacity-70' : ''}
                >
                  <MeetingCard m={m} onOpen={openEdit} />
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New meeting' : modal.title} onClose={() => setModal('closed')} size="wide">
          <form onSubmit={save} className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.05 }}
            >
              <Field label="Title">
                <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full" placeholder="Investor call, sprint planning…" />
              </Field>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <Field label="Starts">
                <input type="datetime-local" required value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className="w-full" />
              </Field>
              <Field label="Ends">
                <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="w-full" />
              </Field>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.15 }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <Field label="Attendees">
                <input value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} className="w-full" placeholder="Names or emails" />
              </Field>
              <Field label="Location / link">
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full" placeholder="Meet link or room" />
              </Field>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
            >
              <Field label="Agenda">
                <textarea value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} rows={3} className="w-full" />
              </Field>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.25 }}
            >
              <Field label="Meeting notes">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className="w-full" placeholder="Decisions, discussion, follow-ups…" />
              </Field>
            </motion.div>

            {modal !== 'new' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.3 }}
                className="rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-deep)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-subheading text-[var(--fg-muted)]">
                    {ordered.length} linked task{ordered.length === 1 ? '' : 's'}
                  </span>
                  <motion.button
                    type="button"
                    onClick={extractActions}
                    disabled={aiBusy}
                    whileTap={{ scale: 0.95 }}
                    whileHover={!aiBusy ? { scale: 1.02 } : undefined}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--accent-ai)]/15 px-3 text-xs font-medium text-[var(--accent-ai)] transition hover:bg-[var(--accent-ai)]/25 disabled:opacity-60"
                  >
                    {aiBusy && <ProgressRing />}
                    {aiBusy ? 'Extracting…' : 'AI: extract action items → tasks'}
                  </motion.button>
                </div>
                {ordered.length > 0 && (
                  <Reorder.Group axis="y" values={ordered} onReorder={handleReorder} className="mt-2 space-y-1">
                    <AnimatePresence initial={false}>
                      {ordered.map((t, i) => (
                        <Reorder.Item
                          key={t.id}
                          value={t}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.2, delay: aiBusy ? i * 0.04 : 0 }}
                          whileDrag={{ scale: 1.02, backgroundColor: 'var(--bg-elevated)' }}
                          className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--fg-muted)] active:cursor-grabbing"
                        >
                          <span className="text-[var(--fg-subtle)]" aria-hidden="true">⠿</span>
                          <button
                            type="button"
                            onClick={() => tasks.update(t.id, { status: t.status === 'done' ? 'open' : 'done', completed_at: t.status === 'done' ? null : new Date().toISOString() })}
                            aria-label={t.status === 'done' ? 'Mark open' : 'Mark done'}
                            className={`flex-1 text-left ${t.status === 'done' ? 'line-through opacity-60' : 'hover:text-[var(--fg-primary)]'}`}
                          >
                            {t.title}
                          </button>
                        </Reorder.Item>
                      ))}
                    </AnimatePresence>
                  </Reorder.Group>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={newLinkedTitle}
                    onChange={(e) => setNewLinkedTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLinkedTask();
                      }
                    }}
                    placeholder="Add a linked task…"
                    className="min-h-[40px] flex-1 text-xs"
                  />
                  <Button variant="secondary" onClick={addLinkedTask} disabled={!newLinkedTitle.trim()} className="min-h-[40px] px-3 text-xs">
                    Add
                  </Button>
                </div>
                {orderError && <p className="mt-2 text-xs text-[var(--accent-warn)]">{orderError}</p>}
                {aiResult && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mt-2 text-xs text-[var(--accent-ai)]"
                  >
                    {aiResult}
                  </motion.p>
                )}
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {formError && <ErrorBanner message={formError} />}
            </AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.35 }}
              className="flex justify-between gap-2"
            >
              {modal !== 'new' ? (
                <Button variant="danger" onClick={deleteMeeting} disabled={saving}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving || !form.title.trim() || !form.starts_at}>
                {saving ? 'Saving…' : 'Save meeting'}
              </Button>
            </motion.div>
          </form>
        </Modal>
      )}
    </motion.div>
  );
}