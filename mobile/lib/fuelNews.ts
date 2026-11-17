export type FuelNewsClassification = 'confirmed' | 'forecast' | 'news_update';
export type FuelNewsDirection = 'hike' | 'rollback' | 'mixed' | 'news_update';

export interface FuelNewsAdjustmentLike {
  fuelType: string;
  amountCentavos: number;
}

export interface FuelNewsArticleLike {
  id: string;
  publisher: string;
  publishedAt: string | null;
  fetchedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FuelNewsSourceHealthLike {
  lastSuccessAt: string | null;
  status: string | null;
}

export type FuelNewsDisplayKind = FuelNewsDirection | 'forecast';

export function fuelNewsDisplayKind(
  classification: FuelNewsClassification,
  direction: FuelNewsDirection,
): FuelNewsDisplayKind {
  return classification === 'forecast' ? 'forecast' : direction;
}

export function fuelNewsKindLabel(kind: FuelNewsDisplayKind): string {
  if (kind === 'news_update') return 'News Update';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function formatFuelName(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ').toLowerCase();
  if (normalized === 'gasoline') return 'Gasoline';
  if (normalized === 'diesel') return 'Diesel';
  if (normalized === 'kerosene') return 'Kerosene';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCentavosPerLiter(amountCentavos: number): string {
  if (!Number.isFinite(amountCentavos)) return '—';
  const amount = Math.abs(Math.round(amountCentavos)) / 100;
  const sign = amountCentavos > 0 ? '+' : amountCentavos < 0 ? '−' : '';
  return `${sign}₱${amount.toFixed(2)}/L`;
}

export function describeAdjustment(adjustment: FuelNewsAdjustmentLike): string {
  const movement = adjustment.amountCentavos > 0
    ? 'increase'
    : adjustment.amountCentavos < 0
      ? 'decrease'
      : 'no change';
  return `${formatFuelName(adjustment.fuelType)}: ${formatCentavosPerLiter(adjustment.amountCentavos)} ${movement}`;
}

const MANILA_ZONE = 'Asia/Manila';

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatManilaDateTime(
  value: string | null | undefined,
  options: { dateOnly?: boolean } = {},
): string | null {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: MANILA_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(options.dateOnly
      ? {}
      : { hour: 'numeric', minute: '2-digit', hour12: true }),
  }).format(date);
}

export function manilaTimestampLabel(
  label: string,
  value: string | null | undefined,
  options: { dateOnly?: boolean } = {},
): string | null {
  const formatted = formatManilaDateTime(value, options);
  return formatted ? `${label}: ${formatted} PHT (Asia/Manila)` : null;
}

export function effectiveTimeLabel(
  value: string | null | undefined,
  precision: string | null | undefined,
): string | null {
  return manilaTimestampLabel('Effective', value, { dateOnly: precision === 'date' });
}

export function latestArticleTimestamp(articles: FuelNewsArticleLike[]): string | null {
  let newest: FuelNewsArticleLike | null = null;
  for (const article of articles) {
    const timestamp = validDate(article.publishedAt)?.getTime();
    if (timestamp == null) continue;
    if (!newest || timestamp > (validDate(newest.publishedAt)?.getTime() ?? -Infinity)) {
      newest = article;
    }
  }
  return newest?.publishedAt ?? null;
}

export function publisherNames(articles: FuelNewsArticleLike[]): string[] {
  return [...new Set(articles.map((article) => article.publisher.trim()).filter(Boolean))];
}

export function hasUpdatedCoverage(articles: FuelNewsArticleLike[]): boolean {
  return articles.some((article) => {
    const created = validDate(article.createdAt)?.getTime();
    const updated = validDate(article.updatedAt)?.getTime();
    return created != null && updated != null && updated - created >= 1_000;
  });
}

export function sourceFeedIsStale(
  states: FuelNewsSourceHealthLike[],
  now: Date = new Date(),
  staleAfterHours = 6,
): boolean {
  if (states.length === 0) return false;
  const cutoff = now.getTime() - staleAfterHours * 60 * 60 * 1000;
  return states.every((state) => {
    const success = validDate(state.lastSuccessAt)?.getTime();
    return success == null || success < cutoff;
  });
}

export function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
