'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, Plus, X } from 'lucide-react';
import CommandPalette from './CommandPalette';
import ThemeToggle from './os/ThemeToggle';
import { QuickCreateProvider } from './os/QuickCreate';
import { OsToaster } from './os/ui/toast';
import { TooltipProvider } from './os/ui/tooltip';
import { useOsTheme } from './os/os-bootstrap';
import { Clock, DiscMark, MicroData, StatusDot } from './os/marks';
import { Button } from './os/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './os/ui/dropdown-menu';
import { cn } from '@/lib/os/cn';
import { useHealth, useLocalState, useMounted, useWorkspace } from '@/lib/os/hooks';
import { todayDate } from '@/lib/os/format';
import {
  isNavItemActive,
  OS_NAV_GROUPS,
  roadmapHref,
  type OsNavItem,
} from '@/lib/os/nav';

/**
 * The one app chrome, in the Studio—BA language (docs/DESIGN.md, §4 "Header").
 *
 * PerPro screens and the MyOS screens share this shell, so the nav model in
 * `lib/os/nav.ts` stays the only source of destinations, and the `.os-root` /
 * `.os-light` token contract from `app/os.css` is mounted right here (see
 * docs/MYOS/ARCHITECTURE.md §4).
 *
 * Structure: a single 48px header carrying one bottom hairline on the deepest
 * canvas, a sticky sidebar of uppercase micro-labels whose active row is marked
 * by a 2px ink bar (never a pill), and a footer of real monospace facts. Colour
 * appears only where it means something: the API is down, or it is not.
 */

/* --------------------------------------------------------- second city clock */

/**
 * The reference puts two city clocks in its header. The workspace clock comes
 * from `GET /workspace`; this one is the owner's choice, persisted through the
 * same localStorage preference hook the dashboard widgets use
 * (`useLocalState` in lib/os/hooks.ts), keyed like every other `myos.*` pref.
 */
const CITY_CLOCKS: { tz: string; code: string; city: string }[] = [
  { tz: 'UTC', code: 'UTC', city: 'Coordinated universal' },
  { tz: 'Europe/Lisbon', code: 'LIS', city: 'Lisbon' },
  { tz: 'Europe/London', code: 'LON', city: 'London' },
  { tz: 'Europe/Berlin', code: 'BER', city: 'Berlin' },
  { tz: 'Asia/Dubai', code: 'DXB', city: 'Dubai' },
  { tz: 'Asia/Kolkata', code: 'CCU', city: 'Kolkata' },
  { tz: 'Asia/Singapore', code: 'SIN', city: 'Singapore' },
  { tz: 'Australia/Sydney', code: 'SYD', city: 'Sydney' },
  { tz: 'America/New_York', code: 'NYC', city: 'New York' },
  { tz: 'America/Chicago', code: 'CHI', city: 'Chicago' },
  { tz: 'America/Los_Angeles', code: 'LAX', city: 'Los Angeles' },
  { tz: 'America/Sao_Paulo', code: 'GRU', city: 'São Paulo' },
];

const CITY_KEY = 'myos.clock.city';
const DEFAULT_CITY = 'Europe/Lisbon';

function cityOption(tz: string) {
  return CITY_CLOCKS.find((option) => option.tz === tz) ?? CITY_CLOCKS[1];
}

/* ---------------------------------------------------------------------- nav */

const ICON_STROKE = 1.25;

