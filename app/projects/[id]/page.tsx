'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ImportTasksModal from '@/components/ImportTasksModal';
import { copyText } from '@/lib/clipboard';
import ProjectFormModal from '@/components/ProjectFormModal';
import ProjectTaskRow from '@/components/ProjectTaskRow';
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { implementPrompt } from '@/lib/task-prompt';
import { Priority, Project, ProjectMilestone, ProjectTask } from '@/lib/types';
import { todayISO, useTable } from '@/lib/useTable';
import {
  categoryNames,
  daysUntil,
  groupByCategory,
  projectStats,
  sortTasks,
  TaskSort,
} from '@/lib/projects';

type Filter = 'all' | 'open' | 'done';
type TaskModal = 'closed' | 'new' | ProjectTask;
type MilestoneModal = 'closed' | 'new' | ProjectMilestone;

const EMPTY_TASK = {
  title: '',
  category: '',
  notes: '',
  priority: 'medium' as Priority,
  due_date: '',
  completed: false,
};

const EMPTY_MILESTONE = { title: '', date: '', notes: '', completed: false };

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--fg-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-[var(--fg-subtle)]">{label}</p>
      <p className={`mt-0.5 text-h3 ${tone ?? 'text-[var(--fg-primary)]'}`}>{value}</p>
      {hint && <p className="truncate text-[11px] text-[var(--fg-muted)]">{hint}</p>}
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const projects = useTable<Project>('projects', 'created_at');
  const allTasks = useTable<ProjectTask>('project_tasks', 'created_at', true);
  const allMilestones = useTable<ProjectMilestone>('project_milestones', 'date', true);

  const [taskModal, setTaskModal] = useState<TaskModal>('closed');
  const [milestoneModal, setMilestoneModal] = useState<MilestoneModal>('closed');
  const [importOpen, setImportOpen] = useState(false);
  const [projectEdit, setProjectEdit] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<TaskSort>('due');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY_TASK);
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptFallback, setPromptFallback] = useState<string | null>(null);

  const today = todayISO();
  const project = projects.rows.find((p) => p.id === projectId);
  const tasks = useMemo(
    () => allTasks.rows.filter((t) => t.project_id === projectId),
    [allTasks.rows, projectId]
  );
  const milestones = useMemo(
    () => allMilestones.rows.filter((m) => m.project_id === projectId),
    [allMilestones.rows, projectId]
  );

  const stats = projectStats(tasks, today);
  const categories = categoryNames(tasks);
  const nextMilestone = milestones.find((m) => !m.completed && m.date !== null);

  /** Everything an agent needs to implement one task without being re-briefed. */
  function promptFor(task: ProjectTask): string {
    if (!project) return '';
    return implementPrompt(task, {
      project,
      stats,
      related: tasks.filter((t) => (t.category ?? '') === (task.category ?? '')),
      nextMilestone: nextMilestone ? { title: nextMilestone.title, date: nextMilestone.date } : null,
      today,
    });
  }

  async function copyPrompt(task: ProjectTask): Promise<boolean> {
    const text = promptFor(task);
    if (await copyText(text)) {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1800);
      return true;
    }
    // Clipboard can be blocked by the browser; hand them the text to copy manually.
    setPromptFallback(text);
    return false;
  }

  const visible = sortTasks(
    tasks
      .filter((t) => (filter === 'all' ? true : filter === 'done' ? t.completed : !t.completed))
      .filter((t) => (category === 'all' ? true : (t.category ?? 'Uncategorised') === category))
      .filter((t) =>
        search.trim()
          ? `${t.title} ${t.category ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(search.toLowerCase())
          : true
      ),
    sort
  );

  function openNewTask() {
    setForm(EMPTY_TASK);
    setFormError(null);
    setPromptCopied(false);
    setTaskModal('new');
  }

  function openEditTask(task: ProjectTask) {
    setForm({
      title: task.title,
      category: task.category ?? '',
      notes: task.notes ?? '',
      priority: task.priority,
      due_date: task.due_date ?? '',
      completed: task.completed,
    });
    setFormError(null);
    setPromptCopied(false);
    setTaskModal(task);
  }

  async function saveTask(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setFormError(null);
    const editing = taskModal !== 'new' && taskModal !== 'closed' ? taskModal : null;
    const values = {
      title: form.title.trim(),
      category: form.category.trim() || null,
      notes: form.notes.trim() || null,
      priority: form.priority,
      due_date: form.due_date || null,
      completed: form.completed,
      completed_at: form.completed ? editing?.completed_at ?? new Date().toISOString() : null,
    };
    try {
      const url = editing ? `/api/db/project_tasks?id=${encodeURIComponent(editing.id)}` : '/api/db/project_tasks';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? values : { ...values, project_id: projectId, source: 'manual' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'save failed');
      setTaskModal('closed');
      await allTasks.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    }
    setSaving(false);
  }

  async function toggleTask(task: ProjectTask) {
    await allTasks.update(task.id, {
      completed: !task.completed,
      completed_at: task.completed ? null : new Date().toISOString(),
    });
  }

  async function deleteTask() {
    if (taskModal === 'closed' || taskModal === 'new') return;
    setSaving(true);
    try {
      await allTasks.remove(taskModal.id);
      setTaskModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'delete failed');
    }
    setSaving(false);
  }

  function openNewMilestone() {
    setMilestoneForm(EMPTY_MILESTONE);
    setFormError(null);
    setMilestoneModal('new');
  }

  function openEditMilestone(milestone: ProjectMilestone) {
    setMilestoneForm({
      title: milestone.title,
      date: milestone.date ?? '',
      notes: milestone.notes ?? '',
      completed: milestone.completed,
    });
    setFormError(null);
    setMilestoneModal(milestone);
  }

  async function saveMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!milestoneForm.title.trim()) return;
    setSaving(true);
    setFormError(null);
    const editingMilestone = milestoneModal !== 'new' && milestoneModal !== 'closed' ? milestoneModal : null;
    const values = {
      title: milestoneForm.title.trim(),
      date: milestoneForm.date || null,
      notes: milestoneForm.notes.trim() || null,
      completed: milestoneForm.completed,
      completed_at: milestoneForm.completed ? new Date().toISOString() : null,
    };
    try {
      const url = editingMilestone ? `/api/db/project_milestones?id=${encodeURIComponent(editingMilestone.id)}` : '/api/db/project_milestones';
      const res = await fetch(url, {
        method: editingMilestone ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingMilestone ? values : { ...values, project_id: projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'save failed');
      setMilestoneModal('closed');
      await allMilestones.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    }
    setSaving(false);
  }

  async function toggleMilestone(milestone: ProjectMilestone) {
    await allMilestones.update(milestone.id, {
      completed: !milestone.completed,
      completed_at: milestone.completed ? null : new Date().toISOString(),
    });
  }

  async function deleteMilestone() {
    if (milestoneModal === 'closed' || milestoneModal === 'new') return;
    setSaving(true);
    try {
      await allMilestones.remove(milestoneModal.id);
      setMilestoneModal('closed');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'delete failed');
    }
    setSaving(false);
  }

  if (projects.loading || allTasks.loading) return <Spinner label="Loading project…" />;

  const error = projects.error ?? allTasks.error ?? allMilestones.error;

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Project not found" />
        {error && <ErrorBanner message={error} />}
        <EmptyState title="No project with that id" hint="It may have been deleted." />
        <div className="mt-4">
          <Link href="/projects" className="text-sm text-[var(--accent-brand-hover)] underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="mx-auto max-w-6xl">
      <Link href="/projects" className="text-body-sm text-[var(--fg-muted)] hover:text-[var(--fg-primary)]">
        ← Projects
      </Link>

      <div className="mt-1">
        <PageHeader
          title={project.name}
          sub={project.description ?? undefined}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                Import JSON
              </Button>
              <Button onClick={openNewTask}>+ Add task</Button>
            </div>
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${project.status === 'active' ? 'bg-[var(--accent-success)]/15 text-[var(--accent-success)]' : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)]'}`}>
          {project.status}
        </span>
        {project.target_date && (
          <span className="text-body-sm text-[var(--fg-muted)]">
            target {project.target_date} · {daysUntil(project.target_date, today) >= 0 ? `${daysUntil(project.target_date, today)}d left` : 'past target'}
          </span>
        )}
        <button onClick={() => setProjectEdit(true)} className="text-body-sm text-[var(--fg-muted)] underline hover:text-[var(--fg-primary)]">
          Edit project
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Progress" value={`${stats.pct}%`} />
        <Stat label="Open" value={`${stats.open}`} tone={stats.open ? 'text-[var(--fg-primary)]' : 'text-[var(--accent-success)]'} />
        <Stat label="Overdue" value={`${stats.overdue}`} tone={stats.overdue ? 'text-[var(--accent-critical)]' : 'text-[var(--fg-muted)]'} />
        <Stat
          label="Next milestone"
          value={
            nextMilestone?.date
              ? `${Math.max(daysUntil(nextMilestone.date, today), 0)}d`
              : '—'
          }
          hint={nextMilestone?.title}
          tone={nextMilestone?.date && daysUntil(nextMilestone.date, today) < 0 ? 'text-[var(--accent-critical)]' : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">{error && <ErrorBanner message={error} />}</AnimatePresence>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <motion.input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              whileFocus={{ scale: 1.01 }}
              className="min-h-[44px] flex-1"
            />
            <div className="flex rounded-lg border border-[var(--fg-subtle)] p-0.5">
              {(['open', 'all', 'done'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`min-h-[40px] rounded-md px-3 text-xs capitalize ${
                    filter === f ? 'bg-[var(--accent-brand)] text-white' : 'text-[var(--fg-muted)] hover:text-[var(--fg-primary)]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-[44px] text-xs">
              <option value="all">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as TaskSort)} className="min-h-[44px] text-xs">
              <option value="due">By due date</option>
              <option value="priority">By priority</option>
              <option value="category">Group by category</option>
              <option value="added">Recently added</option>
            </select>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={tasks.length ? 'Nothing matches these filters' : 'No tasks yet'}
              hint={tasks.length ? 'Clear the filter or search.' : 'Add one, or paste a JSON list from an agent.'}
            />
          ) : sort === 'category' ? (
            <div className="space-y-5">
              {groupByCategory(visible).map(([name, group]) => (
                <div key={name}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-subheading uppercase tracking-wide text-[var(--fg-muted)]">{name}</h2>
                    <span className="text-[11px] text-[var(--fg-subtle)]">{group.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.map((task) => (
                      <ProjectTaskRow key={task.id} task={task} onToggle={toggleTask} onEdit={openEditTask} onCopyPrompt={copyPrompt} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {visible.map((task) => (
                  <ProjectTaskRow key={task.id} task={task} onToggle={toggleTask} onEdit={openEditTask} onCopyPrompt={copyPrompt} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-subheading uppercase tracking-wide text-[var(--fg-muted)]">Schedule</h2>
              <button onClick={openNewMilestone} className="text-xs text-[var(--accent-brand-hover)] hover:underline">
                + Milestone
              </button>
            </div>

            {milestones.length === 0 ? (
              <p className="text-body-sm text-[var(--fg-muted)]">
                No milestones yet. Add the dates this project is judged against.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-[var(--fg-subtle)] pl-4">
                {milestones.map((milestone) => {
                  const days = milestone.date ? daysUntil(milestone.date, today) : null;
                  const late = !milestone.completed && days !== null && days < 0;
                  return (
                    <li key={milestone.id} className="relative">
                      <span
                        className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full"
                        style={{ background: milestone.completed ? 'var(--accent-success)' : late ? 'var(--accent-critical)' : project.color }}
                      />
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleMilestone(milestone)}
                          aria-label={milestone.completed ? 'Mark milestone open' : 'Mark milestone done'}
                          className={`mt-0.5 text-sm ${milestone.completed ? 'text-[var(--accent-success)]' : 'text-[var(--fg-subtle)] hover:text-[var(--accent-brand)]'}`}
                        >
                          {milestone.completed ? '✓' : '○'}
                        </button>
                        <button onClick={() => openEditMilestone(milestone)} className="min-w-0 flex-1 text-left">
                          <span className={`block text-body-sm ${milestone.completed ? 'line-through text-[var(--fg-muted)]' : 'text-[var(--fg-primary)]'}`}>
                            {milestone.title}
                          </span>
                          <span className={`text-[11px] ${late ? 'text-[var(--accent-critical)]' : 'text-[var(--fg-subtle)]'}`}>
                            {milestone.date ?? 'no date'}
                            {days !== null && !milestone.completed && ` · ${days < 0 ? `${-days}d late` : days === 0 ? 'today' : `in ${days}d`}`}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4">
            <h2 className="mb-2 text-subheading uppercase tracking-wide text-[var(--fg-muted)]">By category</h2>
            {categories.length === 0 ? (
              <p className="text-body-sm text-[var(--fg-muted)]">Nothing categorised yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {categories.map((name) => {
                  const group = tasks.filter((t) => (t.category ?? 'Uncategorised') === name);
                  const done = group.filter((t) => t.completed).length;
                  const pct = group.length ? Math.round((done / group.length) * 100) : 0;
                  return (
                    <li key={name}>
                      <button onClick={() => setCategory(name)} className="w-full text-left">
                        <div className="flex items-center justify-between text-body-sm">
                          <span className="text-[var(--fg-primary)]">{name}</span>
                          <span className="text-[var(--fg-muted)]">
                            {done}/{group.length}
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="h-full rounded-full"
                            style={{ background: project.color }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-[var(--fg-subtle)] p-4">
            <p className="text-body-sm text-[var(--fg-muted)]">
              <span className="text-[var(--fg-primary)]">Prompt</span> on any task row copies a full brief — project
              context, the task, its whole notes block, sibling tasks and the milestone it serves — ready to paste into
              an agent. Ask for follow-ups back as JSON and use{" "}
              <span className="text-[var(--fg-primary)]">Import JSON</span> to file them; new ids are generated and
              duplicates are skipped.
            </p>
          </div>
        </aside>
      </div>

      {importOpen && (
        <ImportTasksModal
          projectId={projectId}
          projectName={project.name}
          onClose={() => setImportOpen(false)}
          onImported={() => allTasks.reload()}
        />
      )}

      {projectEdit && (
        <ProjectFormModal
          project={project}
          onClose={() => setProjectEdit(false)}
          onSaved={() => projects.reload()}
          onDeleted={() => router.push('/projects')}
        />
      )}

      {taskModal !== 'closed' && (
        <Modal title={taskModal === 'new' ? 'Add task' : 'Edit task'} onClose={() => setTaskModal('closed')} size="wide">
          <form onSubmit={saveTask} className="space-y-4">
            <Field label="Title">
              <input
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full"
                placeholder={`${project.name}: what needs doing?`}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Category">
                <input
                  list="project-categories"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full"
                  placeholder="Payments"
                />
                <datalist id="project-categories">
                  {categories.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
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

            <Field label="Notes — as long as they need to be">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={10}
                className="w-full leading-relaxed"
                placeholder="Decisions, constraints, acceptance criteria, links. Markdown works."
              />
            </Field>

            <label className="flex items-center gap-2 text-body-sm text-[var(--fg-muted)]">
              <input type="checkbox" checked={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.checked })} className="h-4 w-4" />
              Already finished
            </label>

            {formError && <ErrorBanner message={formError} />}

            <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--fg-subtle)] pt-4">
              {taskModal !== 'new' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => copyPrompt(taskModal)}
                  >
                    {promptCopied ? 'Copied brief' : 'Copy implement prompt'}
                  </Button>
                  <Button variant="danger" onClick={deleteTask} disabled={saving}>
                    Delete
                  </Button>
                </div>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving || !form.title.trim()}>
                {saving ? 'Saving…' : taskModal === 'new' ? 'Add task' : 'Save task'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {promptFallback !== null && (
        <Modal title="Copy the brief" onClose={() => setPromptFallback(null)} size="wide">
          <p className="mb-2 text-body-sm text-[var(--fg-muted)]">
            Clipboard access was refused, so here it is to copy by hand — everything is already selected.
          </p>
          <textarea
            readOnly
            value={promptFallback}
            rows={18}
            onFocus={(e) => e.target.select()}
            className="w-full font-mono text-xs leading-relaxed"
          />
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => setPromptFallback(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {milestoneModal !== 'closed' && (
        <Modal title={milestoneModal === 'new' ? 'Add milestone' : 'Edit milestone'} onClose={() => setMilestoneModal('closed')}>
          <form onSubmit={saveMilestone} className="space-y-4">
            <Field label="Milestone">
              <input
                autoFocus
                value={milestoneForm.title}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
                className="w-full"
                placeholder="Alpha with the pilot brand"
              />
            </Field>
            <Field label="Date">
              <input type="date" value={milestoneForm.date} onChange={(e) => setMilestoneForm({ ...milestoneForm, date: e.target.value })} className="w-full" />
            </Field>
            <Field label="Notes">
              <textarea
                value={milestoneForm.notes}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, notes: e.target.value })}
                rows={4}
                className="w-full"
                placeholder="What has to be true on the day."
              />
            </Field>
            <label className="flex items-center gap-2 text-body-sm text-[var(--fg-muted)]">
              <input
                type="checkbox"
                checked={milestoneForm.completed}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, completed: e.target.checked })}
                className="h-4 w-4"
              />
              Hit
            </label>
            {formError && <ErrorBanner message={formError} />}
            <div className="flex justify-between gap-2 border-t border-[var(--fg-subtle)] pt-4">
              {milestoneModal !== 'new' ? (
                <Button variant="danger" onClick={deleteMilestone} disabled={saving}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving || !milestoneForm.title.trim()}>
                {saving ? 'Saving…' : 'Save milestone'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </motion.div>
  );
}
