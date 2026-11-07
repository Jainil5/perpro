'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import { NewsItem } from '@/lib/types';
import { formatDistanceToNow, parseISO } from 'date-fns';

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/news');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed to load');
      setItems(data.items);
      if (data.warning) setNotice(`Feed refresh failed, showing cached items: ${data.warning}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load news');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/news', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'refresh failed');
      setItems(data.items);
      setNotice(`Fetched ${data.inserted} items from 7 sources.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refresh failed');
    }
    setRefreshing(false);
  }

  async function toggleSaved(item: NewsItem) {
    const res = await fetch(`/api/db/news_items?id=${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: !item.saved }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? 'update failed');
    else setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, saved: !i.saved } : i)));
  }

  async function saveToNote(item: NewsItem) {
    const res = await fetch('/api/db/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: item.title,
        body: `${item.url}\n\nSource: ${item.source}\n\n${item.summary ?? ''}`,
        tags: ['ai-news'],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? 'save failed');
    else {
      setNotice('Saved to Notes with tag ai-news.');
      if (!item.saved) toggleSaved(item);
    }
  }

  const sources = ['All', ...Array.from(new Set(items.map((i) => i.source))), 'Saved'];
  const visible = items.filter((i) =>
    filter === 'All' ? true : filter === 'Saved' ? i.saved : i.source === filter
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="AI News"
        sub="Model releases and field updates from OpenAI, DeepMind, Hugging Face, TechCrunch, The Verge, Ars Technica, and Hacker News."
        action={<Button onClick={refresh} disabled={refreshing}>{refreshing ? 'Fetching…' : 'Refresh feeds'}</Button>}
      />
      {error && <ErrorBanner message={error} />}
      {notice && <p className="mb-4 text-xs text-indigo-300">{notice}</p>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`min-h-[44px] rounded-full border px-3 text-xs transition ${
              filter === s
                ? 'border-indigo-600 bg-indigo-600/15 text-indigo-300'
                : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Aggregating feeds…" />
      ) : visible.length === 0 ? (
        <EmptyState title="No items" hint={filter === 'Saved' ? 'Star items to keep them here.' : 'Hit Refresh feeds to pull the latest.'} />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <article key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700">
              <div className="flex items-start justify-between gap-3">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold leading-snug text-zinc-100 hover:text-indigo-300">
                  {item.title}
                </a>
                <button
                  onClick={() => toggleSaved(item)}
                  aria-label={item.saved ? 'Unsave' : 'Save'}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg ${item.saved ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                  {item.saved ? '★' : '☆'}
                </button>
              </div>
              {item.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{item.summary}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{item.source}</span>
                {item.published_at && <span>{formatDistanceToNow(parseISO(item.published_at), { addSuffix: true })}</span>}
                <button onClick={() => saveToNote(item)} className="ml-auto min-h-[44px] px-2 text-indigo-400/80 hover:text-indigo-300">
                  Save to note
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}