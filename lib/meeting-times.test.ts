import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_CHIPS,
  DURATION_PRESETS,
  dayHeading,
  dayOffsetFromToday,
  defaultSlot,
  durationMinutes,
  editEnd,
  editStart,
  isEndBeforeStart,
  nextCleanSlot,
  pickDuration,
  shiftDay,
  slotSummary,
  type SlotState,
} from './meeting-times.ts';

/** Local wall-clock date — the same clock datetime-local inputs show. */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0): Date => new Date(y, mo, d, h, mi, s, 0);
const slot = (over: Partial<SlotState> = {}): SlotState => ({
  starts_at: '2026-11-27T15:00',
  ends_at: '2026-11-27T16:00',
  follow: true,
  ...over,
});

test('a new meeting opens on the next clean slot today, never two minutes away', () => {
  // mid-hour rounds up to the :30 grid, then to the top of the next hour
  assert.deepEqual(defaultSlot(at(2026, 10, 27, 14, 7)), {
    starts_at: '2026-11-27T15:00',
    ends_at: '2026-11-27T16:00',
  });
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 31)).getTime(), at(2026, 10, 27, 15, 0).getTime());
  // past the half-hour the next :00 is already in a new hour, so it stands
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 38)).getTime(), at(2026, 10, 27, 15, 0).getTime());
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 59, 20)).getTime(), at(2026, 10, 27, 15, 0).getTime());
});

test('exact boundaries and the end of the day are handled without going backwards', () => {
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 0, 0)).getTime(), at(2026, 10, 27, 15, 0).getTime());
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 30, 0)).getTime(), at(2026, 10, 27, 15, 0).getTime());
  // 14:29:59 rounds to 14:30, which is still inside the hour → 15:00
  assert.equal(nextCleanSlot(at(2026, 10, 27, 14, 29, 59)).getTime(), at(2026, 10, 27, 15, 0).getTime());
  assert.equal(nextCleanSlot(at(2026, 10, 27, 23, 10)).getTime(), at(2026, 10, 28, 0, 0).getTime());
  assert.equal(nextCleanSlot(at(2026, 10, 27, 23, 47)).getTime(), at(2026, 10, 28, 0, 0).getTime());
});

test('changing the start moves the end with it and keeps the duration', () => {
  const ninety = slot({ ends_at: '2026-11-27T16:30' });
  const next = editStart(ninety, '2026-11-27T18:00');
  assert.equal(next.starts_at, '2026-11-27T18:00');
  assert.equal(next.ends_at, '2026-11-27T19:30');
  assert.equal(durationMinutes(next.starts_at, next.ends_at), 90);

  // a broken pair falls back to the default hour rather than an empty/negative end
  assert.equal(editStart(slot({ ends_at: '2026-11-27T14:00' }), '2026-11-27T18:00').ends_at, '2026-11-27T19:00');
  // an intentionally cleared end stays cleared
  assert.equal(editStart(slot({ ends_at: '' }), '2026-11-27T18:00').ends_at, '');
});

test('a hand-edited end stops the follow until a duration pick resumes it', () => {
  const manual = editEnd(slot(), '2026-11-27T17:15');
  assert.equal(manual.follow, false);
  // start edits no longer fight the explicit end
  assert.equal(editStart(manual, '2026-11-27T16:00').ends_at, '2026-11-27T17:15');
  // picking a duration takes the wheel again
  const repicked = pickDuration(editStart(manual, '2026-11-27T16:00'), 90);
  assert.equal(repicked.ends_at, '2026-11-27T17:30');
  assert.equal(repicked.follow, true);
});

test('every duration quick-pick lands where its label says', () => {
  assert.deepEqual(
    DURATION_PRESETS.map(({ label, minutes }) => [label, pickDuration(slot(), minutes).ends_at]),
    [
      ['30m', '2026-11-27T15:30'],
      ['45m', '2026-11-27T15:45'],
      ['1h', '2026-11-27T16:00'],
      ['90m', '2026-11-27T16:30'],
      ['2h', '2026-11-27T17:00'],
    ]
  );
  // no usable start → the pick does nothing rather than blanking the end
  assert.deepEqual(pickDuration(slot({ starts_at: '' }), 60), slot({ starts_at: '' }));
});

