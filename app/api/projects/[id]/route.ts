import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/projects/[id] — removes the project together with its tasks and
 * milestones. Done server-side so one click cannot leave orphan rows behind.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = serverClient();

  const { data: project, error: findError } = await db
    .from('projects')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 400 });
  if (!project) return NextResponse.json({ error: 'unknown project' }, { status: 404 });

  const removed: { tasks: number; milestones: number } = { tasks: 0, milestones: 0 };
  for (const table of ['project_tasks', 'project_milestones'] as const) {
    const { data: rows, error: readError } = await db.from(table).select('id').eq('project_id', id);
    if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
    removed[table === 'project_tasks' ? 'tasks' : 'milestones'] = rows?.length ?? 0;
    const { error } = await db.from(table).delete().eq('project_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error } = await db.from('projects').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ...removed });
}
