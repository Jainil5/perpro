/**
 * In-memory stand-in for Supabase, used when DEMO_MODE=1 so the app runs with no
 * credentials. It implements only the query-builder surface the API routes use:
 * select/order/limit/maybeSingle, insert, update+eq, delete+eq, upsert.
 * Data lives in the process and resets on restart.
 */

type Row = Record<string, unknown> & { id: string };

interface Filter {
  column: string;
  value: unknown;
}

interface OrderBy {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

type Op =
  | { kind: 'select'; columns: string }
  | { kind: 'insert'; values: Record<string, unknown> }
  | { kind: 'update'; values: Record<string, unknown> }
  | { kind: 'delete' }
  | { kind: 'upsert'; values: Record<string, unknown>[]; onConflict: string; ignoreDuplicates: boolean };

interface Result<T = unknown> {
  data: T;
  error: { message: string } | null;
}

const uuid = (): string => crypto.randomUUID();

const nowISO = () => new Date().toISOString();

function daysFromNow(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateFromNow(days: number): string {
  return daysFromNow(days).slice(0, 10);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const DEFAULTS: Record<string, () => Record<string, unknown>> = {
  tasks: () => ({ priority: 'medium', status: 'open', tags: [] }),
  notes: () => ({ tags: [], pinned: false, updated_at: nowISO() }),
  news_items: () => ({ saved: false, fetched_at: nowISO() }),
  inbox: () => ({}),
  meetings: () => ({}),
};

function normalize(table: string, values: Record<string, unknown>): Row {
  const defaults = DEFAULTS[table]?.() ?? {};
  return {
    ...defaults,
    ...values,
    id: (values.id as string) ?? uuid(),
    created_at: (values.created_at as string) ?? nowISO(),
  };
}

function seed(): Record<string, Row[]> {
  const meeting1 = uuid();
  const meeting2 = uuid();
  return {
    inbox: [
      { id: uuid(), content: 'Follow up with Acme about the pilot pricing tier', created_at: daysFromNow(0, 8, 12) },
      { id: uuid(), content: 'Idea: nightly eval digest emailed as a one-paragraph summary', created_at: daysFromNow(-1, 21, 5) },
      { id: uuid(), content: 'Invoice from the design contractor is due Friday', created_at: daysFromNow(-2, 10, 30) },
      { id: uuid(), content: 'Ask Dev whether the vector store migration needs a downtime window', created_at: daysFromNow(-3, 16, 0) },
    ],
    tasks: [
      { id: uuid(), title: 'Fix flaky eval harness before the investor demo', priority: 'urgent', status: 'open', due_date: dateFromNow(-2), tags: ['infra', 'demo'], notes: 'Test 4 fails ~1 in 5 runs; suspect the fixture is hitting live traffic.', created_at: daysFromNow(-6, 9), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Send Q4 roadmap draft to Priya', priority: 'high', status: 'open', due_date: dateFromNow(0), tags: ['planning'], notes: null, created_at: daysFromNow(-3, 11), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Review pricing page copy', priority: 'medium', status: 'open', due_date: dateFromNow(0), tags: ['growth'], notes: null, created_at: daysFromNow(-1, 14), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Ship the news dedupe fix', priority: 'high', status: 'open', due_date: dateFromNow(2), tags: ['product'], notes: 'Unique index on url plus upsert on conflict.', created_at: daysFromNow(-2, 15), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Interview staff engineer candidate, round 3', priority: 'medium', status: 'open', due_date: dateFromNow(4), tags: ['hiring'], notes: null, created_at: daysFromNow(-4, 10), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Book the team offsite venue', priority: 'low', status: 'open', due_date: dateFromNow(7), tags: ['ops'], notes: null, created_at: daysFromNow(-1, 9), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Migrate to the v2 Supabase schema', priority: 'medium', status: 'done', due_date: dateFromNow(-5), tags: ['infra'], notes: null, created_at: daysFromNow(-12, 9), meeting_id: null, sort_order: null, completed_at: daysFromNow(-5, 17) },
      { id: uuid(), title: 'Write the launch blog outline', priority: 'medium', status: 'open', due_date: null, tags: ['marketing'], notes: null, created_at: daysFromNow(-1, 18), meeting_id: null, sort_order: null, completed_at: null },
      { id: uuid(), title: 'Prepare slides for the board sync', priority: 'urgent', status: 'open', due_date: dateFromNow(0), tags: ['fundraise'], notes: null, created_at: daysFromNow(-1, 8), meeting_id: meeting1, sort_order: 1, completed_at: null },
      { id: uuid(), title: 'Pull retention numbers for the last 90 days', priority: 'high', status: 'open', due_date: dateFromNow(-1), tags: ['fundraise', 'data'], notes: null, created_at: daysFromNow(-2, 8), meeting_id: meeting1, sort_order: 2, completed_at: null },
    ],
    meetings: [
      { id: meeting1, title: 'Board sync — Q4 plan', starts_at: daysFromNow(0, 15, 0), ends_at: daysFromNow(0, 16, 0), attendees: 'Priya, Marcus, Sam', location: 'Meet', agenda: 'Runway, roadmap for Q4, hiring plan', notes: 'Deck is half done; retention slide still missing.', created_at: daysFromNow(-8, 9) },
      { id: meeting2, title: 'Eng weekly', starts_at: daysFromNow(1, 10, 0), ends_at: daysFromNow(1, 10, 45), attendees: 'Dev, Ana, Tom', location: 'Meet', agenda: 'Eval reliability, vector store migration', notes: null, created_at: daysFromNow(-6, 9) },
      { id: uuid(), title: 'Acme pilot check-in', starts_at: daysFromNow(3, 13, 30), ends_at: daysFromNow(3, 14, 0), attendees: 'Acme procurement', location: 'Call', agenda: 'Pilot scope, pricing tier', notes: null, created_at: daysFromNow(-4, 9) },
    ],
    notes: [
      { id: uuid(), title: 'Architecture — where we landed', body: '## Runtime\n\nNext.js 15 app router, all DB access through server routes.\n\n**Decisions**\n\n- Supabase Postgres, secret key never reaches the browser.\n- News aggregation runs on demand, cached for an hour.\n- Football fixtures come from TheSportsDB with a 5 minute cache.\n\n**Open question**\n\nDo we need a queue for AI jobs, or is inline good enough at our volume?', tags: ['arch'], pinned: true, created_at: daysFromNow(-20, 10), updated_at: daysFromNow(-2, 12) },
      { id: uuid(), title: 'Board sync prep', body: 'Runway is 14 months at current burn. Marcus cares about enterprise pilot conversion, Sam wants the hiring plan before the roadmap.\n\nRetention dropped in the last 90 days and we still do not know why. Priya asked for a one-pager rather than a full deck.\n\nNeed to decide whether to raise now or wait for the launch numbers.', tags: ['fundraise', 'meeting'], pinned: false, created_at: daysFromNow(-2, 16), updated_at: daysFromNow(-1, 9) },
      { id: uuid(), title: 'Product ideas parking lot', body: '- Nightly eval digest as a single paragraph email\n- Meeting recorder that files action items straight into tasks\n- Search across notes, tasks and news in the palette\n- Cheap tier for solo devs with a hard usage cap', tags: ['ideas'], pinned: false, created_at: daysFromNow(-9, 22), updated_at: daysFromNow(-9, 22) },
    ],
    news_items: [
      { id: uuid(), url: 'https://example.com/demo/openai-evals-toolkit', title: 'Demo item: an open-source toolkit for agent evaluations', source: 'OpenAI', summary: 'Seeded so the News page has content offline. Hit Refresh to pull the live RSS feeds.', published_at: hoursAgo(3), fetched_at: nowISO(), saved: false },
      { id: uuid(), url: 'https://example.com/demo/deepmind-long-context', title: 'Demo item: research note on long-context retrieval', source: 'Google DeepMind', summary: 'This row comes from the demo seed, not a real publication.', published_at: hoursAgo(30), fetched_at: nowISO(), saved: false },
      { id: uuid(), url: 'https://example.com/demo/hf-week-in-ai', title: 'Demo item: the week in open models', source: 'Hugging Face', summary: 'Refresh the feed to replace the seeded items with live ones.', published_at: hoursAgo(50), fetched_at: nowISO(), saved: true },
      { id: uuid(), url: 'https://example.com/demo/hn-ask-llm-scaling', title: 'Demo item: Ask HN — what actually scaled for you', source: 'Hacker News', summary: 'A seeded story so the filter by source has something to show.', published_at: hoursAgo(25), fetched_at: nowISO(), saved: false },
    ],
  };
}

const globalStore = globalThis as unknown as { __perproDemoTables?: Record<string, Row[]> };
const tables = (globalStore.__perproDemoTables ??= seed());

function isIso(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value);
}

function compare(a: unknown, b: unknown, order: OrderBy): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) {
    if (aNull && bNull) return 0;
    const nullResult = aNull ? -1 : 1;
    return order.nullsFirst ? nullResult : -nullResult;
  }
  if (isIso(a) && isIso(b)) return Date.parse(a) - Date.parse(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function project(row: Row, columns: string): Row {
  if (columns === '*') return { ...row };
  const picked: Row = { ...row };
  const wanted = new Set(columns.split(/[,\s]+/).filter(Boolean));
  for (const key of Object.keys(picked)) if (!wanted.has(key)) delete picked[key];
  return picked;
}

class DemoQuery<T = unknown> implements PromiseLike<Result<T>> {
  private filters: Filter[] = [];
  private sortBy: OrderBy | null = null;
  private maxRows: number | null = null;
  private wantsSingle = false;
  private allowsEmpty = false;

  constructor(private table: string, private op: Op) {}

  select(columns = '*') {
    this.op = { kind: 'select', columns };
    return this;
  }

  insert(values: Record<string, unknown>) {
    this.op = { kind: 'insert', values };
    return this;
  }

  update(values: Record<string, unknown>) {
    this.op = { kind: 'update', values };
    return this;
  }

  delete() {
    this.op = { kind: 'delete' };
    return this;
  }

  upsert(
    values: Record<string, unknown>[],
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  ) {
    this.op = {
      kind: 'upsert',
      values,
      onConflict: options.onConflict ?? 'id',
      ignoreDuplicates: options.ignoreDuplicates ?? false,
    };
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.sortBy = {
      column,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst ?? !(options.ascending ?? true),
    };
    return this;
  }

  limit(n: number) {
    this.maxRows = n;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  single() {
    this.wantsSingle = true;
    return this;
  }

  maybeSingle() {
    this.wantsSingle = true;
    this.allowsEmpty = true;
    return this;
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    const rows = tables[this.table] ?? [];
    return rows.filter((row) => this.filters.every((f) => String(row[f.column]) === String(f.value)));
  }

  private execute(): Result<T> {
    const rows = tables[this.table];
    if (!rows) return { data: null as T, error: { message: `unknown table ${this.table}` } };

    switch (this.op.kind) {
      case 'select': {
        const { columns } = this.op;
        let found = this.matching();
        if (this.sortBy) {
          const { column, ascending, nullsFirst } = this.sortBy;
          found = [...found].sort((a, b) => {
            const diff = compare(a[column], b[column], { column, ascending, nullsFirst });
            return ascending ? diff : -diff;
          });
        }
        if (this.maxRows !== null) found = found.slice(0, this.maxRows);
        const projected = found.map((row) => project(row, columns));
        if (this.wantsSingle) {
          if (projected.length === 0 && !this.allowsEmpty) {
            return { data: null as T, error: { message: 'no rows found' } };
          }
          return { data: (projected[0] ?? null) as T, error: null };
        }
        return { data: projected as T, error: null };
      }
      case 'insert': {
        rows.push(normalize(this.table, this.op.values));
        return { data: null as T, error: null };
      }
      case 'update': {
        for (const row of this.matching()) Object.assign(row, this.op.values);
        return { data: null as T, error: null };
      }
      case 'delete': {
        const doomed = new Set(this.matching());
        tables[this.table] = rows.filter((row) => !doomed.has(row));
        return { data: null as T, error: null };
      }
      case 'upsert': {
        const key = this.op.onConflict;
        for (const value of this.op.values) {
          const existing = rows.find((row) => String(row[key]) === String(value[key]));
          if (existing) {
            if (!this.op.ignoreDuplicates) Object.assign(existing, value, { id: existing.id });
          } else {
            rows.push(normalize(this.table, value));
          }
        }
        return { data: null as T, error: null };
      }
    }
  }
}

export function demoClient() {
  return {
    from(table: string) {
      return new DemoQuery(table, { kind: 'select', columns: '*' });
    },
  };
}
