import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  FuelNewsClassification,
  FuelNewsDirection,
} from '@/lib/fuelNews';
import { latestArticleTimestamp } from '@/lib/fuelNews';
import { supabase } from '@/lib/supabase';

export interface FuelNewsArticle {
  id: string;
  publisher: string;
  canonicalUrl: string;
  headline: string;
  excerpt: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
  parseStatus: string;
}

export interface FuelNewsAdjustment {
  fuelType: string;
  amountCentavos: number;
  confidence: string;
}

export interface FuelNewsEvent {
  id: string;
  classification: FuelNewsClassification;
  direction: FuelNewsDirection;
  effectiveAt: string | null;
  effectiveTimezone: string;
  effectivePrecision: string | null;
  coverage: string | null;
  confidence: string;
  parseStatus: string;
  lastSeenAt: string;
  publishedAt: string | null;
  updatedAt: string;
  summary: string | null;
  adjustments: FuelNewsAdjustment[];
  articles: FuelNewsArticle[];
  hasDiscrepancy: boolean;
}

export interface FuelNewsSourceState {
  sourceKey: string;
  publisher: string;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  status: string | null;
  errorMessage: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface FuelNewsPage {
  items: FuelNewsEvent[];
  hasMore: boolean;
}

type ArticleRow = {
  id: string;
  publisher: string;
  canonical_url: string;
  headline: string;
  excerpt: string | null;
  published_at: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
  parse_status: string;
};

type EventArticleRow = {
  article: ArticleRow | ArticleRow[] | null;
};

type AdjustmentRow = {
  fuel_type: string;
  amount_centavos: number;
  confidence: string;
};

type EventRow = {
  id: string;
  classification: string;
  direction: string;
  effective_at: string | null;
  effective_timezone: string;
  effective_precision: string | null;
  coverage: string | null;
  summary: string | null;
  confidence: string;
  parse_status: string;
  discrepancy: boolean;
  published_at: string | null;
  last_seen_at: string;
  updated_at: string;
  fuel_news_adjustments: AdjustmentRow[] | null;
  fuel_news_event_articles: EventArticleRow[] | null;
};

type SourceStateRow = {
  source_key: string;
  publisher: string;
  last_polled_at: string | null;
  last_success_at: string | null;
  status: string | null;
  error_message: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

/**
 * Narrow schema adapter for the additive fuel-news migration. It deliberately
 * exposes only feed-readable columns; hashes, raw parse JSON and importer headers
 * never enter the mobile bundle's data model.
 */
interface FuelNewsDatabase {
  public: {
    Tables: {
      fuel_news_articles: {
        Row: ArticleRow;
        Insert: Partial<ArticleRow>;
        Update: Partial<ArticleRow>;
        Relationships: [];
      };
      fuel_news_events: {
        Row: Omit<EventRow, 'fuel_news_adjustments' | 'fuel_news_event_articles'>;
        Insert: Partial<Omit<EventRow, 'fuel_news_adjustments' | 'fuel_news_event_articles'>>;
        Update: Partial<Omit<EventRow, 'fuel_news_adjustments' | 'fuel_news_event_articles'>>;
        Relationships: [];
      };
      fuel_news_adjustments: {
        Row: AdjustmentRow & { event_id: string };
        Insert: AdjustmentRow & { event_id: string };
        Update: Partial<AdjustmentRow>;
        Relationships: [];
      };
      fuel_news_event_articles: {
        Row: { event_id: string; article_id: string };
        Insert: { event_id: string; article_id: string };
        Update: Partial<{ event_id: string; article_id: string }>;
        Relationships: [];
      };
      fuel_news_source_state: {
        Row: SourceStateRow;
        Insert: Partial<SourceStateRow> & { source_key: string };
        Update: Partial<SourceStateRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const db = supabase as unknown as SupabaseClient<FuelNewsDatabase>;
const PAGE_SIZE = 12;

const EVENT_SELECT = `
  id,
  classification,
  direction,
  effective_at,
  effective_timezone,
  effective_precision,
  coverage,
  summary,
  confidence,
  parse_status,
  discrepancy,
  published_at,
  last_seen_at,
  updated_at,
  fuel_news_adjustments (
    fuel_type,
    amount_centavos,
    confidence
  ),
  fuel_news_event_articles (
    article:fuel_news_articles!inner (
      id,
      publisher,
      canonical_url,
      headline,
      excerpt,
      published_at,
      fetched_at,
      created_at,
      updated_at,
      parse_status
    )
  )
`;

function asClassification(value: string): FuelNewsClassification {
  if (value === 'confirmed' || value === 'forecast') return value;
  return 'news_update';
}

function asDirection(value: string): FuelNewsDirection {
  if (value === 'hike' || value === 'rollback' || value === 'mixed') return value;
  return 'news_update';
}

function unwrapArticle(value: EventArticleRow['article']): ArticleRow | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapEvent(row: EventRow): FuelNewsEvent {
  const articles = (row.fuel_news_event_articles ?? [])
    .map((link) => unwrapArticle(link.article))
    .filter((article): article is ArticleRow => article !== null)
    .map((article): FuelNewsArticle => ({
      id: article.id,
      publisher: article.publisher,
      canonicalUrl: article.canonical_url,
      headline: article.headline,
      excerpt: article.excerpt,
      publishedAt: article.published_at,
      fetchedAt: article.fetched_at,
      createdAt: article.created_at,
      updatedAt: article.updated_at,
      parseStatus: article.parse_status,
    }))
    .sort((left, right) =>
      (right.publishedAt ?? right.fetchedAt).localeCompare(left.publishedAt ?? left.fetchedAt));
  const adjustments = (row.fuel_news_adjustments ?? [])
    .map((adjustment): FuelNewsAdjustment => ({
      fuelType: adjustment.fuel_type,
      amountCentavos: adjustment.amount_centavos,
      confidence: adjustment.confidence,
    }))
    .sort((left, right) => left.fuelType.localeCompare(right.fuelType));

  return {
    id: row.id,
    classification: asClassification(row.classification),
    direction: asDirection(row.direction),
    effectiveAt: row.effective_at,
    effectiveTimezone: row.effective_timezone || 'Asia/Manila',
    effectivePrecision: row.effective_precision,
    coverage: row.coverage,
    confidence: row.confidence,
    parseStatus: row.parse_status,
    lastSeenAt: row.last_seen_at,
    publishedAt: row.published_at ?? latestArticleTimestamp(articles),
    updatedAt: row.updated_at,
    summary: row.summary,
    adjustments,
    articles,
    hasDiscrepancy:
      row.discrepancy || row.parse_status === 'conflict'
      || articles.some((article) => article.parseStatus === 'conflict'),
  };
}

export async function fetchFuelNewsPage(
  page = 0,
  pageSize = PAGE_SIZE,
): Promise<FuelNewsPage> {
  const safePage = Math.max(0, Math.trunc(page));
  const safeSize = Math.max(1, Math.min(30, Math.trunc(pageSize)));
  const from = safePage * safeSize;
  const { data, error } = await db
    .from('fuel_news_events')
    .select(EVENT_SELECT)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('last_seen_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + safeSize);

  if (error) throw error;
  const rows = (data ?? []) as unknown as EventRow[];
  const items = rows.slice(0, safeSize).map(mapEvent).filter((item) => item.articles.length > 0);
  return { items, hasMore: rows.length > safeSize };
}

export async function fetchFuelNewsDetail(eventId: string): Promise<FuelNewsEvent | null> {
  if (!eventId.trim()) return null;
  const { data, error } = await db
    .from('fuel_news_events')
    .select(EVENT_SELECT)
    .eq('id', eventId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const event = mapEvent(data as unknown as EventRow);
  return event.articles.length > 0 ? event : null;
}

export async function fetchFuelNewsSourceState(): Promise<FuelNewsSourceState[]> {
  const { data, error } = await db
    .from('fuel_news_source_state')
    .select('source_key, publisher, last_polled_at, last_success_at, status, error_message, last_error, consecutive_failures')
    .order('publisher', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as SourceStateRow[]).map((row) => ({
    sourceKey: row.source_key,
    publisher: row.publisher,
    lastPolledAt: row.last_polled_at,
    lastSuccessAt: row.last_success_at,
    status: row.status,
    errorMessage: row.error_message,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
  }));
}

export { PAGE_SIZE as FUEL_NEWS_PAGE_SIZE };
