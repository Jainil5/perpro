import { NextRequest, NextResponse } from 'next/server';
import { summarize, extractActions } from '@/lib/ai';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { action, text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  try {
    if (action === 'summarize') {
      return NextResponse.json({ summary: await summarize(text.slice(0, 12_000)) });
    }
    if (action === 'actions') {
      return NextResponse.json({ items: await extractActions(text.slice(0, 12_000)) });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI request failed' },
      { status: 502 }
    );
  }
}