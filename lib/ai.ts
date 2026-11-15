const TIMEOUT_MS = 30_000;

interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const primary = process.env.DEFAULT_AI_PROVIDER ?? 'freellm';
  const freellm: Provider = {
    baseUrl: process.env.FREELLM_BASE_URL ?? 'http://localhost:3001/v1',
    apiKey: process.env.FREELLM_API_KEY ?? '',
    model: process.env.FREELLM_MODEL ?? 'auto',
  };
  const openai: Provider = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  };
  const ordered = primary === 'openai' ? [openai, freellm] : [freellm, openai];
  for (const p of ordered) if (p.apiKey) list.push(p);
  return list;
}

export async function chat(system: string, user: string): Promise<string> {
  const errors: string[] = [];
  for (const p of providers()) {
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) return text.trim();
      throw new Error('empty completion');
    } catch (e) {
      errors.push(`${p.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
}

export async function* chatStream(system: string, user: string): AsyncGenerator<string> {
  const errors: string[] = [];
  for (const p of providers()) {
    let yielded = false;
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          stream: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              yielded = true;
              yield delta;
            }
          } catch {
            // incomplete or keep-alive line
          }
        }
      }
      if (yielded) return;
      throw new Error('empty completion');
    } catch (e) {
      // Once content has streamed to the client we can't retry on another provider.
      if (yielded) throw e;
      errors.push(`${p.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
}

export const SUMMARIZE_SYSTEM =
  'You summarize notes for a busy AI startup founder. Return 3-6 tight bullet points capturing decisions, facts, and open questions. No preamble.';

export const ACTIONS_SYSTEM =
  'Extract concrete action items from the text. Return ONLY a JSON array of short imperative strings (e.g. "Send pitch deck to Acme"). No markdown fences, no commentary. If none, return [].';

export async function summarize(text: string): Promise<string> {
  return chat(SUMMARIZE_SYSTEM, text);
}

export async function extractActions(text: string): Promise<string[]> {
  const raw = await chat(ACTIONS_SYSTEM, text);
  return parseActionItems(raw);
}

export function parseActionItems(raw: string): string[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('AI did not return a list');
  return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

// Completed string elements of a JSON array that is still streaming in.
export function partialActionItems(raw: string): string[] {
  const items: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*(?=[,\]]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const value = JSON.parse(`"${m[1]}"`);
      if (typeof value === 'string' && value.trim()) items.push(value.trim());
    } catch {
      // incomplete escape sequence
    }
  }
  return items;
}