function NavLink({
  item,
  pathname,
  onNavigate,
  tall,
}: {
  item: OsNavItem;
  pathname: string;
  onNavigate?: () => void;
  /** 44px rows inside the mobile drawer. */
  tall?: boolean;
}) {
  const Icon = item.icon;
  // The label is written out as utilities rather than `.os-label` on purpose:
  // that class and a Tailwind colour utility tie on specificity, and app/os.css
  // loads last — the active row would never reach full ink.
  const base = cn(
    'relative flex min-w-0 items-center gap-2.5 rounded-os px-2.5 font-os-display text-[11px] font-medium uppercase leading-4 tracking-[0.14em] transition-colors duration-150',
    'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-foreground before:opacity-0',
    tall ? 'min-h-[44px]' : 'h-8'
  );

  if (item.href) {
    const active = isNavItemActive(item.href, pathname);
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        title={item.hint}
        className={cn(
          base,
          active
            ? 'text-foreground before:opacity-100'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon
          className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-faint')}
          strokeWidth={ICON_STROKE}
        />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </Link>
    );
  }

  // Not built yet: roadmap anchor, never a fake screen.
  return (
    <Link
      href={roadmapHref(item.anchor ?? 'phases')}
      onClick={onNavigate}
      title={item.hint ?? 'Planned for a later phase'}
      className={cn(base, 'text-faint hover:text-muted-foreground')}
    >
      <Icon className="size-4 shrink-0 opacity-60" strokeWidth={ICON_STROKE} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <span className="os-mono shrink-0 text-[10px] normal-case tracking-normal opacity-70">
        P{item.phase}
      </span>
    </Link>
  );
}

function NavGroups({
  pathname,
  onNavigate,
  tall,
}: {
  pathname: string;
  onNavigate?: () => void;
  tall?: boolean;
}) {
  return (
    <nav
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-4"
      aria-label="Sections"
    >
      {OS_NAV_GROUPS.map((group, i) => (
        <div key={group.title} className={cn(i > 0 && 'mt-6')}>
          <p className="os-label os-label-faint px-2.5 pb-1.5">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.label}>
                <NavLink item={item} pathname={pathname} onNavigate={onNavigate} tall={tall} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* -------------------------------------------------------------- chrome bits */

function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn('flex min-w-0 items-center gap-2', className)}
      aria-label="PerPro OS — home"
    >
      <DiscMark size={12} />
      <span className="truncate font-os-display text-[13px] font-medium uppercase leading-none tracking-[0.14em] text-foreground">
        PerPro—OS®
      </span>
    </Link>
  );
}

/**
 * The workspace clock plus the owner's chosen second city. Hidden below `sm` so
 * the bar cannot overflow a 360px viewport.
 */
function Clocks({
  workspaceTz,
  workspaceLabel,
  city,
  onCityChange,
}: {
  workspaceTz: string;
  workspaceLabel: string;
  city: string;
  onCityChange: (next: string) => void;
}) {
  const option = cityOption(city);
  return (
    <div className="hidden min-w-0 items-center gap-3 sm:flex">
      <Clock tz={workspaceTz} label={workspaceLabel} />
      <span aria-hidden className="h-4 w-px bg-line" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-size="icon"
            className="os-tap-none inline-flex h-7 items-center gap-1.5 rounded-os border !border-transparent px-1 font-os-mono text-[11px] text-faint transition-colors duration-150 hover:!border-line hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label={`Second clock city: ${option.city}. Change city`}
            title={`Second clock: ${option.city} (${option.tz})`}
          >
            <span className="uppercase tracking-[0.08em]">{option.code}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Second city</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CITY_CLOCKS.map((entry) => (
            <DropdownMenuItem
              key={entry.tz}
              onSelect={() => onCityChange(entry.tz)}
              className={cn('justify-between', entry.tz === option.tz && 'text-foreground')}
            >
              <span className="min-w-0 truncate">{entry.city}</span>
              <span className="os-mono ml-auto shrink-0 text-[10px] text-faint">{entry.code}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Clock tz={option.tz} />
    </div>
  );
}

/** `GET /health` as one 8px glyph: ink when the API answers, red when it does not. */
function HealthMark({ health }: { health: ReturnType<typeof useHealth> }) {
  const ok = health.data?.status === 'ok';
  const note = health.data
    ? `API ${health.data.status} · v${health.data.version} · ${health.data.database}`
    : health.error
      ? 'API not responding — /api/os proxy unreachable'
      : 'Checking API…';

  return (
    <span className="inline-flex items-center gap-2" title={note}>
      <span className="sr-only">{note}</span>
      <StatusDot
        state={health.data ? (ok ? 'done' : 'in_progress') : 'open'}
        tone={health.error || (health.data && !ok) ? 'critical' : undefined}
      />
    </span>
  );
}

/** Real facts only: which store, which workspace, today in ISO. */
function SidebarFacts({
  database,
  workspaceName,
}: {
  database?: string;
  workspaceName?: string;
}) {
  const store = database
    ? database === 'sqlite'
      ? 'SQLite · backend/data/myos.db'
      : database
    : null;
  return (
    <div className="shrink-0 space-y-1 border-t border-line px-3 py-3">
      <MicroData items={[workspaceName]} className="min-w-0" />
      <MicroData items={[store, todayDate()]} className="block" />
    </div>
  );
}

/* -------------------------------------------------------------------- shell */

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme] = useOsTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const workspace = useWorkspace();
  const health = useHealth();
  const [city, setCity] = useLocalState<string>(CITY_KEY, DEFAULT_CITY);
  // The chosen city is a localStorage read, so it only exists after mount.
  const mounted = useMounted();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setNavOpen(false);
      }
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // `.os-root` (+ `.os-light` in light mode) is what every MyOS component's
  // tokens hang off; the theme store keeps it in step with <html>.
  const rootClass = `os-root${theme === 'light' ? ' os-light' : ''} min-h-screen`;

  const workspaceTz = workspace.data?.timezone || 'UTC';
  const workspaceLabel = (workspace.data?.slug || 'ws').slice(0, 4).toUpperCase();
  const cityTz = mounted ? cityOption(city).tz : DEFAULT_CITY;

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <QuickCreateProvider>
        <div className={rootClass}>
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-canvas-deep px-3 md:px-4">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="-ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-os text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              data-size="icon"
            >
              <Menu className="size-4" strokeWidth={ICON_STROKE} />
            </button>

            <Wordmark />

            <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
              <Clocks
                workspaceTz={workspaceTz}
                workspaceLabel={workspaceLabel}
                city={cityTz}
                onCityChange={setCity}
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Quick capture"
                data-size="icon"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-os border !border-transparent text-muted-foreground transition-colors duration-150 hover:!border-line hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:hidden"
              >
                <Plus className="size-4" strokeWidth={ICON_STROKE} />
              </button>
              <span className="os-mono hidden shrink-0 items-center gap-1 text-[11px] text-faint sm:flex">
                <kbd className="rounded-os border border-line px-1 py-0.5">⌘K</kbd>
              </span>
              <HealthMark health={health} />
              <ThemeToggle />
            </div>
          </header>

          <div className="flex min-h-[calc(100dvh-3rem)]">
            <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-56 shrink-0 flex-col border-r border-line bg-background md:flex">
              <NavGroups pathname={pathname} />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                className="mx-2 my-2 w-[calc(100%-1rem)] justify-between gap-2 uppercase tracking-[0.14em]"
              >
                <span className="min-w-0 truncate">Quick capture</span>
                <kbd className="os-mono shrink-0 text-[10px] normal-case tracking-normal">⌘K</kbd>
              </Button>
              <SidebarFacts
                database={health.data?.database}
                workspaceName={workspace.data?.name}
              />
            </aside>

            <main className="min-w-0 max-w-full flex-1 overflow-x-hidden px-4 pb-12 pt-6 md:px-6">
              {children}
            </main>
          </div>

          {navOpen ? (
            <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Navigation">
              <button
                type="button"
                aria-label="Close navigation"
                className="absolute inset-0 bg-black/60"
                onClick={() => setNavOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-[min(17rem,84vw)] flex-col border-r border-line bg-background">
                <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
                  <Wordmark />
                  <button
                    type="button"
                    onClick={() => setNavOpen(false)}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-os text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Close navigation"
                    data-size="icon"
                  >
                    <X className="size-4" strokeWidth={ICON_STROKE} />
                  </button>
                </div>
                <NavGroups pathname={pathname} onNavigate={() => setNavOpen(false)} tall />
                <SidebarFacts database={health.data?.database} workspaceName={workspace.data?.name} />
              </div>
            </div>
          ) : null}

          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <OsToaster theme={theme} />
        </div>
      </QuickCreateProvider>
    </TooltipProvider>
  );
}
