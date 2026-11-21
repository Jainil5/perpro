'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressRing, Spinner, Tag } from '@/components/ui';
import { Note, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import LegacyBanner from '@/components/LegacyBanner';
import { runAI } from '@/lib/ai-client';
import { format, parseISO } from 'date-fns';

const EMPTY_FORM = { title: '', body: '', tags: '', pinned: false };

/** A note is a hairline row that opens its own markdown preview — no flip card. */
function NoteRow({ n, onOpen }: { n: Note; onOpen: (n: Note) => void }) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <article className="border-b border-line">
      <button
        onClick={() => setShowPreview((v) => !v)}
        aria-expanded={showPreview}
        className="flex w-full items-baseline gap-3 py-2.5 text-left transition-colors duration-150 hover:bg-canvas-deep"
      >
        <span className="line-clamp-1 min-w-0 flex-1 text-[14px] leading-snug text-foreground">
          {n.title}
        </span>
        {n.pinned && (
          <span className="shrink-0 text-[11px] text-foreground" title="Pinned">
            ★ pinned
          </span>
        )}
        <span className="os-mono shrink-0 text-[11px] text-faint">
          {format(parseISO(n.updated_at), 'yyyy-MM-dd')}
        </span>
      </button>

      {!showPreview && (
        <p className="line-clamp-2 pb-2 text-[13px] leading-relaxed text-muted-foreground">
          {n.body || 'Empty note'}
        </p>
      )}

      {n.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2.5">
          {n.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}

      {showPreview && (
        <div className="os-enter pb-3">
          <div className="markdown-body border-y border-line bg-canvas-deep p-3 text-xs">
            <ReactMarkdown>{n.body || '*Empty note*'}</ReactMarkdown>
          </div>
          <button
            onClick={() => onOpen(n)}
            className="os-tap-none mt-2 min-h-[36px] bg-transparent p-0 text-[12px] text-muted-foreground underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
          >
            Open in editor
          </button>
        </div>
      )}
    </article>
  );
}

