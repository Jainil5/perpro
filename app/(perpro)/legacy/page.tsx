import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Legacy',
  description: 'The original Supabase screens, preserved next to the live ones.',
};

/**
 * PerPro's Supabase screens did not disappear when MyOS took their URLs — they
 * are the same code, same store, moved under /legacy. This index is the honest
 * map of what is here and why.
 */
const SCREENS: { href: string; name: string; note: string }[] = [
  {
    href: '/legacy/today',
    name: 'Today',
    note: 'Supabase agenda — due tasks, next meeting, inbox preview, pinned notes. The live dashboard is the MyOS one at /.',
  },
  {
    href: '/legacy/tasks',
    name: 'Tasks',
    note: 'The flat Supabase task list (priority, due date, tags). Unrelated to the API-backed /tasks board.',
  },
  {
    href: '/legacy/projects',
    name: 'Projects',
    note: 'Supabase projects with JSON import and per-task implementation briefs; /projects/[id] still works from here.',
  },
  {
    href: '/legacy/notes',
    name: 'Notes',
    note: 'Markdown notes with AI summarize, kept in Supabase. The live knowledge hub with categories and backlinks is /notes.',
  },
];

export default function LegacyIndexPage() {
  return (
    <div className="os-enter mx-auto max-w-3xl">
      <p className="os-label mb-3">Preserved</p>
      <h1 className="os-title">Legacy screens</h1>
      <p className="os-micro mt-3 max-w-2xl leading-relaxed">
        These four screens are the original PerPro app, preserved untouched on Supabase. Inbox,
        meetings and news are not here — they were never duplicated and still live at their normal
        URLs. Nothing below writes to the MyOS API, and no data is shared between the two stores.
      </p>

      <ul className="mt-7 border-t border-line">
        {SCREENS.map((screen) => (
          <li key={screen.href} className="border-b border-line py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link href={screen.href} className="text-[15px] text-foreground underline-offset-4 hover:underline">
                {screen.name}
              </Link>
              <span className="os-mono text-[11px] text-faint">{screen.href}</span>
            </div>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {screen.note}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
