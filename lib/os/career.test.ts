import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedTransitions,
  APPLICATION_DEFAULT_DIR,
  APPLICATION_SORTS,
  applicationDot,
  INTERVIEW_DEFAULT_DIR,
  INTERVIEW_SORTS,
  isClosedApplication,
  salaryBand,
  salaryBandError,
} from './career.ts';

/**
 * These graphs are the board's promise that a move it offers is a move the API takes.
 * They are pinned against `docs/MYOS/PHASE2_CAREER_CRM.md` rule 3, which is the same text
 * `backend/app/services/career.py::APPLICATION_TRANSITIONS` is written from — if either side
 * changes the graph, a test here has to be changed with it, deliberately and in the open.
 */

test('the application funnel only offers legal hops', () => {
  assert.deepEqual(allowedTransitions('saved'), ['applied', 'rejected', 'withdrawn']);
  assert.deepEqual(allowedTransitions('applied'), [
    'screening',
    'interview',
    'rejected',
    'withdrawn',
  ]);
  assert.deepEqual(allowedTransitions('screening'), ['interview', 'offer', 'rejected', 'withdrawn']);
  assert.deepEqual(allowedTransitions('interview'), ['offer', 'rejected', 'withdrawn']);
  assert.deepEqual(allowedTransitions('offer'), ['hired', 'rejected', 'withdrawn']);
});

test('hired is a dead end; a closed loss can only be reopened to applied', () => {
  assert.deepEqual(allowedTransitions('hired'), []);
  assert.deepEqual(allowedTransitions('rejected'), ['applied']);
  assert.deepEqual(allowedTransitions('withdrawn'), ['applied']);
  // skipping the whole funnel from a reopened row is not offered
  assert.ok(!allowedTransitions('rejected').includes('offer'));
});

test('an unknown or missing status offers nothing rather than guessing', () => {
  assert.deepEqual(allowedTransitions('nonsense'), []);
  assert.deepEqual(allowedTransitions(null), []);
  assert.deepEqual(allowedTransitions(undefined), []);
});

test('closed is exactly the three terminal states', () => {
  for (const status of ['hired', 'rejected', 'withdrawn']) {
    assert.ok(isClosedApplication(status), `${status} should be closed`);
  }
  for (const status of ['saved', 'applied', 'screening', 'interview', 'offer']) {
    assert.ok(!isClosedApplication(status), `${status} should still be open`);
  }
});

test('the five dot states cover the funnel, and nothing maps to a fake dot', () => {
  assert.equal(applicationDot('saved'), 'open');
  assert.equal(applicationDot('applied'), 'in_progress');
  assert.equal(applicationDot('screening'), 'in_progress');
  assert.equal(applicationDot('interview'), 'in_progress');
  assert.equal(applicationDot('offer'), 'in_progress');
  assert.equal(applicationDot('hired'), 'done');
  assert.equal(applicationDot('rejected'), 'abandoned');
  assert.equal(applicationDot('withdrawn'), 'archived');
  assert.equal(applicationDot('whatever'), 'open');
});

/* ------------------------------------------------------------------ salary -- */

const usd = (value: number) => `$${value.toLocaleString('en-US')}`;

test('a salary band is one line, whatever ends it has', () => {
  assert.equal(salaryBand(100000, 140000, usd), '$100,000 – $140,000');
  // a band with both ends equal is one number, not a range of nothing
  assert.equal(salaryBand(120000, 120000, usd), '$120,000');
  assert.equal(salaryBand(120000, null, usd), 'from $120,000');
  assert.equal(salaryBand(null, 150000, usd), 'up to $150,000');
  assert.equal(salaryBand(null, null, usd), null);
  // a non-finite figure is a missing answer, not a zero
  assert.equal(salaryBand(Number.NaN, 150000, usd), 'up to $150,000');
});

test('a backwards or negative band is refused before the API says 422', () => {
  assert.equal(salaryBandError(140000, 100000), 'The top of the band is below the bottom of it');
  assert.equal(salaryBandError(-1, null), 'A salary band cannot start below zero');
  assert.equal(salaryBandError(null, -5), 'A salary band cannot end below zero');
  assert.equal(salaryBandError(100000, 100000), null);
  assert.equal(salaryBandError(null, null), null);
  // zero on either end is a real number, not a missing one
  assert.equal(salaryBandError(0, 0), null);
});

/* ------------------------------------------------------------------- sorts -- */

test('the sort keys are the ones the API accepts, each with a useful first direction', () => {
  assert.deepEqual([...APPLICATION_SORTS], [
    'next_action_date',
    'applied_at',
    'status',
    'salary',
    'created',
  ]);
  // a pipeline opens on the thing you can act on, so the first click is ascending by date
  assert.equal(APPLICATION_DEFAULT_DIR.next_action_date, 'asc');
  assert.equal(APPLICATION_DEFAULT_DIR.status, 'asc');
  assert.equal(APPLICATION_DEFAULT_DIR.salary, 'desc');
  assert.equal(APPLICATION_DEFAULT_DIR.applied_at, 'desc');
  assert.equal(APPLICATION_DEFAULT_DIR.created, 'desc');
  for (const key of APPLICATION_SORTS) {
    assert.ok(APPLICATION_DEFAULT_DIR[key], `${key} needs a documented default direction`);
  }

  assert.deepEqual([...INTERVIEW_SORTS], ['scheduled_at', 'created']);
  assert.equal(INTERVIEW_DEFAULT_DIR.scheduled_at, 'desc');
  for (const key of INTERVIEW_SORTS) {
    assert.ok(INTERVIEW_DEFAULT_DIR[key], `${key} needs a documented default direction`);
  }
});
