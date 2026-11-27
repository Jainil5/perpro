import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_DEFAULT_DIR,
  CLIENT_SORTS,
  LEAD_DEFAULT_DIR,
  LEAD_SORTS,
  MEETING_DEFAULT_DIR,
  MEETING_SORTS,
  allowedLeadTransitions,
  isClosedLead,
  leadDot,
  mergeTally,
  openLeadCount,
  renewalBuckets,
  sumMrrByCurrency,
  tagCounts,
  type Client,
  type LeadStatus,
  type TallyEntry,
} from './crm.ts';

/**
 * The CRM's derived logic, pinned here because the screens refuse to keep a second copy of it:
 * the board asks `allowedLeadTransitions` before offering a move, and every money figure on the
 * account book comes through `mergeTally`/`sumMrrByCurrency`, which are only allowed to add up
 * amounts that share a currency code.
 */

/* ------------------------------------------------------------------ funnel -- */

test('the lead ladder allows any forward hop and any close', () => {
  assert.deepEqual(allowedLeadTransitions('new'), [
    'contacted',
    'qualified',
    'proposal',
    'won',
    'lost',
    'dormant',
  ]);
  assert.deepEqual(allowedLeadTransitions('contacted'), [
    'qualified',
    'proposal',
    'won',
    'lost',
    'dormant',
  ]);
  assert.deepEqual(allowedLeadTransitions('qualified'), ['proposal', 'won', 'lost', 'dormant']);
  assert.deepEqual(allowedLeadTransitions('proposal'), ['won', 'lost', 'dormant']);
  // skipping stages is legal, so the board never offers a hop the API would refuse
  assert.ok(allowedLeadTransitions('new').includes('proposal'));
});

test('won is terminal; lost and dormant only come back through contacted', () => {
  assert.deepEqual(allowedLeadTransitions('won'), []);
  assert.deepEqual(allowedLeadTransitions('lost'), ['contacted']);
  assert.deepEqual(allowedLeadTransitions('dormant'), ['contacted', 'lost']);
  assert.ok(!allowedLeadTransitions('lost').includes('proposal'));
});

test('an unknown status offers nothing rather than a guess', () => {
  assert.deepEqual(allowedLeadTransitions('sideways'), []);
  assert.deepEqual(allowedLeadTransitions(null), []);
  assert.deepEqual(allowedLeadTransitions(undefined), []);
});

test('closed means won or lost, and dormant is still in play', () => {
  assert.ok(isClosedLead('won'));
  assert.ok(isClosedLead('lost'));
  assert.ok(!isClosedLead('dormant'));
  assert.ok(!isClosedLead('proposal'));
  assert.ok(!isClosedLead(null));
});

test('the dot language matches the rest of the OS', () => {
  assert.equal(leadDot('new'), 'open');
  assert.equal(leadDot('contacted'), 'in_progress');
  assert.equal(leadDot('qualified'), 'in_progress');
  assert.equal(leadDot('proposal'), 'in_progress');
  assert.equal(leadDot('won'), 'done');
  assert.equal(leadDot('lost'), 'abandoned');
  assert.equal(leadDot('dormant'), 'archived');
  assert.equal(leadDot('unknown-value'), 'open');
});

test('leads in play excludes closed rows and dormant ones', () => {
  const pipeline: Array<{ status: LeadStatus; count: number }> = [
    { status: 'new', count: 3 },
    { status: 'contacted', count: 2 },
    { status: 'proposal', count: 1 },
    { status: 'won', count: 9 },
    { status: 'lost', count: 4 },
    { status: 'dormant', count: 7 },
  ];
  assert.equal(openLeadCount(pipeline), 6);
  assert.equal(openLeadCount([]), 0);
  assert.equal(openLeadCount(null), 0);
  // a missing count is nothing, not NaN
  assert.equal(openLeadCount([{ status: 'new', count: undefined as unknown as number }]), 0);
});

/* ------------------------------------------------------------------ money -- */

const entry = (currency: string, amount: number | null): TallyEntry => ({ currency, amount });

test('per-currency totals add same codes and never invent a rate for the rest', () => {
  const merged = mergeTally([
    [entry('INR', 100), entry('USD', 10)],
    [entry('INR', 50)],
    [entry('USD', null)],
    [],
    null,
    undefined,
  ]);
  assert.deepEqual(merged.entries, [entry('INR', 150), entry('USD', 10)]);
  // the USD null is a missing answer: counted, not folded into the INR column
  assert.equal(merged.unnamed, 1);
});

test('an entry with no code is unnamed rather than assumed to be the workspace currency', () => {
  const merged = mergeTally([[entry('', 500), entry('EUR', 20)]]);
  assert.deepEqual(merged.entries, [entry('EUR', 20)]);
  assert.equal(merged.unnamed, 1);
  assert.equal(mergeTally([]).unnamed, 0);
  assert.deepEqual(mergeTally([]).entries, []);
});

