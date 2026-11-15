'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, ProgressRing, Spinner } from '@/components/ui';
import { FootballMatch, FootballTeam } from '@/lib/types';
import { format, formatDistanceToNow, isToday, isTomorrow, parseISO } from 'date-fns';

const STORAGE_KEY = 'perpro.football.teams.v2';
const MAX_TEAMS = 12;

const DEFAULT_TEAMS: FootballTeam[] = [
  { id: '133714', name: 'Paris Saint-Germain', short: 'PSG', league: 'French Ligue 1', badge: null },
  { id: '133739', name: 'Barcelona', short: 'FCB', league: 'Spanish La Liga', badge: null },
  { id: '133738', name: 'Real Madrid', short: 'RMA', league: 'Spanish La Liga', badge: null },
  { id: '133602', name: 'Liverpool', short: 'LIV', league: 'English Premier League', badge: null },
  { id: '133613', name: 'Manchester City', short: 'MCI', league: 'English Premier League', badge: null },
  { id: '133604', name: 'Arsenal', short: 'ARS', league: 'English Premier League', badge: null },
  { id: '133664', name: 'Bayern Munich', short: 'BAY', league: 'German Bundesliga', badge: null },
  { id: '133681', name: 'Inter Milan', short: 'INT', league: 'Italian Serie A', badge: null },
  { id: '133650', name: 'Borussia Dortmund', short: 'BVB', league: 'German Bundesliga', badge: null },
  { id: '133729', name: 'Atlético Madrid', short: 'ATM', league: 'Spanish La Liga', badge: null },
];

