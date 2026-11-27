import { NextRequest, NextResponse } from 'next/server';
import { fetchAllNews } from '@/lib/news';
import { serverClient } from '@/lib/supabase-server';
import { withData } from '@/lib/data-guard';


export const maxDuration = 60;

async function innerGET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const items = await fetchAllNews();
  if (items.length > 0) {
    const { error } = await serverClient()
      .from('news_items')
      .upsert(items, { onConflict: 'url' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ upserted: items.length });
}

export const GET = withData(innerGET);
