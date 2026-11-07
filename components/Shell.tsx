'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import CommandPalette from './CommandPalette';

const NAV = [
  { href: '/', label: 'Today', icon: 'M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5L16 7m-8 10l-1.5 1.5m11 0L16 17M8 7L6.5 5.5M12 8a4 4 0 100 8 4 4 0 000-8z' },
  { href: '/inbox', label: 'Inbox', icon: 'M3 8l7.9 5.3a2 2 0 002.2 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { href: '/tasks', label: 'Tasks', icon: 'M9 11l3 3 8-8M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { href: '/meetings', label: 'Meetings', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/notes', label: 'Notes', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.6a2 2 0 112.8 2.8L11.8 15.8 8 17l1.2-3.8 9.4-9.8z' },
  { href: '/news', label: 'AI News', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
];

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-5 w-5'}>
      <path d={d} />
    </svg>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-zinc-800 bg-zinc-950/95 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold">P</div>
          <div>
            <div className="text-sm font-semibold tracking-tight">PerPro</div>
            <div className="text-[11px] text-zinc-500">founder command center</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm transition ${
                  active ? 'bg-indigo-600/15 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <Icon d={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-3 mb-4 flex min-h-[44px] items-center justify-between rounded-lg border border-zinc-800 px-3 text-xs text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
        >
          Quick capture
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold">P</div>
          <span className="text-sm font-semibold">PerPro</span>
        </div>
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-zinc-800 text-zinc-400"
          aria-label="Quick capture"
        >
          <Icon d="M12 5v14m-7-7h14" />
        </button>
      </header>

      <main className="px-4 pb-24 pt-6 md:ml-56 md:px-8 md:pb-12">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${
                active ? 'text-indigo-400' : 'text-zinc-500'
              }`}
            >
              <Icon d={item.icon} className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}