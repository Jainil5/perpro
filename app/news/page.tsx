'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import FootballSection from '@/components/FootballSection';
import { NewsItem } from '@/lib/types';
import { formatDistanceToNow, parseISO } from 'date-fns';

function ArticleCard({
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
    <motion.article
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3 }}
      whileHover={{ x: 4 }}
      layout
      className="rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-4 transition hover:border-[var(--accent-brand)]/50"
    >
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body font-semibold leading-snug text-[var(--fg-primary)] hover:text-[var(--accent-brand-hover)]"
        >
          {item.title}
        </a>
        <motion.button
          onClick={() => onToggleSaved(item)}
          aria-label={item.saved ? 'Unsave' : 'Save'}
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.05 }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg ${item.saved ? 'text-[var(--accent-warn)]' : 'text-[var(--fg-subtle)] hover:text-[var(--fg-primary)]'}`}
        >
          <motion.span
            animate={{ scale: item.saved ? 1 : 0.85, rotate: item.saved ? 0 : -90 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="inline-block"
          >
            {item.saved ? '★' : '☆'}
          </motion.span>
        </motion.button>
      </div>
      {item.summary && (
        <div className="mt-1">
          <AnimatePresence initial={false} mode="wait">
            <motion.p
              key={expanded ? 'expanded' : 'clamped'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={`text-body-sm leading-relaxed text-[var(--fg-muted)] ${expanded ? '' : 'line-clamp-2'}`}
            >
              {item.summary}
            </motion.p>
          </AnimatePresence>
          {longSummary && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] text-[var(--accent-brand)] hover:underline"
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.15 }}
        className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg-subtle)]"
      >
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--fg-muted)]"
        >
          {item.source}
        </motion.span>
        {item.published_at && (
          <motion.span initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
            {formatDistanceToNow(parseISO(item.published_at), { addSuffix: true })}
          </motion.span>
        )}
        <motion.button
          onClick={() => onSaveToNote(item)}
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.02 }}
          className="ml-auto min-h-[44px] px-2 text-[var(--accent-brand)]/80 hover:text-[var(--accent-brand-hover)]"
        >
          Save to note
        </motion.button>
      </motion.div>
    </motion.article>
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
      <AnimatePresence mode="wait">
        {error && <ErrorBanner message={error} />}
        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="mb-4 text-xs text-[var(--accent-brand-hover)]"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mb-4 flex flex-wrap items-center gap-1.5"
      >
        {sources.map((s, index) => (
          <motion.button
            key={s}
            onClick={() => setFilter(s)}
            layout
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, y: -10 }}
            animate={{
              opacity: 1,
              y: 0,
              paddingLeft: filter === s ? 18 : 12,
              paddingRight: filter === s ? 18 : 12,
            }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: index * 0.03 }}
            className={`min-h-[44px] rounded-full border text-xs transition-colors ${
              filter === s
                ? 'border-[var(--accent-brand)] bg-[var(--accent-brand)]/15 text-[var(--accent-brand-hover)]'
                : 'border-[var(--fg-subtle)] text-[var(--fg-muted)] hover:border-[var(--fg-muted)] hover:text-[var(--fg-primary)]'
            }`}
          >
            {s}
          </motion.button>
        ))}
        <span className="ml-auto">
          <Button onClick={refresh} loading={refreshing}>
            {refreshing ? 'Fetching…' : 'Refresh feeds'}
          </Button>
        </span>
      </motion.div>

      <AnimatePresence mode="wait">
        {loading ? (
          <Spinner label="Aggregating feeds…" />
        ) : visible.length === 0 ? (
          <EmptyState title="No items" hint={filter === 'Saved' ? 'Star items to keep them here.' : 'Hit Refresh feeds to pull the latest.'} />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2, staggerChildren: 0.05 }}
            className="space-y-3"
            layout
          >
            {visible.map((item) => (
              <ArticleCard key={item.id} item={item} onToggleSaved={toggleSaved} onSaveToNote={saveToNote} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto max-w-3xl"
    >
      <PageHeader title="News" sub={active.sub} />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-1"
        role="tablist"
        aria-label="News categories"
      >
        {CATEGORIES.map((c) => {
          const isActive = category === c.id;
          const accent = c.id === 'ai' ? 'var(--accent-brand)' : 'var(--accent-success)';
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setCategory(c.id)}
              className={`relative flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? '' : 'text-[var(--fg-muted)] hover:text-[var(--fg-primary)]'
              }`}
              style={isActive ? { color: accent } : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId="news-category"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-lg border"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                    borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
                  }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                {c.id === 'ai' ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 3z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5l4.3 3.1-1.6 5H9.3l-1.6-5L12 7.5z" fill="currentColor" stroke="none" />
                    <path d="M12 3v4.5M16.3 10.6l4.3-1.4M14.7 15.6l2.6 3.6M9.3 15.6l-2.6 3.6M7.7 10.6L3.4 9.2" />
                  </svg>
                )}
                {c.label}
              </span>
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={category}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {category === 'ai' ? <AiNewsSection /> : <FootballSection />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}