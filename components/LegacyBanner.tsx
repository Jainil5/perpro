import Link from 'next/link';

/**
 * Hairline notice for the preserved Supabase screens under `/legacy/*`.
 * The screen still works, but it reads and writes the old store; this points at
 * the live (MyOS) equivalent without changing anything else on the page.
 *
 * Studio—BA language (docs/DESIGN.md §4): one strip, one rule on top, an
 * `.os-label` line of type and a plain underlined link in ink. No fill, no hue,
 * no icon — the fact is enough.
 */
export default function LegacyBanner({ live }: { live: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-2 border-t border-line pt-2">
      <span className="os-label shrink-0">Legacy Supabase store</span>
      <span aria-hidden className="os-micro">
        ·
      </span>
      <span className="os-micro min-w-0">
        the live screen is{' '}
        <Link href={live} className="text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
          {live}
        </Link>
      </span>
    </div>
  );
}
