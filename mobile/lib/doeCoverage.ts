/** Read explicit DOE periods from persisted bulletin metadata; never add a fixed interval. */
export type DoeCoverageMetadata = {
  bulletin_date: string;
  notes?: string | null;
  source_urls?: Record<string, string> | null;
  source_pdf_url?: string | null;
};
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TOKEN = '\\s*(?:-\\s*)?';
const SEPARATOR = '\\s*(?:-|to)\\s*';
function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}
function month(value: string): number { return MONTHS.indexOf(value.slice(0, 3).toLowerCase()) + 1; }
function explicitRanges(text: string): { start: string; end: string }[] {
  const normalized = text.replace(/[–—]/g, '-').replace(/_/g, ' ').replace(/-/g, ' - ').replace(/\s+/g, ' ');
  const ranges: { start: string; end: string }[] = [];
  const add = (m1: string, d1: string, y1: string | undefined, m2: string, d2: string, y2: string) => {
    const endYear = Number(y2);
    const startYear = y1 ? Number(y1) : endYear - (month(m1) > month(m2) ? 1 : 0);
    const start = iso(startYear, month(m1), Number(d1));
    const end = iso(endYear, month(m2), Number(d2));
    if (start && end && start <= end) ranges.push({ start, end });
  };
  // September 29 - October 5, 2026 / September 15-21, 2026 / Dec 29, 2025 - Jan 4, 2026.
  for (const m of normalized.matchAll(new RegExp(`\\b${MONTH}${TOKEN}(\\d{1,2})(?:,?\\s+(\\d{4}))?${SEPARATOR}(?:${MONTH}${TOKEN})?(\\d{1,2}),?${TOKEN}(\\d{4})\\b`, 'gi'))) {
    add(m[1], m[2], m[3], m[4] || m[1], m[5], m[6]);
  }
  // 29 Sep to 5 Oct 2026 / 29 Dec 2025 - 4 Jan 2026.
  for (const m of normalized.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MONTH}(?:,?\\s+(\\d{4}))?${SEPARATOR}(\\d{1,2})\\s+${MONTH},?\\s+(\\d{4})\\b`, 'gi'))) {
    add(m[2], m[1], m[3], m[5], m[4], m[6]);
  }
  // 15-21 September 2026 (including hyphenated official filenames).
  for (const m of normalized.matchAll(new RegExp(`\\b(\\d{1,2})${SEPARATOR}(\\d{1,2})\\s*(?:-\\s*)?${MONTH}\\s*(?:-\\s*)?(\\d{4})\\b`, 'gi'))) {
    add(m[3], m[1], undefined, m[3], m[2], m[4]);
  }
  return ranges;
}
export function resolveDoeCoverage(metadata: DoeCoverageMetadata, region: string): { coverage_start: string; coverage_end: string } | null {
  const texts = [metadata.notes ?? ''];
  const sources = Object.entries(metadata.source_urls ?? {}).filter(([key]) => key === region || key.startsWith(`${region}_`)).map(([, value]) => value);
  // All entries belong to this same bulletin identity. Require agreement across its explicit periods.
  sources.push(...Object.values(metadata.source_urls ?? {}));
  if (metadata.source_pdf_url) sources.push(metadata.source_pdf_url);
  for (const source of sources) for (const url of source.split(';')) {
    try {
      // Date ranges in the persisted official filename are evidence; query/import timestamps aren't.
      const pathname = new URL(url.trim()).pathname;
      texts.push(decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)));
    } catch { /* Malformed URLs and local paths do not supply a period. */ }
  }
  const ends = new Set(texts.flatMap(explicitRanges).filter((range) => range.start === metadata.bulletin_date).map((range) => range.end));
  if (ends.size !== 1) return null;
  return { coverage_start: metadata.bulletin_date, coverage_end: [...ends][0] };
}

/** Local calendar formatting avoids UTC-to-local shifting a period into the prior day. */
export function formatDoeTimelineDate(isoDate: string): string {
  const [year, monthNumber, day] = isoDate.split('-').map(Number);
  return new Date(year, monthNumber - 1, day).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}
