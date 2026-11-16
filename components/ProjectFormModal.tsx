'use client';

import { useState } from 'react';
import { Button, ErrorBanner, Field, Modal } from './ui';
import { Project, ProjectStatus } from '@/lib/types';

export const PROJECT_COLORS = [
  '#6366F1',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#A855F7',
  '#06B6D4',
  '#EC4899',
  '#94A3B8',
];

const STATUSES: ProjectStatus[] = ['active', 'paused', 'done', 'archived'];

export default function ProjectFormModal({
  project,
  onClose,
  onSaved,
  onDeleted,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const [form, setForm] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    color: project?.color ?? PROJECT_COLORS[0],
    start_date: project?.start_date ?? '',
    target_date: project?.target_date ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    const values = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      color: form.color,
      start_date: form.start_date || null,
      target_date: form.target_date || null,
      updated_at: new Date().toISOString(),
    };
    try {
      const res = await fetch(project ? `/api/db/projects?id=${encodeURIComponent(project.id)}` : '/api/db/projects', {
        method: project ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'save failed');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    }
    setSaving(false);
  }

  async function remove() {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'delete failed');
      onDeleted?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    }
    setSaving(false);
    setConfirmDelete(false);
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Name">
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full"
            placeholder="OrderBook"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full"
            placeholder="What this project is and what done looks like."
          />
        </Field>

        <Field label="Status">
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setForm({ ...form, status })}
                className={`min-h-[38px] rounded-lg border px-3 text-xs capitalize transition ${
                  form.status === status
                    ? 'border-[var(--accent-brand)] bg-[var(--accent-brand)]/15 text-[var(--accent-brand-hover)]'
                    : 'border-[var(--fg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                onClick={() => setForm({ ...form, color })}
                style={{ background: color }}
                className={`h-9 w-9 rounded-lg border-2 transition ${
                  form.color === color ? 'border-[var(--fg-primary)] scale-110' : 'border-transparent'
                }`}
              />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full" />
          </Field>
          <Field label="Target">
            <input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} className="w-full" />
          </Field>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex items-center justify-between gap-2 pt-1">
          {project && onDeleted ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-body-sm text-[var(--accent-critical)]">Delete project, tasks and milestones?</span>
                <Button variant="danger" onClick={remove} loading={saving}>
                  Yes, delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete project
              </Button>
            )
          ) : (
            <span />
          )}
          <Button type="submit" disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : project ? 'Save' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
