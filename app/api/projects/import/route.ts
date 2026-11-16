import { NextRequest, NextResponse } from 'next/server';
import { categoriesOf, parseProjectImport } from '@/lib/project-import';
import { serverClient } from '@/lib/supabase-server';

export const maxDuration = 60;

const key = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * POST { project_id, raw, allow_duplicates } — imports pasted JSON as project tasks.
 * Ids are always generated here, so the same payload can be replayed safely.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    project_id?: unknown;
    raw?: unknown;
    allow_duplicates?: unknown;
  } | null;

  const projectId = typeof body?.project_id === 'string' ? body.project_id : null;
  const raw = typeof body?.raw === 'string' ? body.raw : '';
  const allowDuplicates = body?.allow_duplicates === true;

  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const db = serverClient();
  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 400 });
  if (!project) return NextResponse.json({ error: 'unknown project' }, { status: 404 });

  const parsed = parseProjectImport(raw);
  if (parsed.error) {
    return NextResponse.json(
      { error: parsed.error, rejected: parsed.rejected, warnings: parsed.warnings },
      { status: 400 }
    );
  }

  const { data: existing, error } = await db
    .from('project_tasks')
    .select('title')
    .eq('project_id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const seen = new Set((existing ?? []).map((row) => key(String(row.title))));
  const completedAt = new Date().toISOString();
  const duplicates: string[] = [];
  let created = 0;

  for (const task of parsed.tasks) {
    const titleKey = key(task.title);
    if (!allowDuplicates && seen.has(titleKey)) {
      duplicates.push(task.title);
      continue;
    }
    const { error: insertError } = await db.from('project_tasks').insert({
      project_id: projectId,
      title: task.title,
      category: task.category,
      notes: task.notes,
      priority: task.priority,
      completed: task.completed,
      completed_at: task.completed ? completedAt : null,
      due_date: task.due_date,
      source: 'import',
    });
    if (insertError) {
      return NextResponse.json(
        {
          error: `Imported ${created} task(s) before failing: ${insertError.message}`,
          created,
          duplicates,
          rejected: parsed.rejected,
          warnings: parsed.warnings,
        },
        { status: 400 }
      );
    }
    seen.add(titleKey);
    created++;
  }

  return NextResponse.json({
    created,
    duplicates,
    rejected: parsed.rejected,
    warnings: parsed.warnings,
    categories: categoriesOf(parsed.tasks),
  });
}