export default function NotesPage() {
  const notes = useTable<Note>('notes', 'updated_at');
  const tasks = useTable<Task>('tasks');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'closed' | 'new' | Note>('closed');
  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<'summarize' | 'actions' | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const typewriterTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew();
    return () => {
      if (typewriterTimer.current) clearInterval(typewriterTimer.current);
    };
  }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setPreview(false);
    setFormError(null);
    setAiSummary(null);
    setAiMessage(null);
    setModal('new');
  }

  function openEdit(n: Note) {
    setForm({ title: n.title, body: n.body, tags: n.tags.join(', '), pinned: n.pinned });
    setPreview(false);
    setFormError(null);
    setAiSummary(null);
    setAiMessage(null);
    setModal(n);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setFormError(null);
    const values = {
      title: form.title.trim() || 'Untitled',
      body: form.body,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      pinned: form.pinned,
      updated_at: new Date().toISOString(),
    };
    try {
      if (modal === 'new') await notes.insert(values);
      else if (modal !== 'closed') await notes.update(modal.id, values);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    }
    setSaving(false);
  }

  async function deleteNote() {
    if (modal === 'closed' || modal === 'new') return;
    setSaving(true);
    try {
      await notes.remove(modal.id);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'delete failed');
    }
    setSaving(false);
  }

  async function runAi(action: 'summarize' | 'actions') {
    if (!form.body.trim()) {
      setAiMessage('Write something first.');
      return;
    }
    setAiBusy(action);
    setAiMessage(null);
    if (action === 'summarize') setAiSummary('');
    try {
      const result = await runAI(action, form.body, {
        onDelta: (text) => setAiSummary((prev) => (prev ?? '') + text),
      });
      if (action === 'summarize') {
        setAiSummary(result.summary ?? '');
      } else {
        const items = result.items ?? [];
        if (items.length === 0) setAiMessage('No action items found.');
        else {
          for (const title of items) {
            await tasks.insert({ title, notes: `From note: ${form.title || 'Untitled'}` });
          }
          setAiMessage(`Created ${items.length} task${items.length === 1 ? '' : 's'}.`);
        }
      }
    } catch (err) {
      setAiMessage(err instanceof Error ? err.message : 'AI request failed');
      if (action === 'summarize') setAiSummary(null);
    }
    setAiBusy(null);
  }

  function appendSummary() {
    if (!aiSummary) return;
    const addition = `\n\n## Summary\n${aiSummary}`;
    const base = form.body;
    setAiSummary(null);
    setPreview(false);
    if (typewriterTimer.current) clearInterval(typewriterTimer.current);
    let i = 0;
    typewriterTimer.current = setInterval(() => {
      i += 3;
      setForm((f) => ({ ...f, body: base + addition.slice(0, i) }));
      if (i >= addition.length && typewriterTimer.current) {
        clearInterval(typewriterTimer.current);
        typewriterTimer.current = null;
      }
    }, 16);
  }

  const visible = notes.rows
    .filter((n) =>
      search.trim()
        ? (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(search.toLowerCase())
        : true
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <div className="os-enter mx-auto max-w-4xl">
      <LegacyBanner live="/notes" />
      <PageHeader
        eyebrow="Supabase"
        title="Notes"
        sub="Markdown notes with AI summarize and action extraction."
        data={[`${visible.length} shown`]}
        action={<Button onClick={openNew}>+ New note</Button>}
      />
      {notes.error && <ErrorBanner message={notes.error} />}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notes…"
        aria-label="Search notes"
        className="mb-4 min-h-[44px] w-full"
      />
      {notes.loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState title="No notes" hint="Ideas, specs, meeting takeaways — write them down before they vanish." />
      ) : (
        <div className="border-t border-line">
          {visible.map((n) => (
            <NoteRow key={n.id} n={n} onOpen={openEdit} />
          ))}
        </div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New note' : 'Edit note'} onClose={() => setModal('closed')} size="wide">
          <form onSubmit={save} className="space-y-4">
            <div className="flex gap-2">
              <input
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="min-w-0 flex-1"
                placeholder="Note title"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, pinned: !form.pinned })}
                aria-label={form.pinned ? 'Unpin' : 'Pin'}
                aria-pressed={form.pinned}
                className={`flex min-h-[44px] w-11 shrink-0 items-center justify-center rounded-os border text-lg transition-colors duration-150 ${
                  form.pinned
                    ? 'border-line-strong text-foreground'
                    : 'border-line text-faint hover:border-line-strong hover:text-muted-foreground'
                }`}
              >
                ★
              </button>
            </div>

            <Field label="Tags (comma separated)">
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full" placeholder="product, ideas" />
            </Field>

            <div>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="os-label">Body (markdown)</span>
                <button
                  type="button"
                  onClick={() => setPreview((p) => !p)}
                  aria-pressed={preview}
                  className="os-tap-none min-h-[36px] bg-transparent px-0 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  {preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {preview ? (
                <div className="markdown-body min-h-[160px] border border-line p-3 text-xs">
                  <ReactMarkdown>{form.body || '*Nothing to preview*'}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={8}
                  className="os-mono w-full text-xs"
                  placeholder="Write in markdown…"
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => runAi('summarize')} disabled={aiBusy !== null}>
                {aiBusy === 'summarize' && <ProgressRing />}
                {aiBusy === 'summarize' ? 'Summarizing…' : 'AI: summarize'}
              </Button>
              <Button variant="secondary" onClick={() => runAi('actions')} disabled={aiBusy !== null}>
                {aiBusy === 'actions' && <ProgressRing />}
                {aiBusy === 'actions' ? 'Extracting…' : 'AI: extract action items → tasks'}
              </Button>
            </div>

            {aiSummary !== null && (
              <div className="os-enter border-y border-line p-3">
                <p className="os-label mb-2">Summary</p>
                <div className="markdown-body text-xs">
                  <ReactMarkdown>{aiSummary || '…'}</ReactMarkdown>
                </div>
                {aiBusy !== 'summarize' && aiSummary && (
                  <button
                    type="button"
                    onClick={appendSummary}
                    className="os-tap-none mt-2 min-h-[36px] bg-transparent p-0 text-[12px] text-muted-foreground underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                  >
                    Append summary to note
                  </button>
                )}
              </div>
            )}
            {aiMessage && <p className="os-micro text-muted-foreground">{aiMessage}</p>}

            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-between gap-2 pt-1">
              {modal !== 'new' ? (
                <Button variant="danger" onClick={deleteNote} disabled={saving}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save note'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
