import type { TransportModeCode } from './transportModes';

/**
 * Assumptions for non-owned transport modes used by the Trip Cost Optimizer.
 *
 * Travel times for motorized modes are preferably derived from the Google
 * driving duration (factor + buffer) so alternatives stay comparable to the
 * real route. Absolute avgSpeedKmh is the fallback when no driving duration
 * is available, and is always used for walking.
 */
/**
 * Provenance for a fare that came from an official fare guide.
 *
 * Rendered in the Trip result so a regulated figure is never confused with a
 * locally-guessed one. Absent for modes with no authoritative source, which is
 * itself the important signal.
 */
export interface FareProvenance {
  /** Issuing body, e.g. "LTFRB fare guide". */
  authority: string;
  /** Which class within that guide, e.g. "Traditional PUJ". */
  className: string;
  /** ISO date the guide took effect. */
  effectiveDate: string;
  /** Plain-language note about what the figure does and does not cover. */
  note?: string;
}

export interface TransportModeDefaults {
  /** Legacy flat ₱/km used only when `fare` is omitted. */
  costPerKm: number;
  avgSpeedKmh: number;
  /** Multiply driving duration; 1 = same road time as a private car. */
  drivingTimeFactor: number;
  /** Fixed minutes added for waiting / pickup / transfers. */
  timeBufferMinutes: number;
  /** When set, the mode is omitted from SAW above this distance. */
  maxDistanceKm: number | null;
  /** LTFRB-style base + per-km fare. Prefer this over flat costPerKm. */
  fare?: {
    baseFare: number;
    includedKm: number;
    perKmAfter: number;
  };
  /**
   * Present ONLY where an official guide backs these numbers. Its absence means
   * the fare is a local assumption, and the UI says so rather than implying a
   * regulated rate.
   */
  fareSource?: FareProvenance;
  /**
   * Documented discounts. Reported, never silently applied -- the app has no
   * way to know whether this particular rider qualifies.
   */
  fareDiscounts?: { audience: string; percent: number; condition?: string }[];
}

export const TRANSPORT_MODE_DEFAULTS: Record<
  Exclude<TransportModeCode, 'OWN_VEHICLE'>,
  TransportModeDefaults
