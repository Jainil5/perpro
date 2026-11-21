'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { InboxItem } from '@/lib/types';
import { useTable } from '@/lib/useTable';
import { format, parseISO } from 'date-fns';

/** Touch only: the swipe is behaviour, so it stays; the spring and scale do not. */
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
  bulkMode,
  selected,
  busy,
  isTouch,
  onToggleSelect,
  onConvert,
  onDismiss,
}: {
  item: InboxItem;
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

  const actions = [
    {
      key: 'task' as const,
      label: busy ? '✓ task' : '→ task',
      onClick: () => onConvert(item, 'task'),
      tone: 'border-line text-foreground hover:border-line-strong',
    },
    {
      key: 'note' as const,
      label: busy ? '✓ note' : '→ note',
      onClick: () => onConvert(item, 'note'),
      tone: 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground',
    },
  ];

  return (
    <div className="relative border-b border-line">
      {swipeable && (
        <div className="os-micro absolute inset-0 flex items-center justify-between px-4">
          <motion.span style={{ opacity: taskHintOpacity }}>→ task</motion.span>
          <motion.span style={{ opacity: dismissHintOpacity }} className="text-danger">
            dismiss ←
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
        className="relative bg-background py-3"
      >
        {bulkMode && (
          <label className="absolute -left-1 top-1/2 -translate-y-1/2">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(item.id)}
              className="h-4 w-4 rounded-os border border-line accent-primary"
              aria-label="Select item"
            />
          </label>
        )}

        <p className={`whitespace-pre-wrap text-[14px] text-foreground ${bulkMode ? 'pl-6' : ''}`}>
          {item.content}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="os-mono mr-auto text-[11px] text-muted-foreground">
            {format(parseISO(item.created_at), 'yyyy-MM-dd HH:mm')}
          </span>

          {!bulkMode && (
            <>
              {actions.map((action) => (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  disabled={busy}
                  className={`os-tap-none min-h-[36px] rounded-os border px-2.5 text-[12px] transition-colors duration-150 disabled:opacity-50 ${action.tone}`}
                >
                  {action.label}
                </button>
              ))}
              <a
                href={`/meetings?new=1&title=${encodeURIComponent(item.content.slice(0, 80))}`}
                className="os-tap-none flex min-h-[36px] items-center rounded-os border border-line px-2.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
              >
                → meeting
              </a>
              <button
                onClick={() => onDismiss(item)}
                disabled={busy}
                className="os-tap-none min-h-[36px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-danger disabled:opacity-50"
              >
                dismiss
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
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
    <div className="os-enter mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Capture"
        title="Inbox"
        sub={
          bulkMode
            ? `${selectedIds.size} selected`
            : 'Everything you captured. Triage it into a task, note, or meeting — or let it go.'
        }
        data={[`${inbox.rows.length} items`]}
        action={
          <div className="flex flex-wrap items-center gap-2">
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
                <button
                  onClick={() => setBulkMode(false)}
                  className="os-tap-none min-h-[36px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setBulkMode(true)}
                className="os-tap-none min-h-[36px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                Select
              </button>
            )}
          </div>
        }
      />

      {(inbox.error || actionError) && <ErrorBanner message={actionError ?? inbox.error!} />}

      {isTouch && !bulkMode && inbox.rows.length > 0 && (
        <p className="os-micro mb-2">Swipe right to make a task, left to dismiss.</p>
      )}

      {inbox.loading ? (
        <Spinner />
      ) : inbox.rows.length === 0 ? (
        <EmptyState title="Inbox zero" hint="Press Cmd+K anywhere and type to capture a thought." />
      ) : (
        <div>
          {inbox.rows.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              bulkMode={bulkMode}
              selected={selectedIds.has(item.id)}
              busy={busyId === item.id}
              isTouch={isTouch}
              onToggleSelect={toggleSelect}
              onConvert={convert}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
