import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { withData } from '@/lib/data-guard';


const TABLES = [
  'inbox',
  'tasks',
  'meetings',
  'notes',
  'news_items',
  'projects',
  'project_tasks',
  'project_milestones',
];

type Ctx = { params: Promise<{ table: string }> };

async function resolveTable(ctx: Ctx) {
  const { table } = await ctx.params;
  return TABLES.includes(table) ? table : null;
}

async function innerGET(req: NextRequest, ctx: Ctx) {
  const table = await resolveTable(ctx);
  if (!table) return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  const order =
    req.nextUrl.searchParams.get('order') ??
    (table === 'news_items' ? 'fetched_at' : 'created_at');
  const ascending = req.nextUrl.searchParams.get('dir') === 'asc';
  const { data, error } = await serverClient()
    .from(table)
    .select('*')
    .order(order, { ascending });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rows: data ?? [] });
}

async function innerPOST(req: NextRequest, ctx: Ctx) {
  const table = await resolveTable(ctx);
  if (!table) return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  const values = await req.json().catch(() => null);
  if (!values || typeof values !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { error } = await serverClient().from(table).insert(values);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

async function innerPATCH(req: NextRequest, ctx: Ctx) {
  const table = await resolveTable(ctx);
  if (!table) return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const values = await req.json().catch(() => null);
  if (!values || typeof values !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { error } = await serverClient().from(table).update(values).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

async function innerDELETE(req: NextRequest, ctx: Ctx) {
  const table = await resolveTable(ctx);
  if (!table) return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await serverClient().from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export const GET = withData(innerGET);
export const POST = withData(innerPOST);
export const PATCH = withData(innerPATCH);
export const DELETE = withData(innerDELETE);
