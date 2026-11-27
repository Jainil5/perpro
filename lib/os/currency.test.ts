import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMonths,
  compactNumber,
  currencyGlyph,
  formatMoney,
  formatRate,
  minorUnits,
  moneyDelta,
  moneyInputError,
  monthBounds,
  monthDistance,
  monthKey,
  monthLabel,
  monthRange,
  monthShort,
  parseMoney,
  runwayLabel,
  shareOf,
} from './currency.ts';

test('currencies without a minor unit never show cents', () => {
  assert.equal(minorUnits('JPY'), 0);
  assert.equal(minorUnits('krw'), 0);
  assert.equal(minorUnits('VND'), 0);
  assert.equal(minorUnits('INR'), 2);
  assert.equal(minorUnits(null), 2);
  assert.equal(formatMoney(12345, 'JPY'), '¥12,345');
  assert.equal(formatMoney(12345, 'USD'), '$12,345.00');
  assert.equal(formatMoney(12345.678, 'INR'), '₹12,345.68');
});

test('Indian codes are grouped the way they are written', () => {
  assert.equal(formatMoney(100000, 'INR'), '₹1,00,000.00');
  assert.equal(formatMoney(100000, 'USD'), '$100,000.00');
  assert.equal(currencyGlyph('INR'), '₹');
  // an unknown code is not an error: the code is its own symbol
  assert.equal(currencyGlyph('zz'), 'ZZ');
  assert.equal(formatMoney(500, 'zz'), 'ZZ500.00');
});

test('a missing figure is a dash, never zero', () => {
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney(undefined, 'USD'), '—');
  assert.equal(formatMoney(Number.NaN, 'USD'), '—');
  assert.equal(formatMoney(0, 'USD'), '$0.00');
});

test('signs are explicit where a column needs them aligned', () => {
  assert.equal(formatMoney(-4200, 'INR'), '−₹4,200.00');
  assert.equal(formatMoney(4200, 'INR', { sign: 'always' }), '+₹4,200.00');
  assert.equal(formatMoney(0, 'INR', { sign: 'always' }), '₹0.00');
  assert.equal(formatMoney(-4200, 'INR', { sign: 'never' }), '₹4,200.00');
  assert.equal(formatMoney(1200, 'EUR', { glyphAfter: true }), '1,200.00 €');
});

test('compact figures stay readable in a narrow column', () => {
  assert.equal(compactNumber(124000000, 2, true), '12.4 Cr');
  assert.equal(compactNumber(1240000, 2, true), '12.4 L');
  assert.equal(compactNumber(12400, 2, true), '12.4 k');
  assert.equal(compactNumber(900, 2, true), '900');
  assert.equal(compactNumber(1_200_000, 2, false), '1.2M');
  assert.equal(compactNumber(1_200, 2, false), '1.2k');
  assert.equal(formatMoney(1240000, 'INR', { compact: true }), '₹12.4 L');
  assert.equal(formatMoney(1240000, 'USD', { compact: true }), '$1.24M');
});

test('rates keep the six decimals the column allows, minus trailing zeros', () => {
  assert.equal(formatRate(83.215), '83.215');
  assert.equal(formatRate(1), '1.0');
  assert.equal(formatRate(0.0012), '0.0012');
  assert.equal(formatRate(null), '—');
});

test('shares and deltas refuse to invent a percentage', () => {
  assert.equal(shareOf(25, 100), 25);
  assert.equal(shareOf(25, 0), null);
  assert.equal(shareOf(null, 100), null);
  assert.deepEqual(moneyDelta(110, 100), { direction: 'up', abs: 10, pct: 10 });
  assert.equal(moneyDelta(90, 100).direction, 'down');
  assert.equal(moneyDelta(100, 100).direction, 'flat');
  // a month from nothing to something is new, not +infinity
  assert.deepEqual(moneyDelta(500, 0), { direction: 'up', abs: 500, pct: null });
  assert.equal(moneyDelta(null, 10).direction, 'unknown');
});

test('month keys are string maths, so no timezone can move them', () => {
  assert.equal(monthKey('2026-11-14'), '2026-11');
  assert.equal(monthKey('2026-11-14T23:59:59Z'), '2026-11');
  assert.equal(monthKey(null), null);
  assert.equal(monthKey('not a date'), null);
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(addMonths('2026-11', 0), '2026-11');
  assert.equal(monthDistance('2027-01', '2026-11'), 2);
  assert.equal(monthDistance('2026-11', '2027-01'), -2);
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthRange('2027-03', '2026-11'), []);
  assert.equal(monthLabel('2026-11'), 'Nov 2026');
  assert.equal(monthLabel('2026-11', { long: true }), 'November 2026');
  assert.equal(monthShort('2026-11'), 'Nov');
});

test('month bounds know about leap years, including the century rule', () => {
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthBounds('2032-02'), { from: '2032-02-01', to: '2032-02-29' });
  assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(monthBounds('2026-01'), { from: '2026-01-01', to: '2026-01-31' });
});

test('money input validation rejects what the API would reject', () => {
  assert.equal(parseMoney('1,23,456.75'), 123456.75);
  assert.equal(parseMoney(' 12.5 '), 12.5);
  assert.equal(parseMoney('-3'), -3);
  assert.equal(parseMoney('₹100'), null);
  assert.equal(parseMoney('12.3.4'), null);
  assert.equal(moneyInputError('', { required: true }), 'Enter an amount');
  assert.equal(moneyInputError(''), null);
  assert.equal(moneyInputError('1,000'), null);
  assert.equal(moneyInputError('10.505'), 'Money is stored to 2 decimal places');
  assert.equal(moneyInputError('abc'), 'Numbers only — no currency symbol or commas');
  assert.equal(moneyInputError('-5', { min: 0 }), 'Must be 0 or more');
  assert.equal(moneyInputError('500', { max: 100 }), 'Must be 100 or less');
});

test('runway says what a null really means', () => {
  assert.equal(runwayLabel(null), 'no spend to run against');
  assert.equal(runwayLabel(0), 'out of runway');
  assert.equal(runwayLabel(7.4), '7.4 months');
  assert.equal(runwayLabel(18), '1.5 yrs');
  // a zero burn is "no spend"; an unnamed currency and an unnamed cash are not
  assert.equal(
    runwayLabel(null, { named: true, burn: 0, cash: 400000 }),
    'no spend to run against'
  );
  assert.equal(
    runwayLabel(null, { named: false, burn: 96970, cash: null }),
    'name a currency to measure'
  );
  assert.equal(
    runwayLabel(null, { named: true, burn: 96970, cash: null }),
    'no cash figure'
  );
  // a figure that exists is never replaced by an explanation
  assert.equal(
    runwayLabel(4.2, { named: false, burn: 0, cash: null }),
    '4.2 months'
  );
});
