import Parser from 'rss-parser';

export const NEWS_SOURCES: { name: string; url: string; titleFilter?: RegExp }[] = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', titleFilter: /\b(ai|llm|gpt|claude|gemini|openai|anthropic|deepmind|machine learning|neural|transformer|diffusion|agent)\b/i },
];

export interface FetchedItem {
  url: string;
  title: string;
  source: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
}

const parser = new Parser({ timeout: 15_000 });

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchAllNews(): Promise<FetchedItem[]> {
  const now = new Date().toISOString();
  const results = await Promise.allSettled(
    NEWS_SOURCES.map(async (source) => {
      const feed = await parser.parseURL(source.url);
      return (feed.items ?? []).slice(0, 30).flatMap((item) => {
        const url = item.link?.trim();
        const title = item.title?.trim();
        if (!url || !title || !url.startsWith('http')) return [];
        if (source.titleFilter && !source.titleFilter.test(title)) return [];
        const rawSummary = item.contentSnippet ?? item.content ?? item.summary ?? '';
        const summary = stripHtml(rawSummary).slice(0, 400) || null;
        const published = item.isoDate ?? item.pubDate;
        return [{
          url,
          title,
          source: source.name,
          summary,
          published_at: published ? new Date(published).toISOString() : null,
          fetched_at: now,
        }];
      });
    })
  );
  const items: FetchedItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  return items;
}