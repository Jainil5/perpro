'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const COMMANDS = [
  { label: 'Go to Today', href: '/' },
  { label: 'Go to Inbox', href: '/inbox' },
  { label: 'Go to Tasks', href: '/tasks' },
  { label: 'Go to Meetings', href: '/meetings' },
  { label: 'Go to Notes', href: '/notes' },
  { label: 'Go to AI News', href: '/news' },
  { label: 'New task', href: '/tasks?new=1' },
  { label: 'New meeting', href: '/meetings?new=1' },
  { label: 'New note', href: '/notes?new=1' },
];

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
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
  const options = query.trim()
    ? [{ label: `Capture to Inbox: "${query.trim()}"`, href: '__capture__' }, ...matches]
    : matches;

  async function run(option: { label: string; href: string }) {
    if (option.href === '__capture__') {
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
    router.push(option.href);
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
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
          className="w-full rounded-none border-0 border-b border-zinc-800 bg-transparent px-4 py-4 text-base focus:border-zinc-800"
        />
        <div className="max-h-72 overflow-y-auto p-2">
          {status === 'captured' && (
            <div className="px-3 py-3 text-sm text-emerald-400">Captured to Inbox</div>
          )}
          {status === 'error' && (
            <div className="px-3 py-3 text-sm text-red-400">Could not save — is the schema applied?</div>
          )}
          {status !== 'captured' &&
            options.map((option, i) => (
              <button
                key={option.href + option.label}
                onClick={() => run(option)}
                onMouseEnter={() => setSelected(i)}
                className={`flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm ${
                  i === selected ? 'bg-indigo-600/20 text-indigo-200' : 'text-zinc-300'
                }`}
              >
                {option.href === '__capture__' ? (
                  <span className="mr-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Capture</span>
                ) : null}
                {option.label}
              </button>
            ))}
          {status !== 'captured' && options.length === 0 && (
            <div className="px-3 py-3 text-sm text-zinc-500">No matches</div>
          )}
        </div>
        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          Enter to select · Esc to close · anything you type can be captured
        </div>
      </div>
    </div>
  );
}