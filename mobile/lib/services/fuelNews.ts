import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export interface FuelNewsPreviewItem {
  id: string;
  headline: string;
  publisher: string;
  canonicalUrl: string;
}

type ArticleRow = {
  id: string;
  publisher: string;
  canonical_url: string;
  headline: string;
  published_at: string | null;
  fetched_at: string;
  is_feed_visible: boolean;
};

type EventArticleRow = {
  article: ArticleRow | ArticleRow[] | null;
};

type EventRow = {
  id: string;
  fuel_news_event_articles: EventArticleRow[] | null;
};

/** Local read-only schema for the one query Home needs. */
interface FuelNewsPreviewDatabase {
  public: {
    Tables: {
      fuel_news_articles: {
        Row: ArticleRow;
        Insert: Partial<ArticleRow>;
        Update: Partial<ArticleRow>;
        Relationships: [];
      };
      fuel_news_events: {
        Row: {
          id: string;
          published_at: string | null;
          last_seen_at: string;
        };
        Insert: Partial<{
          id: string;
          published_at: string | null;
          last_seen_at: string;
        }>;
        Update: Partial<{
          id: string;
          published_at: string | null;
          last_seen_at: string;
        }>;
        Relationships: [];
      };
      fuel_news_event_articles: {
        Row: { event_id: string; article_id: string };
        Insert: { event_id: string; article_id: string };
        Update: Partial<{ event_id: string; article_id: string }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const db = supabase as unknown as SupabaseClient<FuelNewsPreviewDatabase>;
const HOME_PREVIEW_LIMIT = 3;
const HOME_PREVIEW_CANDIDATE_LIMIT = 12;

const HOME_PREVIEW_SELECT = `
  id,
  fuel_news_event_articles (
    article:fuel_news_articles!inner (
      id,
      publisher,
      canonical_url,
      headline,
      published_at,
      fetched_at,
      is_feed_visible
    )
  )
`;

/** Accept only browser-safe publisher URLs; credentials must never reach Home. */
export function safeHttpsUrl(value: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function articleTime(article: ArticleRow): number {
  for (const value of [article.published_at, article.fetched_at]) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return -Infinity;
}

/** Choose the newest usable article from the visible links attached to one event. */
export function selectNewestVisibleArticle(
  links: readonly EventArticleRow[] | null | undefined,
): ArticleRow | null {
  let newest: ArticleRow | null = null;

  for (const link of links ?? []) {
    const articles = Array.isArray(link.article) ? link.article : [link.article];
    for (const article of articles) {
      if (
        !article
        || !article.is_feed_visible
        || !article.headline.trim()
        || !article.publisher.trim()
        || !safeHttpsUrl(article.canonical_url)
      ) {
        continue;
      }

      if (
        !newest
        || articleTime(article) > articleTime(newest)
        || (articleTime(article) === articleTime(newest) && article.id > newest.id)
      ) {
        newest = article;
      }
    }
  }

  return newest;
}

function mapPreview(row: EventRow): FuelNewsPreviewItem | null {
  const article = selectNewestVisibleArticle(row.fuel_news_event_articles);
  if (!article) return null;

  const canonicalUrl = safeHttpsUrl(article.canonical_url);
  if (!canonicalUrl) return null;

  return {
    id: row.id,
    headline: article.headline.trim(),
    publisher: article.publisher.trim(),
    canonicalUrl,
  };
}

/** Fetch the newest Home headlines. This is intentionally not a paginated feed API. */
export async function fetchFuelNewsPreview(): Promise<FuelNewsPreviewItem[]> {
  const { data, error } = await db
    .from('fuel_news_events')
    .select(HOME_PREVIEW_SELECT)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('last_seen_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HOME_PREVIEW_CANDIDATE_LIMIT);

  if (error) throw error;

  return ((data ?? []) as unknown as EventRow[])
    .map(mapPreview)
    .filter((item): item is FuelNewsPreviewItem => item !== null)
    .slice(0, HOME_PREVIEW_LIMIT);
}
