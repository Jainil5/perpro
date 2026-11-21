'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressRing, Spinner, Tag } from '@/components/ui';
import { Note, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { runAI } from '@/lib/ai-client';
import { format, parseISO } from 'date-fns';

const EMPTY_FORM = { title: '', body: '', tags: '', pinned: false };

function NoteCard({ n, index, onOpen }: { n: Note; index: number; onOpen: (n: Note) => void }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      layout
      className="h-48 [perspective:1000px]"
    >
      <motion.div
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="relative h-full w-full [transform-style:preserve-3d]"
      >
        <motion.button
          onClick={() => setFlipped(true)}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.98 }}
          className="absolute inset-0 flex flex-col rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--accent-brand)]/50 [backface-visibility:hidden]"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-1 text-body font-semibold text-[var(--fg-primary)]">{n.title}</span>
            {n.pinned && (
              <motion.span
                animate={{ scale: 1, rotate: 0 }}
                className="text-xs text-[var(--accent-warn)]"
                title="Pinned"
              >
                ★
              </motion.span>
            )}
          </div>
          <p className="mt-1 line-clamp-3 text-body-sm leading-relaxed text-[var(--fg-muted)]">{n.body || 'Empty note'}</p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            {n.tags.map((t, i) => <Tag key={t} delay={i * 0.04}>{t}</Tag>)}
            <span className="ml-auto text-mono text-[var(--fg-subtle)]">{format(parseISO(n.updated_at), 'MMM d')}</span>
          </div>
        </motion.button>
        <div className="absolute inset-0 flex flex-col rounded-xl border border-[var(--accent-brand)]/50 bg-[var(--bg-elevated)] p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-subheading text-[var(--fg-muted)]">Preview</span>
            <button
              onClick={() => setFlipped(false)}
              aria-label="Flip back"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
            >
              ×
            </button>
          </div>
          <div className="markdown-body min-h-0 flex-1 overflow-hidden text-xs">
            <ReactMarkdown>{n.body || '*Empty note*'}</ReactMarkdown>
          </div>
          <button
            onClick={() => onOpen(n)}
            className="mt-2 min-h-[36px] rounded-lg bg-[var(--accent-brand)]/15 text-xs font-medium text-[var(--accent-brand)] transition hover:bg-[var(--accent-brand)]/30"
          >
            Open in editor
          </button>
        </div>
      </motion.div>
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto max-w-4xl"
    >
      <PageHeader title="Notes" sub="Markdown notes with AI summarize and action extraction." action={<Button onClick={openNew}>+ New note</Button>} />
      <AnimatePresence mode="wait">
        {notes.error && <ErrorBanner message={notes.error} />}
      </AnimatePresence>
      <motion.input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notes…"
        whileFocus={{ scale: 1.01 }}
        className="mb-4 min-h-[44px] w-full"
      />
      {notes.loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState title="No notes" hint="Ideas, specs, meeting takeaways — write them down before they vanish." />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visible.map((n, index) => (
            <NoteCard key={n.id} n={n} index={index} onOpen={openEdit} />
          ))}
        </motion.div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New note' : 'Edit note'} onClose={() => setModal('closed')} size="wide">
          <form onSubmit={save} className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.05 }}
            >
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="min-w-0 flex-1"
                  placeholder="Note title"
                />
                <motion.button
                  type="button"
                  onClick={() => setForm({ ...form, pinned: !form.pinned })}
                  aria-label={form.pinned ? 'Unpin' : 'Pin'}
                  whileTap={{ scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-lg ${form.pinned ? 'border-[var(--accent-warn)]/60 text-[var(--accent-warn)]' : 'border-[var(--fg-subtle)] text-[var(--fg-subtle)]'}`}
                >
                  <motion.span
                    animate={{ scale: form.pinned ? 1 : 0, rotate: form.pinned ? 0 : -90 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    ★
                  </motion.span>
                </motion.button>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
            >
              <Field label="Tags (comma separated)">
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full" placeholder="product, ideas" />
              </Field>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.15 }}
            >
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-subheading text-[var(--fg-muted)]">Body (markdown)</span>
                  <motion.button
                    type="button"
                    onClick={() => setPreview((p) => !p)}
                    whileTap={{ scale: 0.95 }}
                    whileHover={{ scale: 1.02 }}
                    className="min-h-[44px] px-2 text-xs text-[var(--accent-brand)]"
                  >
                    {preview ? 'Edit' : 'Preview'}
                  </motion.button>
                </div>
                <AnimatePresence mode="wait">
                  {preview ? (
                    <motion.div
                      key="preview"
                      initial={{ opacity: 0, rotateY: -90 }}
                      animate={{ opacity: 1, rotateY: 0 }}
                      exit={{ opacity: 0, rotateY: 90 }}
                      transition={{ duration: 0.25 }}
                      className="markdown-body min-h-[160px] rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-deep)] p-3"
                    >
                      <ReactMarkdown>{form.body || '*Nothing to preview*'}</ReactMarkdown>
                    </motion.div>
                  ) : (
                    <motion.textarea
                      key="editor"
                      initial={{ opacity: 0, rotateY: 90 }}
                      animate={{ opacity: 1, rotateY: 0 }}
                      exit={{ opacity: 0, rotateY: -90 }}
                      transition={{ duration: 0.25 }}
                      value={form.body}
                      onChange={(e) => setForm({ ...form, body: e.target.value })}
                      rows={8}
                      className="w-full font-mono text-xs"
                      placeholder="Write in markdown…"
                    />
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
              className="flex flex-wrap gap-2"
            >
              <motion.button
                type="button"
                onClick={() => runAi('summarize')}
                disabled={aiBusy !== null}
                whileTap={{ scale: 0.95 }}
                whileHover={aiBusy === null ? { scale: 1.02 } : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-xs font-medium ${aiBusy === 'summarize' ? 'bg-[var(--accent-ai)]/25 text-[var(--accent-ai)] cursor-wait' : 'bg-[var(--accent-ai)]/15 text-[var(--accent-ai)] hover:bg-[var(--accent-ai)]/25'}`}
              >
                {aiBusy === 'summarize' && <ProgressRing />}
                {aiBusy === 'summarize' ? 'Summarizing…' : 'AI: summarize'}
              </motion.button>
              <motion.button
                type="button"
                onClick={() => runAi('actions')}
                disabled={aiBusy !== null}
                whileTap={{ scale: 0.95 }}
                whileHover={aiBusy === null ? { scale: 1.02 } : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-xs font-medium ${aiBusy === 'actions' ? 'bg-[var(--accent-ai)]/25 text-[var(--accent-ai)] cursor-wait' : 'bg-[var(--accent-ai)]/15 text-[var(--accent-ai)] hover:bg-[var(--accent-ai)]/25'}`}
              >
                {aiBusy === 'actions' && <ProgressRing />}
                {aiBusy === 'actions' ? 'Extracting…' : 'AI: extract action items → tasks'}
              </motion.button>
            </motion.div>

            <AnimatePresence mode="wait">
              {aiSummary !== null && (
                <motion.div
                  key="summary"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-lg border border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 p-3"
                >
                  <div className="markdown-body text-xs">
                    <ReactMarkdown>{aiSummary || '…'}</ReactMarkdown>
                  </div>
                  {aiBusy !== 'summarize' && aiSummary && (
                    <motion.button
                      type="button"
                      onClick={appendSummary}
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.02 }}
                      className="mt-2 min-h-[44px] text-xs text-[var(--accent-ai)] underline"
                    >
                      Append summary to note
                    </motion.button>
                  )}
                </motion.div>
              )}
              {aiMessage && (
                <motion.p
                  key="message"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-xs text-[var(--accent-ai)]"
                >
                  {aiMessage}
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {formError && <ErrorBanner message={formError} />}
            </AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.25 }}
              className="flex justify-between gap-2"
            >
              {modal !== 'new' ? (
                <Button variant="danger" onClick={deleteNote} disabled={saving}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save note'}</Button>
            </motion.div>
          </form>
        </Modal>
      )}
    </motion.div>
  );
}