> = {
  /*
   * JEEPNEY / PUJ. These are the current LTFRB-Approved figures, not the
   * pre-2026 ones: the board adjusted all PUV fares effective 19 March 2026,
   * taking the traditional base from P13 to P14 and the succeeding-kilometre
   * rate from P1.80 to P2.00.
   *
   * The old constants in this file were exactly the superseded P13 / P1.80
   * values, so they were quietly understating every jeepney estimate.
   *
   * TWO HONEST CAVEATS:
   *  - LTFRB regulates the CLASS, and the board now distinguishes traditional
   *    from modern/aircon/electric PUJ, which carry a higher base (P17 / P2.40).
   *    The app has a single "Jeepney" option, so it uses the TRADITIONAL class,
   *    the cheapest regulated variant. A rider in an aircon jeepney will pay
   *    more than shown.
   *  - A real PUJ fare is per ROUTE and set on a published fare matrix, not a
   *    straight per-kilometre rate over a continuous trip. The base + per-km
   *    shape is the regulator's own, but a cross-town ride is usually one fare
   *    rather than a metered one. It remains an estimate.
   */
  JEEPNEY: {
    costPerKm: 2.5,
    avgSpeedKmh: 18,
    drivingTimeFactor: 1.35,
    timeBufferMinutes: 6,
    maxDistanceKm: null,
    fare: { baseFare: 14, includedKm: 4, perKmAfter: 2.0 },
    fareSource: {
      authority: 'LTFRB fare guide',
      className: 'Traditional PUJ',
      effectiveDate: '2026-03-19',
      note: 'Modern and aircon PUJ carry a higher regulated base fare.',
    },
    fareDiscounts: [
      { audience: 'Senior citizens and persons with disabilities', percent: 20 },
      { audience: 'Students', percent: 20, condition: 'School days' },
    ],
  },
  /*
   * TRICYCLE. NO fareSource on purpose. Tricycle fares sit with LGUs under the
   * Local Government Code, and the LTFRB PUV adjustment explicitly did not
   * cover them -- there is no national matrix to point at. The numbers below
   * are a local assumption and the UI says "Local fares may vary", because in
   * practice a tricycle fare is negotiated per trip or per zone rather than
   * metered per kilometre. Accurate pricing needs an LGU fare matrix, which is
   * a data-collection task, not a constant.
   */
  TRICYCLE: {
    costPerKm: 10,
    avgSpeedKmh: 22,
    drivingTimeFactor: 1.2,
    timeBufferMinutes: 3,
    maxDistanceKm: 8,
    fare: { baseFare: 30, includedKm: 1, perKmAfter: 10 },
  },
  /*
   * RIDE-HAILING / TNVS. NO fareSource on purpose. The 19 March 2026 LTFRB
   * adjustment covered jeepney, city and provincial bus, and explicitly
   * EXCLUDED taxis and motorcycle taxis; the TNVS and UV Express petitions
   * were still undecided at the time of writing. So there is no current
   * regulated figure to adopt, and these remain a local estimate.
   *
   * There is also no provider integration of any kind -- no Grab or Angkas
   * quote call anywhere in the app. Traffic, surge and demand are not
   * represented, which is why the result says the actual booking fare may
   * vary.
   */
  RIDE_HAILING: {
    costPerKm: 18,
    avgSpeedKmh: 30,
    drivingTimeFactor: 1.0,
    timeBufferMinutes: 5,
    maxDistanceKm: null,
    fare: { baseFare: 49, includedKm: 1, perKmAfter: 14 },
  },
  // Walking is free but only practical for short distances.
  WALKING: {
    costPerKm: 0,
    avgSpeedKmh: 5,
    drivingTimeFactor: 0,
    timeBufferMinutes: 0,
    maxDistanceKm: 2.5,
  },
};

/** Own-vehicle assumptions when computing travel time without a live route. */
export const OWN_VEHICLE_DEFAULTS = {
  avgSpeedKmh: 40,
};

export function travelTimeMinutes(distanceKm: number, avgSpeedKmh: number): number {
  if (avgSpeedKmh <= 0) {
    return 0;
  }
  return (distanceKm / avgSpeedKmh) * 60;
}

/** Estimated fare for a mode (base + per-km when configured). */
export function estimateModeCost(
  distanceKm: number,
  defaults: TransportModeDefaults,
): number {
  if (defaults.fare) {
    const { baseFare, includedKm, perKmAfter } = defaults.fare;
    if (distanceKm <= includedKm) return baseFare;
    return baseFare + (distanceKm - includedKm) * perKmAfter;
  }
  return defaults.costPerKm * distanceKm;
}

/**
 * Estimated travel time for a non-owned mode.
 * Motorized modes prefer the live driving duration so SAW compares like-for-like.
 */
export function estimateModeTravelTime(
  distanceKm: number,
  defaults: TransportModeDefaults,
  drivingDurationMinutes?: number | null,
): number {
  // Walking (and any mode with factor 0) always uses walking/absolute speed.
  if (defaults.drivingTimeFactor <= 0) {
    return travelTimeMinutes(distanceKm, defaults.avgSpeedKmh);
  }

  if (drivingDurationMinutes != null && drivingDurationMinutes > 0) {
    return (
      drivingDurationMinutes * defaults.drivingTimeFactor + defaults.timeBufferMinutes
    );
  }

  return (
    travelTimeMinutes(distanceKm, defaults.avgSpeedKmh) + defaults.timeBufferMinutes
  );
}

export function isModeEligibleForDistance(
  defaults: TransportModeDefaults,
  distanceKm: number,
): boolean {
  if (defaults.maxDistanceKm == null) return true;
  return distanceKm <= defaults.maxDistanceKm;
}
