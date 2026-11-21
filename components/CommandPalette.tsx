'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { OS_PAGE_INDEX } from '@/lib/os/nav';
import { cn } from '@/lib/os/cn';
import { useQuickCreate, type QuickKind } from './os/QuickCreate';

/**
 * One flat command list for the whole app, in the Studio—BA language: a hairline
 * panel on the canvas (no blur, no shadow, 2px radius), groups introduced by an
 * `.os-label` line, the active row marked by ink plus a 2px left bar, and mono
 * key hints. Destinations still come from the shared nav model
 * (`lib/os/nav.ts`) instead of a second hand-written array, so the palette can
 * never drift from the sidebar.
 */
type CommandGroup = 'capture' | 'go' | 'create' | 'run';

type Command = {
  label: string;
  href?: string;
  quick?: QuickKind;
  group: CommandGroup;
};

const GROUP_TITLES: Record<CommandGroup, string> = {
  capture: 'Capture',
  go: 'Go to',
  create: 'Create',
  run: 'Run',
};

const COMMANDS: Command[] = [
  ...OS_PAGE_INDEX.map((page) => ({
    label: `Go to ${page.label}`,
    href: page.href,
    group: 'go' as CommandGroup,
  })),
  { label: 'New task', quick: 'task', group: 'create' },
  { label: 'New project', quick: 'project', group: 'create' },
  { label: 'New note', quick: 'note', group: 'create' },
  { label: 'New contact', quick: 'contact', group: 'create' },
  { label: 'New reminder', quick: 'reminder', group: 'create' },
  { label: 'Import tasks from JSON', href: '/tasks?import=1', group: 'run' },
  // Meetings still live on Supabase, so its own `?new=1` shortcut still applies.
  { label: 'New meeting', href: '/meetings?new=1', group: 'run' },
];

const CAPTURE_HREF = '__capture__';

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const quick = useQuickCreate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'captured' | 'error'>('idle');

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setStatus('idle');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const matches = COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  const options: Command[] = query.trim()
    ? [{ label: `Capture to Inbox: "${query.trim()}"`, href: CAPTURE_HREF, group: 'capture' }, ...matches]
    : matches;

  async function run(option: Command) {
    if (option.href === CAPTURE_HREF) {
      setStatus('saving');
      const res = await fetch('/api/db/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: query.trim() }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      setStatus('captured');
      setTimeout(onClose, 600);
      return;
    }
    onClose();
    if (option.quick) {
      quick.open(option.quick);
      return;
    }
    if (option.href) router.push(option.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, options.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter' && options[selected]) {
      e.preventDefault();
      run(options[selected]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-os border border-line bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
            setStatus('idle');
          }}
          onKeyDown={onKeyDown}
          placeholder="Capture a thought, or type a command…"
          aria-label="Search commands"
          className="w-full px-4 py-3 text-[15px] text-foreground"
        />
        <div className="max-h-72 overflow-y-auto px-1 py-2">
          {status === 'captured' && (
            <p className="os-label px-3 py-3">
              <span className="text-success">Captured to Inbox</span>
            </p>
          )}
          {status === 'error' && (
            <p className="os-label px-3 py-3">
              <span className="text-destructive">Could not save — is the schema applied?</span>
            </p>
          )}
          {status !== 'captured' && (
            <ul role="listbox" aria-label="Commands">
              {options.map((option, i) => {
                const showHeading = i === 0 || options[i - 1].group !== option.group;
                const active = i === selected;
                return (
                  <li key={option.label}>
                    {showHeading ? (
                      <p className="os-label os-label-faint px-3 pb-1 pt-2">{GROUP_TITLES[option.group]}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => run(option)}
                      onMouseEnter={() => setSelected(i)}
                      className={cn(
                        'relative flex h-9 w-full items-center gap-2 px-3 text-left text-[13px]',
                        'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-foreground before:opacity-0',
                        'transition-colors duration-150 focus-visible:outline-none',
                        active
                          ? 'text-foreground before:opacity-100'
                          : 'text-muted-foreground'
                      )}
                    >
                      {option.href === CAPTURE_HREF ? (
                        <span className="os-label shrink-0 rounded-os border !border-line-faint px-1 py-0.5">
                          Capture
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {status !== 'captured' && options.length === 0 && (
            <p className="os-micro px-3 py-3">No matches</p>
          )}
        </div>
        <div className="border-t border-line px-4 py-2">
          <p className="os-micro flex flex-wrap items-center gap-x-2">
            <kbd>Enter</kbd>
            <span>select</span>
            <span aria-hidden>·</span>
            <kbd>Esc</kbd>
            <span>close</span>
            <span aria-hidden>·</span>
            <span>anything you type can be captured</span>
          </p>
        </div>
      </div>
    </div>
  );
}
