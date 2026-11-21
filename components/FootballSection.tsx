'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

/** Club art is data, not chrome: the fallback is a hairline mono chip. */
function TeamBadge({ src, name, small = false }: { src: string | null; name: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) {
    return (
      <span
        className={`${
          small ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-[11px]'
        } os-mono flex shrink-0 items-center justify-center rounded-os border border-line text-muted-foreground`}
      >
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
      className={`${small ? 'h-6 w-6' : 'h-9 w-9'} shrink-0 object-contain`}
    />
  );
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEEE, MMMM d');
}

/** Win / loss / draw is real state, so it keeps the semantic inks. */
function OutcomeChip({ result }: { result: 'W' | 'L' | 'D' }) {
  const tone =
    result === 'W' ? 'text-success' : result === 'L' ? 'text-danger' : 'text-warning';
  return (
    <span className={`os-micro ${tone}`}>{result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw'}</span>
  );
}

function MatchRow({
  match,
  followedIds,
}: {
  match: FootballMatch;
  followedIds: Set<string>;
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
    <a
      href={match.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block border-b border-line py-3 transition-colors duration-150 hover:bg-canvas-deep"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="os-label">
          {match.league}
          {match.round ? ` · MD ${match.round}` : ''}
        </span>
        <span className="os-mono text-[11px] text-muted-foreground">
          {finished
            ? formatDistanceToNow(date, { addSuffix: true })
            : `${dayLabel(date)} · ${format(date, 'HH:mm')}`}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center justify-end gap-2 text-right">
          <div className="min-w-0">
            <span
              className={`block truncate text-[13px] ${
                followedIds.has(match.home.id) ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {match.home.name}
            </span>
            {homeOut ? <OutcomeChip result={homeOut} /> : null}
          </div>
          <TeamBadge src={match.home.badge} name={match.home.name} small />
        </div>

        <div className="flex min-w-[72px] flex-col items-center border-x border-line px-3">
          {finished ? (
            <span className="os-num text-[18px] text-foreground">
              {match.homeScore}
              <span className="mx-1 text-muted-foreground">–</span>
              {match.awayScore}
            </span>
          ) : (
            <>
              <span className="os-mono text-[15px] text-foreground">{format(date, 'HH:mm')}</span>
              <span className="os-label">{isToday(date) ? 'today' : format(date, 'MMM d')}</span>
            </>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <TeamBadge src={match.away.badge} name={match.away.name} small />
          <div className="min-w-0">
            <span
              className={`block truncate text-[13px] ${
                followedIds.has(match.away.id) ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {match.away.name}
            </span>
            {awayOut ? <OutcomeChip result={awayOut} /> : null}
          </div>
        </div>
      </div>

      {match.venue ? (
        <p className="os-micro mt-2 text-center">{match.venue}</p>
      ) : null}
    </a>
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
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <section className="os-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="os-label">
            Your teams
            <span className="os-mono ml-2 font-normal">
              {teams.length}/{MAX_TEAMS}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {DEFAULT_TEAMS.some((d) => !followedIds.has(d.id)) && (
              <Button variant="ghost" onClick={restoreDefaults}>
                + UCL top 10
              </Button>
            )}
            <Button variant="secondary" onClick={refresh} disabled={!teams.length} loading={refreshing}>
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
            className="w-full"
            aria-label="Search football teams"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <ProgressRing size={14} />
            </span>
          )}
          {searchOpen && searchResults.length > 0 && (
            <ul className="os-enter absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-os border border-line bg-background">
              {searchResults.map((t) => {
                const followed = followedIds.has(t.id);
                return (
                  <li key={t.id} className="border-b border-line last:border-b-0">
                    <button
                      onClick={() => addTeam(t)}
                      disabled={followed || teams.length >= MAX_TEAMS}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-canvas-deep disabled:opacity-50"
                    >
                      <TeamBadge src={t.badge} name={t.name} small />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{t.name}</span>
                        <span className="os-micro block truncate">{t.league}</span>
                      </span>
                      <span className={`os-label ${followed ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {followed ? 'following' : 'follow'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {teams.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <span
                key={t.id}
                title={`${t.name} · ${t.league}`}
                className="inline-flex items-center gap-2 rounded-os border border-line py-1 pl-2 pr-1"
              >
                <TeamBadge src={t.badge ?? badgeById.get(t.id) ?? null} name={t.name} small />
                <span className="os-mono text-[11px] text-foreground">
                  {t.short || t.name.slice(0, 3).toUpperCase()}
                </span>
                <button
                  onClick={() => removeTeam(t.id)}
                  aria-label={`Stop following ${t.name}`}
                  className="os-tap-none flex h-7 w-7 items-center justify-center rounded-os text-muted-foreground transition-colors duration-150 hover:border-danger hover:text-danger"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {teams.length === 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="os-label mb-2">Quick follow · UCL top 10</p>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_TEAMS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTeam(t)}
                  className="os-tap-none min-h-[36px] rounded-os border border-line px-3 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {!hydrated || loading ? (
        <Spinner label="Loading fixtures…" />
      ) : teams.length === 0 ? (
        <EmptyState
          title="Follow a team to see their fixtures"
          hint="Search any club above, or quick-follow the UCL top 10. Upcoming matches and recent results will land here."
        />
      ) : !error && upcoming.length === 0 && results.length === 0 ? (
        <EmptyState
          title="No matches found for your teams"
          hint="The free data source may be off-season for these clubs. Try Refresh matches or add another team."
        />
      ) : (
        <div className="space-y-6">
          {grouped.length > 0 && (
            <section>
              <h2 className="os-label mb-2 flex items-center justify-between">
                Upcoming
                <span className="os-mono">{upcoming.length}</span>
              </h2>
              <div className="space-y-5">
                {grouped.map((g) => (
                  <div key={g.key}>
                    <p className="os-label-faint mb-1 flex items-center gap-2">
                      {dayLabel(g.date)}
                      {(isToday(g.date) || isTomorrow(g.date)) && (
                        <span className="inline-block h-2 w-2 rounded-os bg-foreground" aria-hidden="true" />
                      )}
                    </p>
                    <div>
                      {g.matches.map((m) => (
                        <MatchRow key={m.id} match={m} followedIds={followedIds} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {results.length > 0 && (
            <section>
              <h2 className="os-label mb-2 flex items-center justify-between">
                Recent results
                <span className="os-mono">{results.length}</span>
              </h2>
              <div>
                {results.map((m) => (
                  <MatchRow key={m.id} match={m} followedIds={followedIds} />
                ))}
              </div>
            </section>
          )}
          <p className="os-micro">
            Fixture data from TheSportsDB · times shown in your local timezone
          </p>
        </div>
      )}
    </div>
  );
}
