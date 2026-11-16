import test from 'node:test';
import assert from 'node:assert/strict';

import { implementPrompt } from './task-prompt.ts';
import type { ProjectTask } from './types.ts';

const task = (over: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 't1',
  project_id: 'p1',
  title: 'OrderBook: Tenant resolver middleware from subdomain to brand_id',
  category: 'Core Architecture',
  notes: 'brand.<domain> and custom domains.\n\nCache the lookup for the request, never in a module-level variable.',
  priority: 'urgent',
  completed: false,
  completed_at: null,
  due_date: '2026-11-15',
  source: 'manual',
  created_at: '2026-11-10T09:00:00.000Z',
  ...over,
});

const base = {
  project: {
    name: 'OrderBook',
    description: 'Multi-tenant order book SaaS for D2C brands.',
    status: 'active' as const,
    target_date: '2026-12-26',
  },
  stats: { total: 18, done: 4, open: 14, overdue: 2 },
  today: '2026-11-16',
};

test('the prompt carries the task, the whole notes block and project context', () => {
  const prompt = implementPrompt(task(), base);

  assert.match(prompt, /Multi-tenant order book SaaS/);
  assert.match(prompt, /Progress: 4\/18 done, 14 open, 2 overdue/);
  assert.match(prompt, /Title: OrderBook: Tenant resolver middleware/);
  assert.match(prompt, /Priority: urgent/);
  assert.match(prompt, /Cache the lookup for the request, never in a module-level variable\./);
  assert.match(prompt, /HOW TO WORK/);
  assert.match(prompt, /brand new titles, not the one above/);
});

test('due dates are described in agent-useful terms', () => {
  assert.match(implementPrompt(task(), base), /OVERDUE by 1 day \(was due 2026-11-15\)/);
  assert.match(implementPrompt(task({ due_date: '2026-11-16' }), base), /due today/);
  assert.match(implementPrompt(task({ due_date: '2026-11-26' }), base), /due 2026-11-26 \(in 10 days\)/);
  assert.match(implementPrompt(task({ due_date: null }), base), /open, no due date/);
  assert.match(implementPrompt(task({ completed: true }), base), /already marked complete/);
});

test('missing notes and missing context degrade instead of emitting blanks', () => {
  const bare = implementPrompt(task({ notes: null, category: null }), {
    ...base,
    project: { ...base.project, description: null, target_date: null },
    stats: { total: 1, done: 0, open: 1, overdue: 0 },
  });

  assert.match(bare, /No notes recorded\./);
  assert.match(bare, /Category: uncategorised/);
  assert.doesNotMatch(bare, /About:/);
  assert.doesNotMatch(bare, /OTHER TASKS IN THIS CATEGORY/);
  assert.doesNotMatch(bare, /THIS IS DRIVING TOWARDS/);
});

test('siblings and the next milestone are included but excluded from scope', () => {
  const siblings = [
    task({ id: 't1' }),
    task({ id: 't2', title: 'OrderBook: Model the orders table', completed: true }),
    task({ id: 't3', title: 'OrderBook: Idempotent order create', due_date: '2026-11-17' }),
  ];
  const prompt = implementPrompt(task(), {
    ...base,
    related: siblings,
    nextMilestone: { title: 'Alpha with Northbrew', date: '2026-11-23' },
  });

  assert.match(prompt, /- \[x\] OrderBook: Model the orders table/);
  assert.match(prompt, /- \[ \] OrderBook: Idempotent order create \(due 2026-11-17\)/);
  assert.doesNotMatch(prompt, /- \[ \] OrderBook: Tenant resolver/); // the task itself is not listed as context
  assert.match(prompt, /Next milestone: Alpha with Northbrew — 2026-11-23 \(in 7d\)/);
  assert.match(prompt, /context only, do not implement them/);
});
