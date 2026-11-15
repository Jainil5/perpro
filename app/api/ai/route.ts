import { NextRequest, NextResponse } from 'next/server';
import {
  summarize,
  extractActions,
  chatStream,
  partialActionItems,
  parseActionItems,
  SUMMARIZE_SYSTEM,
  ACTIONS_SYSTEM,
} from '@/lib/ai';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { action, text, stream } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  if (action !== 'summarize' && action !== 'actions') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  const input = text.slice(0, 12_000);

  if (stream) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          if (action === 'summarize') {
            let full = '';
            for await (const delta of chatStream(SUMMARIZE_SYSTEM, input)) {
              full += delta;
              send('delta', { text: delta });
            }
            send('done', { summary: full.trim() });
          } else {
            let full = '';
            let emitted = 0;
            for await (const delta of chatStream(ACTIONS_SYSTEM, input)) {
              full += delta;
              const items = partialActionItems(full);
              while (emitted < items.length) {
                send('item', { title: items[emitted] });
                emitted++;
              }
            }
            let items: string[];
            try {
              items = parseActionItems(full);
            } catch {
              items = partialActionItems(full);
            }
            while (emitted < items.length) {
              send('item', { title: items[emitted] });
              emitted++;
            }
            send('done', { items });
          }
        } catch (e) {
          send('error', { error: e instanceof Error ? e.message : 'AI request failed' });
        }
        controller.close();
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  try {
    if (action === 'summarize') {
      return NextResponse.json({ summary: await summarize(input) });
    }
    return NextResponse.json({ items: await extractActions(input) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI request failed' },
      { status: 502 }
    );
  }
}