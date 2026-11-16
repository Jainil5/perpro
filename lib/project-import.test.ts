import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NOTES_LENGTH,
  normalizeDate,
  parseProjectImport,
} from './project-import.ts';

// The shape from the product brief, including the trailing comma people paste by accident.
const SAMPLE = `{
  "tasks": [
    {
      "title": "OrderBook: Inspect repo architecture & multi-tenant schema",
      "category": "Core Architecture",
      "notes": "Verify monorepo structure in apps/ and packages/ and Supabase multi-tenancy.",
      "completed": true,
      "priority": "High",
      "due_date": "2026-11-01"
    },
    {
      "title": "OrderBook: Configure Supabase RLS & brand isolation policies",
      "category": "Database & Security",
      "notes": "Ensure brand_id is enforced across all tables using Row Level Security.",
      "completed": true,
      "priority": "High",
      "due_date": "2026-11-03"
    },
  ]
}`;

test('imports the documented sample, trailing comma and all', () => {
  const result = parseProjectImport(SAMPLE);
  assert.equal(result.error, null);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.rejected, []);

  const [first, second] = result.tasks;
  assert.equal(first.title, 'OrderBook: Inspect repo architecture & multi-tenant schema');
  assert.equal(first.category, 'Core Architecture');
  assert.equal(first.priority, 'high');
  assert.equal(first.completed, true);
  assert.equal(first.due_date, '2026-11-01');
  assert.match(second.notes ?? '', /brand_id/);
});

test('accepts a bare array and markdown fences with prose around them', () => {
  const bare = parseProjectImport('[{"title":"Ship the fix","priority":"urgent"}]');
  assert.equal(bare.tasks.length, 1);
  assert.equal(bare.tasks[0].priority, 'urgent');

  const fenced = parseProjectImport(
    'Here you go:\n```json\n{ "tasks": [ { "title": "Draft the one-pager" } ] }\n```\nLet me know if you want more.'
  );
  assert.equal(fenced.error, null);
  assert.equal(fenced.tasks[0].title, 'Draft the one-pager');
  assert.equal(fenced.tasks[0].priority, 'medium');
});

test('reports unreadable JSON instead of importing nothing silently', () => {
  const broken = parseProjectImport('{ "tasks": [ {"title": "a" } ');
  assert.match(broken.error ?? '', /not valid JSON/);

  const wrongShape = parseProjectImport('{"todo": {"title": "a"}}');
  assert.match(wrongShape.error ?? '', /tasks/);

  const empty = parseProjectImport('{"tasks": []}');
  assert.match(empty.error ?? '', /no tasks/i);

  assert.match(parseProjectImport('').error ?? '', /Nothing to import/);
});

test('entries without a title are rejected, the rest still import', () => {
  const result = parseProjectImport('{"tasks":[{"category":"Ops"},"nonsense",42,{"title":"Keep me"}]}');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, 'Keep me');
  assert.equal(result.rejected.length, 3);
});

test('duplicate titles inside one payload are skipped', () => {
  const result = parseProjectImport(
    '{"tasks":[{"title":"Wire up webhooks"},{"title":"  wire   up  webhooks  "},{"title":"Other task"}]}'
  );
  assert.equal(result.tasks.length, 2);
  assert.match(result.rejected[0], /duplicate/i);
});

test('priorities and completion flags are coerced from what agents actually write', () => {
  const result = parseProjectImport(
    JSON.stringify({
      tasks: [
        { title: 'a', priority: 'CRITICAL' },
        { title: 'b', priority: 'Normal' },
        { title: 'c', priority: 'p1' },
        { title: 'd', priority: 'weird' },
        { title: 'e', status: 'done' },
        { title: 'f', done: 'yes' },
        { title: 'g', completed: 'pending' },
        { title: 'h', completed: 'wat' },
      ],
    })
  );
  const priorities = result.tasks.map((t) => t.priority);
  assert.deepEqual(priorities.slice(0, 4), ['urgent', 'medium', 'urgent', 'medium']);
  const completed = result.tasks.map((t) => t.completed);
  assert.deepEqual(completed.slice(4, 7), [true, true, false]);
  assert.equal(completed[7], false);
  assert.equal(result.warnings.filter((w) => /priority/.test(w)).length, 1);
  assert.equal(result.warnings.filter((w) => /completion/.test(w)).length, 1);
});

test('dates come back as YYYY-MM-DD whatever the agent wrote', () => {
  assert.equal(normalizeDate('2026-11-01'), '2026-11-01');
  assert.equal(normalizeDate('2026-11-03T09:30:00Z'), '2026-11-03');
  assert.equal(normalizeDate('nonsense'), null);
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(1762041600000), '2025-11-02');

  const result = parseProjectImport('{"tasks":[{"title":"a","due":"2026-12-01 08:00:00"},{"title":"b","deadline":"someday"}]}');
  assert.equal(result.tasks[0].due_date, '2026-12-01');
  assert.equal(result.tasks[1].due_date, null);
  assert.match(result.warnings.join(' '), /due date/);
});

test('big notes are kept, structured notes are stringified, oversized ones trimmed', () => {
  const structured = parseProjectImport(
    JSON.stringify({ tasks: [{ title: 'a', notes: ['first bullet', 'second bullet'] }] })
  );
  assert.match(structured.tasks[0].notes ?? '', /first bullet/);

  const huge = parseProjectImport(
    JSON.stringify({ tasks: [{ title: 'b', notes: 'x'.repeat(MAX_NOTES_LENGTH + 500) }] })
  );
  assert.equal((huge.tasks[0].notes ?? '').length, MAX_NOTES_LENGTH);
  assert.match(huge.warnings.join(' '), /trimmed/);
});

test('unknown fields are ignored but mentioned', () => {
  const result = parseProjectImport('{"tasks":[{"title":"a","assignee":"dev","story_points":5}]}');
  assert.equal(result.tasks.length, 1);
  assert.match(result.warnings.join(' '), /assignee, story_points/);
});
