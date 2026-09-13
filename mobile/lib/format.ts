export function formatCurrency(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

/** Parse a YYYY-MM-DD bulletin date without timezone shifting the calendar day. */
function parseBulletinDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/** DOE week start with weekday, e.g. "Tue, Aug 25, 2026". */
export function formatBulletinWeek(date: string): string {
  return parseBulletinDate(date).toLocaleDateString('en-PH', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDate(date: string): string {
  return parseBulletinDate(date).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Month + day, and the year whenever it is not the current calendar year. */
export function formatShortDate(date: string, now = new Date()): string {
  const parsed = parseBulletinDate(date);
  const includeYear = parsed.getFullYear() !== now.getFullYear();
  return parsed.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

/** When the ETL wrote this bulletin into Supabase. */
export function formatLoadedAt(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const loaded = new Date(iso);
  if (Number.isNaN(loaded.getTime())) return null;

  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const midnightLoaded = new Date(loaded.getFullYear(), loaded.getMonth(), loaded.getDate());
  const ageDays = Math.round(
    (midnightToday.getTime() - midnightLoaded.getTime()) / 86_400_000
  );

  if (ageDays === 0) return 'Loaded today';
  if (ageDays === 1) return 'Loaded yesterday';
  if (ageDays > 1 && ageDays < 7) return `Loaded ${ageDays} days ago`;

  return `Loaded ${loaded.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: loaded.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })}`;
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString('en-PH', { month: 'long' });
}

export function transportModeLabel(code: string): string {
  const labels: Record<string, string> = {
    OWN_VEHICLE: 'Own Vehicle',
    JEEPNEY: 'Jeepney',
    TRICYCLE: 'Tricycle',
    RIDE_HAILING: 'Ride-hailing',
    WALKING: 'Walking',
  };
  return labels[code] ?? code;
}
