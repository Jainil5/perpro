'use client';

import { useEffect, useState } from 'react';
import TaskRow from '@/components/TaskRow';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { Priority, Task } from '@/lib/types';
import { useTable } from '@/lib/useTable';

type Filter = 'all' | 'open' | 'done';

const EMPTY_FORM = {
  title: '',
  notes: '',
  priority: 'medium' as Priority,
  due_date: '',
  tags: '',
};

export default function TasksPage() {
  const tasks = useTable<Task>('tasks', 'created_at');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'closed' | 'new' | Task>('closed');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') openNew();
  }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModal('new');
  }

  function openEdit(task: Task) {
    setForm({
      title: task.title,
      notes: task.notes ?? '',
      priority: task.priority,
      due_date: task.due_date ?? '',
      tags: task.tags.join(', '),
    });
    setFormError(null);
    setModal(task);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setFormError(null);
    const values = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      priority: form.priority,
      due_date: form.due_date || null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    try {
      if (modal === 'new') await tasks.insert(values);
      else if (modal !== 'closed') await tasks.update(modal.id, values);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    }
    setSaving(false);
  }

  async function toggle(task: Task) {
    await tasks.update(task.id, {
      status: task.status === 'done' ? 'open' : 'done',
      completed_at: task.status === 'done' ? null : new Date().toISOString(),
    });
  }

  async function deleteTask() {
    if (modal === 'closed' || modal === 'new') return;
    setSaving(true);
    try {
      await tasks.remove(modal.id);
      setModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'delete failed');
    }
    setSaving(false);
  }

  const visible = tasks.rows
    .filter((t) => (filter === 'all' ? true : t.status === filter))
    .filter((t) =>
      search.trim()
        ? (t.title + ' ' + (t.notes ?? '') + ' ' + t.tags.join(' ')).toLowerCase().includes(search.toLowerCase())
        : true
    )
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      const ad = a.due_date ?? '9999';
      const bd = b.due_date ?? '9999';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Tasks"
        sub={`${tasks.rows.filter((t) => t.status === 'open').length} open`}
        action={<Button onClick={openNew}>+ New task</Button>}
      />
      {tasks.error && <ErrorBanner message={tasks.error} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="min-h-[44px] flex-1"
        />
        <div className="flex rounded-lg border border-zinc-800 p-0.5">
          {(['all', 'open', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`min-h-[40px] rounded-md px-3 text-xs capitalize ${filter === f ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {tasks.loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState title="No tasks here" hint="Add one, or capture to Inbox and triage it." />
      ) : (
        <div className="space-y-2">
          {visible.map((t) => <TaskRow key={t.id} task={t} onToggle={toggle} onEdit={openEdit} />)}
        </div>
      )}

      {modal !== 'closed' && (
        <Modal title={modal === 'new' ? 'New task' : 'Edit task'} onClose={() => setModal('closed')}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Title">
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full" placeholder="What needs doing?" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} className="w-full">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Due date">
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full" />
              </Field>
            </div>
            <Field label="Tags (comma separated)">
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="w-full" placeholder="startup, fundraising" />
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full" />
            </Field>
            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-between gap-2">
              {modal !== 'new' ? (
                <Button variant="danger" onClick={deleteTask} disabled={saving}>Delete</Button>
              ) : <span />}
              <Button type="submit" disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : 'Save task'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}