function TeamBadge({ src, name, small = false }: { src: string | null; name: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const box = small ? 'h-6 w-6 text-[10px]' : 'h-10 w-10 text-sm';
  if (!src || broken) {
    return (
      <span className={`${box} flex shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-bold text-[var(--fg-muted)]`}>
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${small ? 'h-6 w-6' : 'h-10 w-10'} shrink-0 object-contain`}
    />
  );
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEEE, MMMM d');
}

function OutcomeChip({ result }: { result: 'W' | 'L' | 'D' }) {
  const color =
    result === 'W' ? 'var(--accent-success)' : result === 'L' ? 'var(--accent-critical)' : 'var(--accent-warn)';
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-[var(--bg-deep)]"
      style={{ backgroundColor: color }}
    >
      {result}
    </motion.span>
  );
}

function MatchCard({
  match,
  followedIds,
  index,
}: {
  match: FootballMatch;
  followedIds: Set<string>;
  index: number;
}) {
  const finished = match.homeScore !== null && match.awayScore !== null;
  const date = parseISO(match.timestamp);

  function outcome(side: 'home' | 'away'): 'W' | 'L' | 'D' | null {
    if (!finished || !followedIds.has(match[side].id)) return null;
    const mine = side === 'home' ? match.homeScore! : match.awayScore!;
    const theirs = side === 'home' ? match.awayScore! : match.homeScore!;
    return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
  }

  const homeOut = outcome('home');
  const awayOut = outcome('away');

  return (
    <motion.a
      href={match.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.4) }}
      whileHover={{ x: 4 }}
      className="block rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4 transition hover:border-[var(--accent-success)]/50"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--fg-subtle)]">
        <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--fg-muted)]">
          {match.league}
          {match.round ? ` · MD ${match.round}` : ''}
        </span>
        <span>
          {finished
            ? formatDistanceToNow(date, { addSuffix: true })
            : `${dayLabel(date)} · ${format(date, 'HH:mm')}`}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <TeamBadge src={match.home.badge} name={match.home.name} />
          <span className={`text-xs leading-tight ${followedIds.has(match.home.id) ? 'font-semibold text-[var(--fg-primary)]' : 'text-[var(--fg-muted)]'}`}>
            {match.home.name}
          </span>
          {homeOut && <OutcomeChip result={homeOut} />}
        </div>
        <div className="flex min-w-[64px] flex-col items-center">
          {finished ? (
            <span className="font-mono text-xl font-bold tracking-tight text-[var(--fg-primary)]">
              {match.homeScore}
              <span className="mx-1 text-[var(--fg-subtle)]">–</span>
              {match.awayScore}
            </span>
          ) : (
            <>
              <span className="font-mono text-lg font-semibold text-[var(--accent-success)]">
                {format(date, 'HH:mm')}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">
                {isToday(date) ? 'Today' : format(date, 'MMM d')}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <TeamBadge src={match.away.badge} name={match.away.name} />
          <span className={`text-xs leading-tight ${followedIds.has(match.away.id) ? 'font-semibold text-[var(--fg-primary)]' : 'text-[var(--fg-muted)]'}`}>
            {match.away.name}
          </span>
          {awayOut && <OutcomeChip result={awayOut} />}
        </div>
      </div>
      {match.venue && (
        <p className="mt-3 text-center text-[11px] text-[var(--fg-subtle)]">{match.venue}</p>
      )}
    </motion.a>
  );
}

export default function FootballSection() {
  const [teams, setTeams] = useState<FootballTeam[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [upcoming, setUpcoming] = useState<FootballMatch[]>([]);
  const [results, setResults] = useState<FootballMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FootballTeam[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        setTeams(DEFAULT_TEAMS);
      } else {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTeams(parsed.filter((t) => t && typeof t.id === 'string'));
      }
    } catch {
      // corrupted storage — start fresh
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
  }, [teams, hydrated]);

  const loadMatches = useCallback(async (ids: string[], force = false) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/football?action=matches&teams=${ids.join(',')}${force ? '&force=1' : ''}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed to load matches');
      setUpcoming(data.upcoming);
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load matches');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!teams.length) {
      setUpcoming([]);
      setResults([]);
      return;
    }
    setLoading(true);
    loadMatches(teams.map((t) => t.id));
  }, [hydrated, teams, loadMatches]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/football?action=search&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (res.ok) {
          setSearchResults(data.teams ?? []);
          setSearchOpen(true);
        }
      } catch {
        // aborted or offline — keep previous results
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const followedIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);

  const badgeById = useMemo(() => {
    const map = new Map<string, string>();
    [...upcoming, ...results].forEach((m) => {
      if (m.home.badge) map.set(m.home.id, m.home.badge);
      if (m.away.badge) map.set(m.away.id, m.away.badge);
    });
    return map;
  }, [upcoming, results]);

  const grouped = useMemo(() => {
    const groups: { key: string; date: Date; matches: FootballMatch[] }[] = [];
    upcoming.forEach((m) => {
      const date = parseISO(m.timestamp);
      const key = format(date, 'yyyy-MM-dd');
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.matches.push(m);
      else groups.push({ key, date, matches: [m] });
    });
    return groups;
  }, [upcoming]);

  function addTeam(team: FootballTeam) {
    setTeams((prev) =>
      prev.some((t) => t.id === team.id) || prev.length >= MAX_TEAMS ? prev : [...prev, team]
    );
    setQuery('');
    setSearchResults([]);
    setSearchOpen(false);
  }

  function removeTeam(id: string) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }

  function restoreDefaults() {
    setTeams((prev) => {
      const missing = DEFAULT_TEAMS.filter((d) => !prev.some((p) => p.id === d.id));
      return [...prev, ...missing].slice(0, MAX_TEAMS);
    });
  }

  function refresh() {
    if (!teams.length) return;
    setRefreshing(true);
    loadMatches(teams.map((t) => t.id), true);
  }

  return (
    <div className="space-y-5">
      <AnimatePresence mode="wait">{error && <ErrorBanner message={error} />}</AnimatePresence>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-[var(--accent-success)]/25 bg-gradient-to-br from-[var(--accent-success)]/[0.07] via-transparent to-transparent p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
            Your teams{' '}
            <span className="font-normal text-[var(--fg-subtle)]">
              {teams.length}/{MAX_TEAMS}
            </span>
          </h2>
          <div className="flex items-center gap-1">
            {DEFAULT_TEAMS.some((d) => !followedIds.has(d.id)) && (
              <motion.button
                onClick={restoreDefaults}
                whileTap={{ scale: 0.95 }}
                className="min-h-[44px] rounded-lg px-3 text-xs font-medium text-[var(--accent-success)] transition hover:bg-[var(--accent-success)]/10"
              >
                + UCL top 10
              </motion.button>
            )}
            <Button variant="ghost" onClick={refresh} disabled={!teams.length} loading={refreshing}>
              Refresh matches
            </Button>
          </div>
        </div>

        <div className="relative mt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
            placeholder="Search any club — Arsenal, Real Madrid, PSG…"
            className="input w-full"
            aria-label="Search football teams"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--accent-success)]">
              <ProgressRing size={14} />
            </span>
          )}
          <AnimatePresence>
            {searchOpen && searchResults.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-elevated)] shadow-xl"
              >
                {searchResults.map((t) => {
                  const followed = followedIds.has(t.id);
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => addTeam(t)}
                        disabled={followed || teams.length >= MAX_TEAMS}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--bg-surface)] disabled:opacity-50"
                      >
                        <TeamBadge src={t.badge} name={t.name} small />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--fg-primary)]">{t.name}</span>
                          <span className="block truncate text-[11px] text-[var(--fg-subtle)]">{t.league}</span>
                        </span>
                        <span className="text-xs font-medium text-[var(--accent-success)]">
                          {followed ? 'Following' : '+ Follow'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {teams.length > 0 && (
          <motion.div layout className="mt-3 flex flex-wrap gap-2">
            <AnimatePresence>
              {teams.map((t) => (
                <motion.span
                  key={t.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-success)]/30 bg-[var(--bg-surface)] py-1 pl-2 pr-1"
                  title={`${t.name} · ${t.league}`}
                >
                  <TeamBadge src={t.badge ?? badgeById.get(t.id) ?? null} name={t.name} small />
                  <span className="font-mono text-xs font-bold tracking-wide text-[var(--fg-primary)]">
                    {t.short || t.name.slice(0, 3).toUpperCase()}
                  </span>
                  <motion.button
                    onClick={() => removeTeam(t.id)}
                    aria-label={`Stop following ${t.name}`}
                    whileTap={{ scale: 0.85 }}
                    whileHover={{ scale: 1.1 }}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--fg-subtle)] transition hover:bg-[var(--accent-critical)]/15 hover:text-[var(--accent-critical)]"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </motion.button>
                </motion.span>
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {teams.length === 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">
              Quick follow · UCL top 10
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_TEAMS.map((t, i) => (
                <motion.button
                  key={t.id}
                  onClick={() => addTeam(t)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.1 + i * 0.04 }}
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ scale: 1.03 }}
                  className="min-h-[36px] rounded-full border border-[var(--fg-subtle)] px-3 text-xs text-[var(--fg-muted)] transition hover:border-[var(--accent-success)]/60 hover:text-[var(--fg-primary)]"
                >
                  {t.name}
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </motion.section>

      <AnimatePresence mode="wait">
        {!hydrated || loading ? (
          <Spinner key="loading" label="Loading fixtures…" />
        ) : teams.length === 0 ? (
          <EmptyState
            key="empty"
            title="Follow a team to see their fixtures"
            hint="Search any club above, or quick-follow the UCL top 10. Upcoming matches and recent results will land here."
          />
        ) : !error && upcoming.length === 0 && results.length === 0 ? (
          <EmptyState
            key="no-matches"
            title="No matches found for your teams"
            hint="The free data source may be off-season for these clubs. Try Refresh matches or add another team."
          />
        ) : (
          <motion.div
            key="matches"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            {grouped.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">
                  Upcoming matches
                  <span className="ml-2 rounded-full bg-[var(--accent-success)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-success)]">
                    {upcoming.length}
                  </span>
                </h2>
                <div className="space-y-4">
                  {grouped.map((g) => (
                    <div key={g.key}>
                      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                        {dayLabel(g.date)}
                        {(isToday(g.date) || isTomorrow(g.date)) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-success)]" />
                        )}
                      </p>
                      <div className="space-y-3">
                        {g.matches.map((m, i) => (
                          <MatchCard key={m.id} match={m} followedIds={followedIds} index={i} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {results.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">
                  Recent results
                  <span className="ml-2 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--fg-muted)]">
                    {results.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {results.map((m, i) => (
                    <MatchCard key={m.id} match={m} followedIds={followedIds} index={i} />
                  ))}
                </div>
              </section>
            )}
            <p className="text-center text-[11px] text-[var(--fg-subtle)]">
              Fixture data from TheSportsDB · times shown in your local timezone
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}