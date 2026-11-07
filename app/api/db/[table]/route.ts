import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

const TABLES = ['inbox', 'tasks', 'meetings', 'notes', 'news_items'];

type Ctx = { params: Promise<{ table: string }> };

async function resolveTable(ctx: Ctx) {
  const { table } = await ctx.params;
  return TABLES.includes(table) ? table : null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
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

export async function POST(req: NextRequest, ctx: Ctx) {
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

export async function PATCH(req: NextRequest, ctx: Ctx) {
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

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const table = await resolveTable(ctx);
  if (!table) return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await serverClient().from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}