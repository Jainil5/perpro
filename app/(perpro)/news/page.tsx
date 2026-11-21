'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import FootballSection from '@/components/FootballSection';
import { NewsItem } from '@/lib/types';
import { formatDate } from '@/lib/os/format';

function ArticleRow({
  item,
  onToggleSaved,
  onSaveToNote,
}: {
  item: NewsItem;
  onToggleSaved: (item: NewsItem) => void;
  onSaveToNote: (item: NewsItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const longSummary = (item.summary?.length ?? 0) > 160;

  return (
    <article className="border-b border-line py-3">
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[14px] leading-snug text-foreground underline-offset-2 hover:underline"
        >
          {item.title}
        </a>
        <button
          onClick={() => onToggleSaved(item)}
          aria-label={item.saved ? 'Unsave' : 'Save'}
          aria-pressed={item.saved}
          className={`os-tap-none flex h-9 w-9 shrink-0 items-center justify-center text-[15px] transition-colors duration-150 ${
            item.saved ? 'text-warning' : 'text-faint hover:text-foreground'
          }`}
        >
          {item.saved ? '★' : '☆'}
        </button>
      </div>

      {item.summary && (
        <div className="mt-1.5">
          <p className={`text-[12.5px] leading-relaxed text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
            {item.summary}
          </p>
          {longSummary && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="os-label mt-1 text-faint underline-offset-2 hover:text-foreground hover:underline"
            >
              {expanded ? 'show less' : 'read more'}
            </button>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="os-label">{item.source}</span>
        {item.published_at && (
          <span className="os-mono text-[11px] text-faint">{formatDate(item.published_at)}</span>
        )}
        <button
          onClick={() => onSaveToNote(item)}
          className="os-tap-none ml-auto min-h-[36px] px-2 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          save to note
        </button>
      </div>
    </article>
  );
}

function AiNewsSection() {
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
    <>
      {error && <ErrorBanner message={error} />}
      {notice && <p className="os-micro mb-4">{notice}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-2">
        {sources.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            aria-current={filter === s || undefined}
            className={`os-tap-none min-h-[36px] text-[12px] transition-colors duration-150 ${
              filter === s ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto">
          <Button onClick={refresh} loading={refreshing}>
            {refreshing ? 'Fetching…' : 'Refresh feeds'}
          </Button>
        </span>
      </div>

      {loading ? (
        <Spinner label="Aggregating feeds…" />
      ) : visible.length === 0 ? (
        <EmptyState title="No items" hint={filter === 'Saved' ? 'Star items to keep them here.' : 'Hit Refresh feeds to pull the latest.'} />
      ) : (
        <div>
          {visible.map((item) => (
            <ArticleRow key={item.id} item={item} onToggleSaved={toggleSaved} onSaveToNote={saveToNote} />
          ))}
        </div>
      )}
    </>
  );
}

type Category = 'ai' | 'football';

const CATEGORIES: { id: Category; label: string; sub: string }[] = [
  {
    id: 'ai',
    label: 'AI News',
    sub: 'Model releases and field updates from OpenAI, DeepMind, Hugging Face, TechCrunch, The Verge, Ars Technica, and Hacker News.',
  },
  {
    id: 'football',
    label: 'Football',
    sub: 'Upcoming matches and recent results for the clubs you follow.',
  },
];

export default function NewsPage() {
  const [category, setCategory] = useState<Category>('ai');
  const active = CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="os-enter mx-auto max-w-3xl">
      <PageHeader eyebrow="Feed" title="News" sub={active.sub} />

      {/* Hairline category rail: the active label carries a 2px ink bar. */}
      <div className="mb-5 flex gap-6 border-b border-line" role="tablist" aria-label="News categories">
        {CATEGORIES.map((c) => {
          const isActive = category === c.id;
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setCategory(c.id)}
              className={`os-tap-none -mb-px flex min-h-[36px] items-center gap-2 border-b-2 px-0 text-[13px] transition-colors duration-150 ${
                isActive
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="relative z-10 flex items-center gap-2">
                {c.id === 'ai' ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true">
                    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 3z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5l4.3 3.1-1.6 5H9.3l-1.6-5L12 7.5z" />
                    <path d="M12 3v4.5M16.3 10.6l4.3-1.4M14.7 15.6l2.6 3.6M9.3 15.6l-2.6 3.6M7.7 10.6L3.4 9.2" />
                  </svg>
                )}
                {c.label}
              </span>
            </button>
          );
        })}
      </div>

      <div key={category}>
        {category === 'ai' ? <AiNewsSection /> : <FootballSection />}
      </div>
    </div>
  );
}
