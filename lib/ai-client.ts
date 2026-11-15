'use client';

export interface AIResult {
  summary?: string;
  items?: string[];
}

interface Handlers {
  onDelta?: (text: string) => void;
  onItem?: (title: string) => void;
}

async function batchAI(action: 'summarize' | 'actions', text: string, handlers: Handlers): Promise<AIResult> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'AI failed');
  if (action === 'summarize') handlers.onDelta?.(data.summary);
  else for (const title of data.items ?? []) handlers.onItem?.(title);
  return data;
}

export async function runAI(
  action: 'summarize' | 'actions',
  text: string,
  handlers: Handlers = {}
): Promise<AIResult> {
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text, stream: true }),
    });
  } catch {
    return batchAI(action, text, handlers);
  }
  if (!res.ok || !res.body) return batchAI(action, text, handlers);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AIResult = {};
  let streamError: string | null = null;
  let received = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        let event = 'message';
        let data = '';
        for (const line of evt.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (event === 'delta') {
          received = true;
          handlers.onDelta?.(parsed.text);
        } else if (event === 'item') {
          received = true;
          handlers.onItem?.(parsed.title);
        } else if (event === 'done') {
          result = parsed;
        } else if (event === 'error') {
          streamError = parsed.error;
        }
      }
    }
  } catch {
    return batchAI(action, text, handlers);
  }

  // Provider ignored stream:true or died before sending anything — retry as batch.
  if (!received && !streamError) return batchAI(action, text, handlers);
  if (streamError) throw new Error(streamError);
  return result;
}