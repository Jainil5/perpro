import { NextRequest, NextResponse } from 'next/server';
import { FootballMatch, FootballTeam } from '@/lib/types';

export const maxDuration = 60;

const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const MATCH_TTL = 5 * 60 * 1000;
const SEARCH_TTL = 24 * 60 * 60 * 1000;

// Survives Next.js dev hot reloads so testing doesn't burn the free key's 30 req/min quota
const globalStore = globalThis as unknown as {
  __perproFootballCache?: Map<string, { at: number; data: unknown }>;
};
const cache = (globalStore.__perproFootballCache ??= new Map());

async function upstream(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`football source returned ${res.status}`);
  return res.json();
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function searchTeams(q: string): Promise<FootballTeam[]> {
  return cached(`search:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    const attempts = [q];
    // TheSportsDB search misses hyphenated names (e.g. Paris Saint-Germain)
    const normalized = q.replace(/[-.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.toLowerCase() !== q.toLowerCase()) attempts.push(normalized);
    for (const query of attempts) {
      const data = await upstream(`searchteams.php?t=${encodeURIComponent(query)}`);
      const raw = (data.teams ?? []) as Record<string, string | null>[];
      const teams = raw
        .filter((t) => t.strSport === 'Soccer')
        .slice(0, 8)
        .map((t) => ({
          id: t.idTeam as string,
          name: t.strTeam as string,
          league: t.strLeague ?? '',
          badge: t.strTeamBadge ?? null,
          short: t.strTeamShort || null,
        }));
      if (teams.length) return teams;
    }
    return [];
  });
}

function toMatch(e: Record<string, string | null>): FootballMatch {
  const timestamp = e.strTimestamp
    ? e.strTimestamp.endsWith('Z')
      ? e.strTimestamp
      : `${e.strTimestamp}Z`
    : `${e.dateEvent}T${e.strTime ?? '00:00:00'}Z`;
  const score = (v: string | null) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    id: e.idEvent as string,
    timestamp,
    league: e.strLeague ?? '',
    round: e.intRound || null,
    home: { id: e.idHomeTeam as string, name: e.strHomeTeam as string, badge: e.strHomeTeamBadge || null },
    away: { id: e.idAwayTeam as string, name: e.strAwayTeam as string, badge: e.strAwayTeamBadge || null },
    homeScore: score(e.intHomeScore),
    awayScore: score(e.intAwayScore),
    venue: e.strVenue || null,
    url: `https://www.thesportsdb.com/event/${e.idEvent}`,
  };
}

async function getMatches(ids: string[], force: boolean) {
  const key = `matches:${[...ids].sort().join(',')}`;
  if (force) cache.delete(key);
  const events = await cached(key, MATCH_TTL, async () => {
    let failures = 0;
    const perTeam = await Promise.all(
      ids.map(async (id) => {
        try {
          const [next, last] = await Promise.all([
            upstream(`eventsnext.php?id=${id}`),
            upstream(`eventslast.php?id=${id}`),
          ]);
          return [
            ...((next.events ?? []) as Record<string, string | null>[]),
            ...((last.results ?? []) as Record<string, string | null>[]),
          ];
        } catch {
          failures++;
          return [];
        }
      })
    );
    if (failures === ids.length) {
      throw new Error('football source is rate-limited or unreachable — try again in a minute');
    }
    const byId = new Map<string, Record<string, string | null>>();
    perTeam.flat().forEach((e) => byId.set(e.idEvent as string, e));
    return Array.from(byId.values());
  });
  const all = events.map(toMatch);
  const byTime = (a: FootballMatch, b: FootballMatch) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  const upcoming = all
    .filter((m) => m.homeScore === null || m.awayScore === null)
    .sort(byTime)
    .slice(0, 20);
  const results = all
    .filter((m) => m.homeScore !== null && m.awayScore !== null)
    .sort((a, b) => byTime(b, a))
    .slice(0, 20);
  return { upcoming, results };
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  try {
    if (action === 'search') {
      const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
      if (q.length < 2) return NextResponse.json({ teams: [] });
      return NextResponse.json({ teams: await searchTeams(q) });
    }
    if (action === 'matches') {
      const ids = Array.from(
        new Set(
          (req.nextUrl.searchParams.get('teams') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ).slice(0, 12);
      if (!ids.length) return NextResponse.json({ upcoming: [], results: [] });
      const force = req.nextUrl.searchParams.get('force') === '1';
      return NextResponse.json(await getMatches(ids, force));
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'football request failed' },
      { status: 502 }
    );
  }
}