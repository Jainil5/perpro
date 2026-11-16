'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import ProjectFormModal from '@/components/ProjectFormModal';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { Project, ProjectTask } from '@/lib/types';
import { projectStats } from '@/lib/projects';
import { todayISO, useTable } from '@/lib/useTable';

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, done: 2, archived: 3 };

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-[var(--accent-success)]/15 text-[var(--accent-success)]',
  paused: 'bg-[var(--accent-warn)]/15 text-[var(--accent-warn)]',
  done: 'bg-[var(--accent-brand)]/15 text-[var(--accent-brand-hover)]',
  archived: 'bg-[var(--bg-elevated)] text-[var(--fg-muted)]',
};

export default function ProjectsPage() {
  const projects = useTable<Project>('projects', 'created_at');
  const allTasks = useTable<ProjectTask>('project_tasks', 'created_at', true);
  const [modal, setModal] = useState<'closed' | 'new' | Project>('closed');
  const today = todayISO();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setModal('new');
  }, []);

  const byProject = useMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    for (const task of allTasks.rows) {
      const list = map.get(task.project_id);
      if (list) list.push(task);
      else map.set(task.project_id, [task]);
    }
    return map;
  }, [allTasks.rows]);

  const ordered = [...projects.rows].sort((a, b) => {
    const status = (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4);
    if (status !== 0) return status;
    return (b.updated_at ?? b.created_at) < (a.updated_at ?? a.created_at) ? -1 : 1;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto max-w-5xl"
    >
      <PageHeader
        title="Projects"
        sub={`${projects.rows.filter((p) => p.status === 'active').length} active`}
        action={<Button onClick={() => setModal('new')}>+ New project</Button>}
      />

      {(projects.error ?? allTasks.error) && <ErrorBanner message={(projects.error ?? allTasks.error) as string} />}

      {projects.loading ? (
        <Spinner />
      ) : ordered.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create one, then paste in tasks as JSON." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {ordered.map((project, index) => {
            const stats = projectStats(byProject.get(project.id) ?? [], today);
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
                whileHover={{ y: -3 }}
                className="relative overflow-hidden rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)]"
              >
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: project.color }} />
                <Link href={`/projects/${project.id}`} className="block px-4 py-4 pl-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-h3 text-[var(--fg-primary)]">{project.name}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] capitalize ${STATUS_STYLE[project.status] ?? STATUS_STYLE.archived}`}>
                      {project.status}
                    </span>
                  </div>

                  {project.description && (
                    <p className="mt-1 line-clamp-2 text-body-sm text-[var(--fg-muted)]">{project.description}</p>
                  )}

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${stats.pct}%` }}
                      transition={{ duration: 0.6, delay: 0.1 + index * 0.05, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ background: project.color }}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-[var(--fg-muted)]">
                    <span>
                      {stats.done}/{stats.total} done
                    </span>
                    {stats.overdue > 0 && (
                      <span className="font-semibold text-[var(--accent-critical)]">{stats.overdue} overdue</span>
                    )}
                    {stats.nextDue && <span>next due {stats.nextDue}</span>}
                    {project.target_date && <span>target {project.target_date}</span>}
                  </div>
                </Link>

                <button
                  onClick={() => setModal(project)}
                  className="absolute bottom-3 right-3 rounded-lg border border-[var(--fg-subtle)] px-2.5 py-1 text-[11px] text-[var(--fg-muted)] transition hover:text-[var(--fg-primary)]"
                >
                  Edit
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {modal !== 'closed' && (
        <ProjectFormModal
          project={modal === 'new' ? null : modal}
          onClose={() => setModal('closed')}
          onSaved={() => projects.reload()}
        />
      )}
    </motion.div>
  );
}
