'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { InboxItem } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { format, parseISO } from 'date-fns';

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    setIsTouch(mql.matches);
    const listener = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);
  return isTouch;
}

function InboxRow({
  item,
  index,
  bulkMode,
  selected,
  busy,
  isTouch,
  onToggleSelect,
  onConvert,
  onDismiss,
}: {
  item: InboxItem;
  index: number;
  bulkMode: boolean;
  selected: boolean;
  busy: boolean;
  isTouch: boolean;
  onToggleSelect: (id: string) => void;
  onConvert: (item: InboxItem, to: 'task' | 'note') => void;
  onDismiss: (item: InboxItem) => void;
}) {
  const x = useMotionValue(0);
  const taskHintOpacity = useTransform(x, [20, 80], [0, 1]);
  const dismissHintOpacity = useTransform(x, [-80, -20], [1, 0]);
  const swipeable = isTouch && !bulkMode;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="relative"
    >
      {swipeable && (
        <div className="absolute inset-0 flex items-center justify-between rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-elevated)] px-4">
          <motion.span style={{ opacity: taskHintOpacity }} className="text-xs font-medium text-[var(--accent-brand)]">
            → Task
          </motion.span>
          <motion.span style={{ opacity: dismissHintOpacity }} className="text-xs font-medium text-[var(--accent-critical)]">
            Dismiss ←
          </motion.span>
        </div>
      )}
      <motion.div
        drag={swipeable ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        style={swipeable ? { x } : undefined}
        onDragEnd={(_, info) => {
          if (info.offset.x > 80) onConvert(item, 'task');
          else if (info.offset.x < -80) onDismiss(item);
        }}
        whileHover={!bulkMode && !isTouch ? { x: 4 } : undefined}
        className="relative rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4 transition hover:border-[var(--accent-brand)]/50"
      >
        <AnimatePresence>
          {bulkMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, x: -20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5, x: -20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="absolute -left-3 top-1/2 -translate-y-1/2"
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.id)}
                className="h-5 w-5 rounded border-[var(--fg-subtle)] text-[var(--accent-brand)] focus:ring-2 focus:ring-[var(--accent-brand)]"
                aria-label="Select item"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <p className={`whitespace-pre-wrap text-sm text-[var(--fg-primary)] ${bulkMode ? 'pl-2' : ''}`}>{item.content}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[11px] text-[var(--fg-subtle)]">
            {format(parseISO(item.created_at), 'MMM d · h:mm a')}
          </span>

          {!bulkMode && (
            <>
              <motion.button
                onClick={() => onConvert(item, 'task')}
                disabled={busy}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                className="min-h-[44px] rounded-lg bg-[var(--accent-brand)]/15 px-3 text-xs font-medium text-[var(--accent-brand)] transition hover:bg-[var(--accent-brand)]/30 disabled:opacity-50"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {busy ? (
                    <motion.span
                      key="check"
                      initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="inline-block"
                    >
                      ✓
                    </motion.span>
                  ) : (
                    <motion.span key="arrow" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="inline-block">
                      → Task
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
              <motion.button
                onClick={() => onConvert(item, 'note')}
                disabled={busy}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                className="min-h-[44px] rounded-lg bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--fg-muted)] transition hover:bg-[var(--fg-subtle)] hover:text-[var(--fg-primary)] disabled:opacity-50"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {busy ? (
                    <motion.span
                      key="check"
                      initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="inline-block"
                    >
                      ✓
                    </motion.span>
                  ) : (
                    <motion.span key="arrow" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="inline-block">
                      → Note
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
              <motion.a
                href={`/meetings?new=1&title=${encodeURIComponent(item.content.slice(0, 80))}`}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                className="flex min-h-[44px] items-center rounded-lg bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--fg-muted)] transition hover:bg-[var(--fg-subtle)] hover:text-[var(--fg-primary)]"
              >
                → Meeting
              </motion.a>
              <motion.button
                onClick={() => onDismiss(item)}
                disabled={busy}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.05 }}
                className="min-h-[44px] rounded-lg px-3 text-xs text-[var(--fg-subtle)] transition hover:text-[var(--accent-critical)] disabled:opacity-50"
              >
                Dismiss
              </motion.button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function InboxPage() {
  const inbox = useTable<InboxItem>('inbox');
  const tasks = useTable('tasks');
  const notes = useTable('notes');
  const isTouch = useIsTouch();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'conversion failed');
    }
    setBusyId(null);
  }

  async function dismiss(item: InboxItem) {
    setBusyId(item.id);
    try {
      await inbox.remove(item.id);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
    setBusyId(null);
  }

  async function bulkConvert(to: 'task' | 'note') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBusyId('bulk');
    setActionError(null);
    try {
      for (const id of ids) {
        const item = inbox.rows.find(r => r.id === id);
        if (!item) continue;

        if (to === 'task') {
          await tasks.insert({ title: item.content });
        } else {
          await notes.insert({
            title: item.content.slice(0, 60),
            body: item.content,
          });
        }
        await inbox.remove(id);
      }
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'bulk conversion failed');
    }
    setBusyId(null);
  }

  async function bulkDismiss() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBusyId('bulk');
    try {
      for (const id of ids) {
        await inbox.remove(id);
      }
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'bulk dismiss failed');
    }
    setBusyId(null);
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto max-w-3xl"
    >
      <PageHeader
        title="Inbox"
        sub={bulkMode ? `${selectedIds.size} selected` : 'Everything you captured. Triage it into a task, note, or meeting — or let it go.'}
        action={
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-wrap items-center gap-2"
          >
            {bulkMode ? (
              <>
                <Button variant="ghost" onClick={bulkDismiss} disabled={selectedIds.size === 0 || busyId === 'bulk'}>
                  Dismiss ({selectedIds.size})
                </Button>
                <Button variant="ghost" onClick={() => bulkConvert('note')} disabled={selectedIds.size === 0 || busyId === 'bulk'}>
                  → Note ({selectedIds.size})
                </Button>
                <Button variant="primary" onClick={() => bulkConvert('task')} disabled={selectedIds.size === 0 || busyId === 'bulk'}>
                  → Task ({selectedIds.size})
                </Button>
                <motion.button
                  onClick={() => setBulkMode(false)}
                  whileTap={{ scale: 0.95 }}
                  className="min-h-[44px] rounded-lg px-3 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                >
                  Cancel
                </motion.button>
              </>
            ) : (
              <motion.button
                onClick={() => setBulkMode(true)}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                className="min-h-[44px] rounded-lg px-3 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              >
                Select
              </motion.button>
            )}
          </motion.div>
        }
      />
      <AnimatePresence mode="wait">
        {(inbox.error || actionError) && <ErrorBanner message={actionError ?? inbox.error!} />}
      </AnimatePresence>
      {isTouch && !bulkMode && inbox.rows.length > 0 && (
        <p className="mb-2 text-[11px] text-[var(--fg-subtle)]">Swipe right to make a task, left to dismiss.</p>
      )}
      {inbox.loading ? (
        <Spinner />
      ) : inbox.rows.length === 0 ? (
        <EmptyState title="Inbox zero" hint="Press Cmd+K anywhere and type to capture a thought." />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="space-y-2"
          layout
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {inbox.rows.map((item, index) => (
              <InboxRow
                key={item.id}
                item={item}
                index={index}
                bulkMode={bulkMode}
                selected={selectedIds.has(item.id)}
                busy={busyId === item.id}
                isTouch={isTouch}
                onToggleSelect={toggleSelect}
                onConvert={convert}
                onDismiss={dismiss}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.div>
  );
}