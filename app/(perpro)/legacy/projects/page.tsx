'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ProjectFormModal from '@/components/ProjectFormModal';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { Project, ProjectTask } from '@/lib/types';
import { projectStats } from '@/lib/projects';
import { todayISO, useTable } from '@/lib/useTable';
import LegacyBanner from '@/components/LegacyBanner';
import { HairlineBar } from '@/components/os/marks';

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, done: 2, archived: 3 };

/** Status reads as type, not as a coloured chip; only state gets ink colour. */
const STATUS_TONE: Record<string, string> = {
  active: 'text-foreground',
  paused: 'text-warning',
  done: 'text-success',
  archived: 'text-faint',
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
    <div className="os-enter mx-auto max-w-5xl">
      <LegacyBanner live="/projects" />
      <PageHeader
        eyebrow="Supabase"
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
        <div className="border-t border-line">
          {ordered.map((project) => {
            const stats = projectStats(byProject.get(project.id) ?? [], today);
            return (
              <div key={project.id} className="relative border-b border-line py-4 pr-20">
                <Link href={`/legacy/projects/${project.id}`} className="block">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h2 className="text-[16px] leading-snug text-foreground">{project.name}</h2>
                    <span className={`os-label ${STATUS_TONE[project.status] ?? STATUS_TONE.archived}`}>
                      {project.status}
                    </span>
                  </div>

                  {project.description && (
                    <p className="mt-1.5 line-clamp-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-3 max-w-2xl">
                    <HairlineBar value={stats.pct} label={project.name} />
                  </div>

                  <div className="os-micro mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="os-num">
                      {stats.done}/{stats.total}
                    </span>
                    <span>done</span>
                    {stats.overdue > 0 && (
                      <span className="os-num text-danger">{stats.overdue} overdue</span>
                    )}
                    {stats.nextDue && <span>next due {stats.nextDue}</span>}
                    {project.target_date && <span>target {project.target_date}</span>}
                  </div>
                </Link>

                <button
                  onClick={() => setModal(project)}
                  className="os-tap-none absolute bottom-4 right-0 min-h-[36px] rounded-os border border-line px-2.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-line-strong hover:text-foreground"
                >
                  Edit
                </button>
              </div>
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
    </div>
  );
}