test('day chips move both fields and keep the clock time, across month ends', () => {
  const now = at(2026, 10, 27, 9, 15); // 2026-11-27, Friday
  assert.deepEqual(
    shiftDay(slot({ starts_at: '2026-11-27T15:00', ends_at: '2026-11-27T16:00' }), 7, now),
    { starts_at: '2026-12-04T15:00', ends_at: '2026-12-04T16:00', follow: true }
  );
  // January → February
  const jan = slot({ starts_at: '2026-01-31T09:00', ends_at: '2026-01-31T10:00' });
  assert.equal(shiftDay(jan, 1, at(2026, 0, 31, 8, 0)).starts_at, '2026-02-01T09:00');
  assert.equal(shiftDay(jan, 1, at(2026, 0, 31, 8, 0)).ends_at, '2026-02-01T10:00');
  // 2026 is not a leap year, so tomorrow from 28 February is 1 March
  const leap = slot({ starts_at: '2026-02-28T23:00', ends_at: '2026-03-01T00:00' });
  const march = shiftDay(leap, 1, at(2026, 1, 28, 10, 0));
  assert.equal(march.starts_at, '2026-03-01T23:00');
  assert.equal(march.ends_at, '2026-03-02T00:00');
  // an cleared end is not invented by a day shift
  assert.equal(shiftDay(slot({ starts_at: '2026-11-27T23:00', ends_at: '' }), 1, at(2026, 10, 27, 10, 0)).ends_at, '');
  // a past meeting comes back to today, times intact
  const past = slot({ starts_at: '2026-11-20T14:00', ends_at: '2026-11-20T15:00' });
  assert.deepEqual(shiftDay(past, 0, now), {
    starts_at: '2026-11-27T14:00',
    ends_at: '2026-11-27T15:00',
    follow: true,
  });
  // already on the target day → untouched
  assert.deepEqual(shiftDay(slot(), 0, now), slot());
  assert.deepEqual(DAY_CHIPS.map((c) => c.label), ['Today', 'Tomorrow', 'Next week']);
});

test('end before start is detected, including a zero-length meeting', () => {
  assert.equal(isEndBeforeStart('2026-11-27T15:00', '2026-11-27T14:00'), true);
  assert.equal(isEndBeforeStart('2026-11-27T15:00', '2026-11-27T15:00'), true);
  assert.equal(isEndBeforeStart('2026-11-27T15:00', '2026-11-26T16:00'), true);
  assert.equal(isEndBeforeStart('2026-11-27T15:00', '2026-11-27T16:00'), false);
  // nothing to complain about while a field is empty or half-typed
  assert.equal(isEndBeforeStart('2026-11-27T15:00', ''), false);
  assert.equal(isEndBeforeStart('', '2026-11-27T16:00'), false);
  assert.equal(isEndBeforeStart('2026-11-27T1', '2026-11-27T16:00'), false);
});

test('the summary line reads as one mono fact', () => {
  assert.equal(slotSummary('2026-11-27T15:00', '2026-11-27T16:00'), '2026-11-27 15:00 → 16:00 · 60 min');
  assert.equal(slotSummary('2026-11-27T23:30', '2026-11-28T00:30'), '2026-11-27 23:30 → 2026-11-28 00:30 · 60 min');
  assert.equal(slotSummary('2026-11-27T15:00', '2026-11-27T14:00'), '2026-11-27 15:00 → 14:00 · ends before it starts');
  assert.equal(slotSummary('2026-11-27T15:00', ''), '2026-11-27 15:00 → open end');
  assert.equal(slotSummary('', ''), 'Pick a start time');
});

test('day offsets are measured from today, so chips know when they are active', () => {
  const now = at(2026, 10, 27, 23, 59);
  assert.equal(dayOffsetFromToday('2026-11-27T08:00', now), 0);
  assert.equal(dayOffsetFromToday('2026-11-28T08:00', now), 1);
  assert.equal(dayOffsetFromToday('2026-11-20T08:00', now), -7);
  assert.equal(dayOffsetFromToday('', now), null);
});

test('list headings say Today / Tomorrow / weekday, then dates, then months for history', () => {
  const now = at(2026, 10, 27, 9, 0); // Friday 2026-11-27
  assert.equal(dayHeading(at(2026, 10, 27, 0, 5), now), 'Today');
  assert.equal(dayHeading(at(2026, 10, 27, 23, 55), now), 'Today');
  assert.equal(dayHeading(at(2026, 10, 28, 18, 0), now), 'Tomorrow');
  assert.equal(dayHeading(at(2026, 10, 26, 7, 0), now), 'Yesterday');
  // within the next week the weekday is the useful fact
  assert.equal(dayHeading(at(2026, 10, 29, 11, 0), now), 'Sunday');
  assert.equal(dayHeading(at(2026, 10, 30, 11, 0), now), 'Monday');
  // further out, and across a year, the date is
  assert.equal(dayHeading(at(2026, 11, 4, 11, 0), now), '4 Dec');
  assert.equal(dayHeading(at(2026, 11, 31, 11, 0), now), '31 Dec');
  assert.equal(dayHeading(at(2027, 0, 15, 11, 0), now), '15 Jan 2027');
  // anything older than yesterday groups by month so Past stays scannable
  assert.equal(dayHeading(at(2026, 10, 25, 22, 0), now), 'Nov 2026');
  assert.equal(dayHeading(at(2026, 9, 31, 9, 0), now), 'Oct 2026');
});