test('biggest code first, then alphabetical, so a money column reads top-down', () => {
  const merged = mergeTally([[entry('USD', 5), entry('EUR', 40), entry('AUD', 40)]]);
  assert.deepEqual(merged.entries.map((item) => item.currency), ['AUD', 'EUR', 'USD']);
});

function client(over: Partial<Client>): Client {
  return {
    id: 'c1',
    contact_id: null,
    company_id: null,
    name: 'Account',
    stage: 'active',
    health: 'unknown',
    mrr: null,
    currency: null,
    contract_start: null,
    contract_end: null,
    renewal_reminder_days: null,
    owner_id: null,
    tags: null,
    notes: null,
    source: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Client;
}

test('monthly revenue is summed per code, and a null is no answer at all', () => {
  const rows = [
    client({ id: 'a', mrr: 100, currency: 'INR' }),
    client({ id: 'b', mrr: 50, currency: 'INR' }),
    client({ id: 'c', mrr: 7, currency: 'USD' }),
    // mixed book with no code named: `mrr` is null, which is not zero
    client({ id: 'd', mrr: null, currency: null }),
    // a figure that arrived without a code cannot be added to any column
    client({ id: 'e', mrr: 999, currency: null }),
  ];
  assert.deepEqual(sumMrrByCurrency(rows), [entry('INR', 150), entry('USD', 7)]);
  assert.deepEqual(sumMrrByCurrency([]), []);
});

/* ------------------------------------------------------------- renewals ---- */

test('the contract clock splits into already-expired and about-to-warn', () => {
  const rows = [
    client({ id: 'past', days_to_contract_end: -4, renewal_in_days: -34 }),
    client({ id: 'today', days_to_contract_end: 0 }),
    client({ id: 'soon', days_to_contract_end: 12, renewal_in_days: -18 }),
    client({ id: 'later', days_to_contract_end: 200, renewal_in_days: 170 }),
    client({ id: 'undated' }),
  ];
  const buckets = renewalBuckets(rows);
  // already-past contracts sort first, worst (oldest) deadline on top
  assert.deepEqual(buckets.expired.map((row) => row.id), ['past', 'today']);
  assert.deepEqual(buckets.reminding.map((row) => row.id), ['soon']);
  // an account with no contract end date can never be due, so it belongs to neither list
  assert.ok(!buckets.expired.some((row) => row.id === 'undated'));
  assert.ok(!buckets.reminding.some((row) => row.id === 'undated'));
});

test('nothing reminding is reported when the server still counts days in the window', () => {
  const buckets = renewalBuckets([client({ id: 'x', days_to_contract_end: 90, renewal_in_days: 60 })]);
  assert.deepEqual(buckets.expired, []);
  assert.deepEqual(buckets.reminding, []);
});

/* ------------------------------------------------------------------- tags -- */

test('tag counts ignore blanks and order by use, then alphabetically', () => {
  const counts = tagCounts([
    client({ id: 'a', tags: ['retainer', 'Design ', 'retainer', '  ' ] }),
    client({ id: 'b', tags: ['design'] }),
    client({ id: 'c', tags: [] }),
    client({ id: 'd', tags: null }),
  ]);
  // whitespace-only tags are not tags, and a padded tag is stored trimmed
  assert.equal(counts.length, 3);
  assert.deepEqual(counts[0], { tag: 'retainer', count: 2 });
  const once = counts.slice(1).map((item) => item.tag).sort();
  assert.deepEqual(once, ['Design', 'design']);
  assert.deepEqual(tagCounts([]), []);
});

/* ------------------------------------------------------------------ sorts -- */

test('every documented sort key has a first-click direction', () => {
  assert.deepEqual([...LEAD_SORTS], ['next_touch_at', 'score', 'estimated_value', 'created']);
  // the pipeline opens on the next thing to do, so the date is ascending by default
  assert.equal(LEAD_DEFAULT_DIR.next_touch_at, 'asc');
  assert.equal(LEAD_DEFAULT_DIR.score, 'desc');
  for (const key of LEAD_SORTS) {
    assert.ok(LEAD_DEFAULT_DIR[key], `${key} needs a documented default direction`);
  }

  assert.deepEqual([...CLIENT_SORTS], ['name', 'contract_end', 'mrr', 'created']);
  assert.equal(CLIENT_DEFAULT_DIR.name, 'asc');
  assert.equal(CLIENT_DEFAULT_DIR.contract_end, 'asc');
  assert.equal(CLIENT_DEFAULT_DIR.mrr, 'desc');
  for (const key of CLIENT_SORTS) {
    assert.ok(CLIENT_DEFAULT_DIR[key], `${key} needs a documented default direction`);
  }

  assert.deepEqual([...MEETING_SORTS], ['starts_at', 'created', 'title']);
  assert.equal(MEETING_DEFAULT_DIR.starts_at, 'asc');
  for (const key of MEETING_SORTS) {
    assert.ok(MEETING_DEFAULT_DIR[key], `${key} needs a documented default direction`);
  }
});
