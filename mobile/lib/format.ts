export function formatCurrency(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

/**
 * Peso display for headline figures: whole amounts stay clean ("₱5,000") while
 * real cents are preserved ("₱2,250.50"). Always a leading ₱ with no space, so
 * money reads identically everywhere on the Budget page.
 */
export function formatPeso(amount: number): string {
  const safe = Number(amount);
  const rounded = Number.isFinite(safe) ? Math.round(safe * 100) / 100 : 0;
  const hasCents = Math.abs(rounded % 1) > 0.004;
  return `₱${rounded.toLocaleString('en-PH', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Parse a value for DISPLAY only.
 *
 * Two structurally different inputs reach this helper, and they need opposite
 * strategies — applying one parser to both is what caused the bug fixed here.
 *
 * 1. Date-only strings ("2026-09-30"), used by DOE bulletins. These carry no
 *    time and no zone. `new Date('2026-09-30')` is specified to parse as UTC
 *    midnight, which renders as the PREVIOUS day for anyone west of Greenwich.
 *    So the components are read and rebuilt in local time instead.
 *
 * 2. Full ISO timestamps ("2026-09-30T04:00:00.000Z") from timestamptz columns
 *    such as `vehicle_refills.occurred_at`, `created_at` and `last_sign_in_at`.
 *    These are absolute instants, so they are parsed normally and read through
 *    local getters.
 *
 * The old implementation split EVERY input on '-' and read index 2 as the day.
 * For a full timestamp that yields "30T04:00:00.000Z", which `Number()` turns
 * into NaN, and the `day || 1` fallback then silently rendered the 1st of the
 * month. Every timestamp-based date in the app was showing the wrong day.
 */
function parseDisplayDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

/** DOE week start with weekday, e.g. "Tue, Aug 25, 2026". */
export function formatBulletinWeek(date: string): string {
  return parseDisplayDate(date).toLocaleDateString('en-PH', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** DOE bulletin period, e.g. "Sep 29 – Oct 5, 2026". */
export function formatBulletinRange(startDate: string): string {
  const start = parseDisplayDate(startDate);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endLabel = end.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
}

export function formatDate(date: string): string {
  return parseDisplayDate(date).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Month + day, and the year whenever it is not the current calendar year. */
export function formatShortDate(date: string, now = new Date()): string {
  const parsed = parseDisplayDate(date);
  const includeYear = parsed.getFullYear() !== now.getFullYear();
  return parsed.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

export function formatRelativeReportAge(date: string, now = new Date()): string {
  const reported = new Date(date);
  const ageDays = Math.max(
    0,
    Math.floor(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
        new Date(reported.getFullYear(), reported.getMonth(), reported.getDate()).getTime()) /
        86_400_000
    )
  );
  if (ageDays === 0) return 'Reported today';
  if (ageDays === 1) return 'Reported 1 day ago';
  if (ageDays < 7) return `Reported ${ageDays} days ago`;
  return `Reported ${formatDate(date)}`;
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
