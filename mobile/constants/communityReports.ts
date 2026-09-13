/** Community fuel report verification — must match supabase migration constants. */

/** Independent confirmations required (excluding report author). */
export const VERIFY_CONFIRMATIONS_REQUIRED = 3;

/** Confirmations must agree within this band (PHP/L). */
export const PRICE_MATCH_TOLERANCE = 0.5;

/** Competing pending reports beyond this band are flagged needs_review. */
export const CONFLICT_TOLERANCE = 1.0;

/** Verified reports older than this are excluded from authoritative displays. */
export const REPORT_MAX_AGE_DAYS = 7;

/** Default nearby-station search radius (km) for Phase A Haversine queries. */
export const NEARBY_STATION_RADIUS_KM = 10;

export type CommunityReportStatus = 'pending' | 'verified' | 'rejected' | 'needs_review';
