import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { fetchAllNews } from '@/lib/news';
import { withData } from '@/lib/data-guard';
import { DataConfigError } from '@/lib/supabase-server';

export const maxDuration = 60;
const STALE_MS = 60 * 60 * 1000;

async function refresh() {
  const items = await fetchAllNews();
  if (items.length === 0) return { inserted: 0 };
  const db = serverClient();
  const { error } = await db
    .from('news_items')
    .upsert(items, { onConflict: 'url', ignoreDuplicates: false });
  if (error) throw new Error(error.message);
  return { inserted: items.length };
}

async function getItems() {
  const db = serverClient();
  const { data, error } = await db
    .from('news_items')
    .select('*')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(150);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function innerGET() {
  try {
    const db = serverClient();
    const { data: latest } = await db
      .from('news_items')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const stale =
      !latest || Date.now() - new Date(latest.fetched_at).getTime() > STALE_MS;
    let refreshed = false;
    let warning: string | null = null;
    if (stale) {
      try {
        await refresh();
        refreshed = true;
      } catch (e) {
        warning = e instanceof Error ? e.message : 'refresh failed';
      }
    }
    return NextResponse.json({ items: await getItems(), refreshed, warning });
  } catch (e) {
    if (e instanceof DataConfigError) throw e; // 503 with the fix step, not a 500
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load news' },
      { status: 500 }
    );
  }
}

async function innerPOST() {
  try {
    const result = await refresh();
    return NextResponse.json({ ...result, items: await getItems() });
  } catch (e) {
    if (e instanceof DataConfigError) throw e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'refresh failed' },
      { status: 502 }
    );
  }
}

export const GET = withData(innerGET);
export const POST = withData(innerPOST);
