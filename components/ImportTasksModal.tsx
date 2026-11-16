'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, ErrorBanner, Field, Modal } from './ui';
import { copyText } from '@/lib/clipboard';
import {
  IMPORT_EXAMPLE,
  IMPORT_FIELDS_HELP,
  agentPrompt,
  parseProjectImport,
  summarizeParse,
} from '@/lib/project-import';

interface ImportSummary {
  created: number;
  duplicates: string[];
  rejected: string[];
  warnings: string[];
  categories: string[];
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
      }}
      className="text-xs"
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

function Notes({ items, tone }: { items: string[]; tone: 'warn' | 'bad' }) {
  if (!items.length) return null;
  const color = tone === 'warn' ? 'text-[var(--accent-warn)]' : 'text-[var(--accent-critical)]';
  return (
    <ul className={`mt-1 space-y-0.5 text-body-sm ${color}`}>
      {items.slice(0, 6).map((line, i) => (
        <motion.li key={`${line}-${i}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}>
          {line}
        </motion.li>
      ))}
      {items.length > 6 && <li>…and {items.length - 6} more</li>}
    </ul>
  );
}

export default function ImportTasksModal({
  projectId,
  projectName,
  onClose,
  onImported,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  // Parsed on every keystroke: the preview must match what the server will do.
  const parsed = useMemo(() => (raw.trim() ? parseProjectImport(raw) : null), [raw]);

  const byCategory = useMemo(() => {
    if (!parsed) return [] as [string, number][];
    const counts = new Map<string, number>();
    for (const task of parsed.tasks) {
      const key = task.category ?? 'Uncategorised';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  async function runImport() {
    if (!parsed?.tasks.length) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, raw, allow_duplicates: allowDuplicates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailure(data.error ?? 'import failed');
      } else {
        setSummary(data as ImportSummary);
        onImported();
      }
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'import failed');
    }
    setBusy(false);
  }

  return (
    <Modal title={summary ? 'Import finished' : `Import tasks into ${projectName}`} onClose={onClose} size="full">
      {summary ? (
        <div className="space-y-4">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-body text-[var(--fg-primary)]"
          >
            {summary.created > 0
              ? `${summary.created} task${summary.created === 1 ? '' : 's'} added${
                  summary.categories.length ? ` across ${summary.categories.length} categor${summary.categories.length === 1 ? 'y' : 'ies'}` : ''
                }.`
              : 'Nothing was added.'}
          </motion.p>
          {summary.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.categories.map((category) => (
                <span key={category} className="rounded bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--fg-muted)]">
                  {category}
                </span>
              ))}
            </div>
          )}
          <Notes items={summary.duplicates.map((title) => `Already in the project: ${title}`)} tone="warn" />
          <Notes items={summary.rejected} tone="bad" />
          <Notes items={summary.warnings} tone="warn" />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={IMPORT_EXAMPLE} label="Copy JSON format" />
            <CopyButton text={agentPrompt(projectName)} label="Copy prompt for an agent" />
            <span className="text-body-sm text-[var(--fg-muted)]">Give the prompt to an agent, paste what comes back.</span>
          </div>

          <Field label="Tasks JSON">
            <textarea
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={IMPORT_EXAMPLE}
              className="w-full font-mono text-xs leading-relaxed"
            />
          </Field>

          <AnimatePresence mode="wait">
            {parsed?.error ? (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ErrorBanner message={parsed.error} />
              </motion.div>
            ) : parsed ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-deep)] p-3"
              >
                <p className="text-body text-[var(--fg-primary)]">{summarizeParse(parsed)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {byCategory.map(([category, count]) => (
                    <span key={category} className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)]">
                      {category} · {count}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-body-sm text-[var(--fg-muted)]">
                  {parsed.tasks.filter((t) => t.completed).length} already done ·{' '}
                  {parsed.tasks.filter((t) => t.due_date).length} with due dates
                </p>
                <Notes items={parsed.rejected} tone="bad" />
                <Notes items={parsed.warnings} tone="warn" />
              </motion.div>
            ) : (
              <motion.div key="help" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-body-sm text-[var(--fg-muted)]">
                <p>Expected fields:</p>
                <pre className="markdown-body mt-1 whitespace-pre-wrap font-sans">{IMPORT_FIELDS_HELP}</pre>
              </motion.div>
            )}
          </AnimatePresence>

          {failure && <ErrorBanner message={failure} />}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--fg-subtle)] pt-4">
            <label className="flex items-center gap-2 text-body-sm text-[var(--fg-muted)]">
              <input
                type="checkbox"
                checked={allowDuplicates}
                onChange={(e) => setAllowDuplicates(e.target.checked)}
                className="h-4 w-4"
              />
              Import titles that already exist
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={runImport} loading={busy} disabled={!parsed || !!parsed.error || parsed.tasks.length === 0}>
                Import {parsed?.tasks.length ? `${parsed.tasks.length} task${parsed.tasks.length === 1 ? '' : 's'}` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
