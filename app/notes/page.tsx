'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Tag } from '@/components/ui';
import { Note, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { format, parseISO } from 'date-fns';

const EMPTY_FORM = { title: '', body: '', tags: '', pinned: false };

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

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew();
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

  async function runAI(action: 'summarize' | 'actions') {
    if (!form.body.trim()) {
      setAiMessage('Write something first.');
      return;
    }
    setAiBusy(action);
    setAiMessage(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text: form.body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'AI failed');
      if (action === 'summarize') {
        setAiSummary(data.summary);
      } else {
        const items: string[] = data.items;
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
    }
    setAiBusy(null);
  }

  const visible = notes.rows
    .filter((n) =>
      search.trim()
        ? (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(search.toLowerCase())
        : true
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Notes" sub="Markdown notes with AI summarize and action extraction." action={<Button onClick={openNew}>+ New note</Button>} />
      {notes.error && <ErrorBanner message={notes.error} />}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notes…"
        className="mb-4 min-h-[44px] w-full"
      />
      {notes.loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState title="No notes" hint="Ideas, specs, meeting takeaways — write them down before they vanish." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((n) => (
            <button key={n.id} onClick={() => openEdit(n)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition hover:border-zinc-700">
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-1 text-sm font-semibold">{n.title}</span>
                {n.pinned && <span className="text-xs text-amber-400" title="Pinned">★</span>}
              </div>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-500">{n.body || 'Empty note'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {n.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                <span className="ml-auto text-[10px] text-zinc-600">{format(parseISO(n.updated_at), 'MMM d')}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New note' : 'Edit note'} onClose={() => setModal('closed')} wide>
          <form onSubmit={save} className="space-y-4">
            <div className="flex gap-2">
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="min-w-0 flex-1" placeholder="Note title" />
              <button
                type="button"
                onClick={() => setForm({ ...form, pinned: !form.pinned })}
                aria-label={form.pinned ? 'Unpin' : 'Pin'}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-lg ${form.pinned ? 'border-amber-700 text-amber-400' : 'border-zinc-700 text-zinc-600'}`}
              >
                ★
              </button>
            </div>
            <Field label="Tags (comma separated)">
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full" placeholder="product, ideas" />
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Body (markdown)</span>
                <button type="button" onClick={() => setPreview((p) => !p)} className="min-h-[44px] px-2 text-xs text-indigo-400">
                  {preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {preview ? (
                <div className="markdown-body min-h-[160px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <ReactMarkdown>{form.body || '*Nothing to preview*'}</ReactMarkdown>
                </div>
              ) : (
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} className="w-full font-mono text-xs" placeholder="Write in markdown…" />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => runAI('summarize')} disabled={aiBusy !== null}>
                {aiBusy === 'summarize' ? 'Summarizing…' : 'AI: summarize'}
              </Button>
              <Button variant="ghost" onClick={() => runAI('actions')} disabled={aiBusy !== null}>
                {aiBusy === 'actions' ? 'Extracting…' : 'AI: extract action items → tasks'}
              </Button>
            </div>
            {aiSummary && (
              <div className="rounded-lg border border-indigo-900 bg-indigo-950/30 p-3">
                <div className="markdown-body text-xs"><ReactMarkdown>{aiSummary}</ReactMarkdown></div>
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({ ...f, body: `${f.body}\n\n## Summary\n${aiSummary}` }));
                    setAiSummary(null);
                  }}
                  className="mt-2 min-h-[44px] text-xs text-indigo-300 underline"
                >
                  Append summary to note
                </button>
              </div>
            )}
            {aiMessage && <p className="text-xs text-indigo-300">{aiMessage}</p>}

            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-between gap-2">
              {modal !== 'new' ? <Button variant="danger" onClick={deleteNote} disabled={saving}>Delete</Button> : <span />}
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save note'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}