'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressRing, Spinner } from '@/components/ui';
import { Meeting, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { runAI } from '@/lib/ai-client';
import {
  DAY_CHIPS,
  DURATION_PRESETS,
  dayHeading,
  dayOffsetFromToday,
  defaultSlot,
  durationMinutes,
  editEnd,
  editStart,
  isEndBeforeStart,
  pickDuration,
  shiftDay,
  slotSummary,
  type SlotState,
} from '@/lib/meeting-times';
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

/** A slot helper chip: hairline, mono, white ink when it is the current choice. */
const chipClass = (active: boolean) =>
  `os-tap-none os-mono min-h-[32px] rounded-os border px-2 text-[11px] transition-colors duration-150 ${
    active ? 'border-foreground text-foreground' : 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground'
  }`;

/** One meeting = one hairline row, mono date on the right. */
function MeetingRow({ m, past, onOpen }: { m: Meeting; past: boolean; onOpen: (m: Meeting) => void }) {
  return (
    <button
      onClick={() => onOpen(m)}
      className={`block w-full border-b border-line py-3 text-left transition-colors duration-150 hover:bg-canvas-deep ${
        past ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-medium text-foreground">{m.title}</span>
        <span className="os-mono shrink-0 text-[11px] text-muted-foreground">
          {format(parseISO(m.starts_at), 'yyyy-MM-dd HH:mm')}
        </span>
      </div>
      {(m.attendees || m.location) && (
        <div className="os-micro mt-1 truncate">
          {m.attendees}
          {m.attendees && m.location ? ' · ' : ''}
          {m.location}
        </div>
      )}
      {m.agenda && (
        <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
          {m.agenda}
        </div>
      )}
    </button>
  );
}

export default function MeetingsPage() {
  const meetings = useTable<Meeting>('meetings', 'starts_at');
  const tasks = useTable<Task>('tasks');
  const [tab, setTab] = useState<Filter>('upcoming');
  const [modal, setModal] = useState<'closed' | 'new' | Meeting>('closed');
  const [form, setForm] = useState(EMPTY_FORM);
  const [follow, setFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [newLinkedTitle, setNewLinkedTitle] = useState('');
  const [orderError, setOrderError] = useState<string | null>(null);
  // Every time on this screen is rendered in the browser's own zone, so say
  // which one that is. Read after mount to keep server and client HTML equal.
  const [localZone, setLocalZone] = useState<string | null>(null);
  useEffect(() => setLocalZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  // Delete is irreversible, so the button has to be pressed twice. Re-opening
  // any meeting disarms it.
  const [armedDelete, setArmedDelete] = useState(false);
  useEffect(() => setArmedDelete(false), [modal]);

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
      const slot = defaultSlot(new Date());
      setForm({ ...EMPTY_FORM, title: params.get('title') ?? '', ...slot });
      setFollow(true);
      setModal('new');
    }
  }, []);

  function openNew() {
    // A new meeting is today, on the next sensible slot, one hour long.
    setForm({ ...EMPTY_FORM, ...defaultSlot(new Date()) });
    setFollow(true);
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
    setFollow(true);
    setFormError(null);
    setAiResult(null);
    setOrderError(null);
    setModal(m);
  }

  /** The two datetime inputs plus whether the end still follows the start. */
  function slotState(): SlotState {
    return { starts_at: form.starts_at, ends_at: form.ends_at, follow };
  }

  function applySlot(next: SlotState) {
    setForm((f) => ({ ...f, starts_at: next.starts_at, ends_at: next.ends_at }));
    setFollow(next.follow);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.starts_at || isEndBeforeStart(form.starts_at, form.ends_at)) return;
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

  // The store can only sort one way, but a calendar needs soonest-first in
  // Upcoming and most-recent-first in Past.
  const now = new Date();
  const byStart = (a: Meeting, b: Meeting) => parseISO(a.starts_at).getTime() - parseISO(b.starts_at).getTime();
  const upcoming = meetings.rows.filter((m) => isFuture(parseISO(m.starts_at))).sort(byStart);
  const past = meetings.rows.filter((m) => !isFuture(parseISO(m.starts_at))).sort(byStart).reverse();
  const visible = tab === 'upcoming' ? upcoming : past;

  // `visible` is already ordered, so adjacent rows sharing a heading group in one pass.
  const groups: { label: string; rows: Meeting[] }[] = [];
  for (const m of visible) {
    const label = dayHeading(parseISO(m.starts_at), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(m);
    else groups.push({ label, rows: [m] });
  }

  // Slot helpers are only useful while the meeting form is open.
  const pickedDuration = durationMinutes(form.starts_at, form.ends_at);
  const startDay = dayOffsetFromToday(form.starts_at, now);
  const rangeError = isEndBeforeStart(form.starts_at, form.ends_at);
  const saveReason = !form.title.trim()
    ? 'Title required'
    : !form.starts_at
      ? 'Start time required'
      : rangeError
        ? 'Ends must be after it starts'
        : null;

  return (
    <div className="os-enter mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Calendar"
        title="Meetings"
        sub="Agenda in, action items out."
        data={[`${upcoming.length} upcoming`, `${past.length} past`, localZone && `times in ${localZone}`]}
        action={<Button onClick={openNew}>+ New meeting</Button>}
      />

      {meetings.error && <ErrorBanner message={meetings.error} />}

      {/* Hairline tab rail: active tab is white ink on a 2px bar. */}
      <div className="mb-4 flex gap-6 border-b border-line">
        {(['upcoming', 'past'] as Filter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t || undefined}
            className={`os-tap-none -mb-px flex min-h-[36px] items-center gap-1.5 border-b-2 px-0 text-[13px] transition-colors duration-150 ${
              tab === t
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="capitalize">{t}</span>
            {t === 'upcoming' && upcoming.length > 0 && (
              <span className="os-mono text-[11px] text-muted-foreground">{upcoming.length}</span>
            )}
            {t === 'past' && past.length > 0 && (
              <span className="os-mono text-[11px] text-muted-foreground">{past.length}</span>
            )}
          </button>
        ))}
      </div>

      {meetings.loading ? (
        <Spinner />
      ) : meetings.rows.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Schedule one, or convert an inbox capture into a meeting." />
      ) : visible.length === 0 ? (
        <EmptyState title={tab === 'upcoming' ? 'Nothing scheduled' : 'No past meetings'} />
      ) : (
        <div>
          {groups.map((g) => (
            <div key={`${g.label}-${g.rows[0].id}`}>
              <div className="flex items-baseline justify-between gap-3 border-b border-line-faint pb-1 pt-5 first:pt-0">
                <span className="os-label">{g.label}</span>
                <span className="os-mono text-[11px] text-faint">{g.rows.length}</span>
              </div>
              {g.rows.map((m) => (
                <MeetingRow key={m.id} m={m} past={tab === 'past'} onOpen={openEdit} />
              ))}
            </div>
          ))}
        </div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New meeting' : modal.title} onClose={() => setModal('closed')} size="wide">
          <form onSubmit={save} className="space-y-4">
            <Field label="Title">
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full" placeholder="Investor call, sprint planning…" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Starts">
                <input
                  type="datetime-local"
                  required
                  value={form.starts_at}
                  onChange={(e) => applySlot(editStart(slotState(), e.target.value))}
                  className="w-full"
                />
              </Field>
              <Field label="Ends">
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  aria-invalid={rangeError || undefined}
                  onChange={(e) => applySlot(editEnd(slotState(), e.target.value))}
                  className="w-full"
                />
              </Field>
            </div>

            {rangeError && <p className="os-mono text-[11px] text-danger">Ends before it starts — the end time is not saved.</p>}

            {/* Select, don't type: duration and day helpers, then the resulting slot in mono. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="os-label mr-1">Duration</span>
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.minutes}
                    type="button"
                    onClick={() => applySlot(pickDuration(slotState(), preset.minutes))}
                    aria-pressed={pickedDuration === preset.minutes}
                    className={chipClass(pickedDuration === preset.minutes)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="os-label mr-1">Day</span>
                {DAY_CHIPS.map((chip) => (
                  <button
                    key={chip.days}
                    type="button"
                    onClick={() => applySlot(shiftDay(slotState(), chip.days, now))}
                    aria-pressed={startDay === chip.days}
                    className={chipClass(startDay === chip.days)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <p className="os-micro">
                {slotSummary(form.starts_at, form.ends_at)}
                {!follow && form.ends_at ? ' · end fixed' : ''}
              </p>
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
              <div className="os-panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="os-label">
                    {ordered.length} linked task{ordered.length === 1 ? '' : 's'}
                  </span>
                  <Button variant="secondary" onClick={extractActions} disabled={aiBusy}>
                    {aiBusy && <ProgressRing />}
                    {aiBusy ? 'Extracting…' : 'Extract action items → tasks'}
                  </Button>
                </div>

                {ordered.length > 0 && (
                  <Reorder.Group
                    axis="y"
                    values={ordered}
                    onReorder={handleReorder}
                    className="mt-2 border-t border-line"
                  >
                    {ordered.map((t) => (
                      <Reorder.Item
                        key={t.id}
                        value={t}
                        className="flex min-h-[36px] cursor-grab items-center gap-2 border-b border-line py-1.5 text-[13px] text-foreground active:cursor-grabbing"
                      >
                        <span className="os-mono text-faint" aria-hidden="true">
                          ⠿
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            tasks.update(t.id, {
                              status: t.status === 'done' ? 'open' : 'done',
                              completed_at: t.status === 'done' ? null : new Date().toISOString(),
                            })
                          }
                          aria-label={t.status === 'done' ? 'Mark open' : 'Mark done'}
                          className={`flex-1 text-left transition-colors duration-150 ${
                            t.status === 'done' ? 'text-muted-foreground line-through' : 'hover:text-foreground'
                          }`}
                        >
                          {t.title}
                        </button>
                      </Reorder.Item>
                    ))}
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

                {orderError && <p className="mt-2 text-[12px] text-warning">{orderError}</p>}
                {aiResult && <p className="os-micro mt-2">{aiResult}</p>}
              </div>
            )}

            {formError && <ErrorBanner message={formError} />}

            <div className="flex items-center justify-between gap-3">
              {modal !== 'new' ? (
                <div className="flex items-center gap-3">
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (armedDelete) deleteMeeting();
                      else setArmedDelete(true);
                    }}
                    disabled={saving}
                  >
                    {armedDelete ? 'Confirm delete' : 'Delete'}
                  </Button>
                  {armedDelete && (
                    <span className="os-mono text-[11px] text-danger">
                      permanent — linked tasks are not deleted
                    </span>
                  )}
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-3">
                {saveReason && <span className="os-mono text-[11px] text-danger">{saveReason}</span>}
                <Button type="submit" disabled={saving || !!saveReason}>
                  {saving ? 'Saving…' : 'Save meeting'}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
