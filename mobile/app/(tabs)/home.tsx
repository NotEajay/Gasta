import { Ionicons } from '@expo/vector-icons';
import type { User } from '@supabase/supabase-js';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floatingNavContentInset } from '@/app/(tabs)/_layout';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import LoadingState from '@/components/ui/LoadingState';
// NOTE: Home now runs on the cream/forest GasTa canvas, matching Vehicles,
// Budget and Profile. `HomeColors` (old navy / cool-gray) is no longer used
// here; `GasTaColors` is the single palette, as it already is on those screens.
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { useResponsive } from '@/hooks/useResponsive';
import {
  formatCurrency,
  formatDate,
  formatPeso,
  transportModeLabel,
} from '@/lib/format';
import {
  DASHBOARD_FUEL_TYPE,
  DASHBOARD_REGION,
  DASHBOARD_RECO_FILL_LITERS,
  fetchDashboardBudgetSummary,
  fetchDashboardPendingSummary,
  fetchDashboardPriceSummary,
  fetchRecentUserReports,
  resolveVehicleFuelCode,
  type DashboardBudgetSummary,
  type DashboardPendingSummary,
  type DashboardPriceSummary,
  type DashboardReport,
} from '@/lib/services/dashboard';
import { resolveCurrentPlace } from '@/lib/services/location';
import { fetchRecentTrips } from '@/lib/services/trips';
import { fetchVehicles } from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_FUEL_TYPES } from '@/constants/fuelTypes';
import type { DoeRegionCode } from '@/constants/regions';
import { DOE_REGIONS } from '@/constants/regions';
import type { TripRecord } from '@/types/mcda';
import type { Vehicle } from '@/types';

/**
 * `gastanew.png` is the horizontal GasTa wordmark used in the hero.
 *
 * IMPORTANT: the file is a 1254x1254 SQUARE, but the wordmark inside it only
 * occupies 1128x338 (measured from its alpha channel) with large transparent
 * padding above and below. Sizing the Image box by the FILE's 1:1 aspect would
 * therefore render the wordmark itself only ~35px tall -- which is exactly the
 * "too small to read" problem this asset was added to fix.
 *
 * So the box is sized by the CONTENT aspect (3.34:1) instead. That keeps the
 * wordmark crisp, uncropped and at its intended height at every breakpoint.
 */
const gastaNewLogo = require('@/assets/images/gastanew.png');

/**
 * Measured geometry of gastanew.png, from its alpha channel.
 *
 * The file is a 1254x1254 SQUARE, but the wordmark only occupies a
 * 1128x338 region at (84, 456) -- i.e. roughly 36% transparent padding above and
 * 37% below, and almost none at the sides.
 *
 * That is why simply widening the Image did not help: `resizeMode="contain"`
 * fits the SQUARE source into the box by its SMALLER dimension, so a 135x40 box
 * shrank the whole 1254px canvas to 40x40 and the visible wordmark came out
 * ~36px wide -- unreadable, and leaving the rest of the row empty.
 *
 * So the square is rendered at full size inside a box exactly the size of the
 * visible artwork, offset by the padding. The source is square and the box is
 * square, so `contain` is a 1:1 fit and nothing is stretched or distorted --
 * the transparent margin is simply cropped away.
 */
const GASTANEW_FILE = 1254;
const GASTANEW_PAD_X = 84;
const GASTANEW_PAD_Y = 456;
const GASTANEW_CONTENT_W = 1128;
const GASTANEW_CONTENT_H = 338;

/** The wordmark at a given VISIBLE width, cropped to its real bounds. */
function BrandWordmark({ width }: { width: number }) {
  const scale = width / GASTANEW_CONTENT_W;
  const imageSize = GASTANEW_FILE * scale;
  return (
    // Pinned so the tagline can never squeeze the wordmark: it is the brand, and
    // it is already at its minimum useful size.
    <View style={{ width, height: GASTANEW_CONTENT_H * scale, overflow: 'hidden', flexShrink: 0 }}>
      <Image
        accessibilityLabel="GasTa"
        accessibilityRole="image"
        resizeMode="contain"
        source={gastaNewLogo}
        style={{
          position: 'absolute',
          width: imageSize,
          height: imageSize,
          left: -GASTANEW_PAD_X * scale,
          top: -GASTANEW_PAD_Y * scale,
        }}
      />
    </View>
  );
}

/**
 * Cream-on-forest tokens for the dark "This month" card.
 *
 * Defined here rather than in the theme because the theme has no on-forest set
 * yet, and adding one globally would ripple through every screen. The earlier
 * attempt used `forestMuted` (dark green at 68%) on a `forestDark` background,
 * which is green-on-green and effectively invisible.
 */
const ON_FOREST = {
  label: 'rgba(248, 240, 229, 0.82)',
  body: 'rgba(248, 240, 229, 0.94)',
  sub: 'rgba(248, 240, 229, 0.78)',
  track: 'rgba(248, 240, 229, 0.22)',
  /** A light lime that reads clearly on forest without a new brand hue. */
  fill: '#9BE08A',
  over: '#FCA5A5',
} as const;

/** "NCR" -> "National Capital Region", from the shared region table. */
function regionDisplayName(code: DoeRegionCode): string {
  return DOE_REGIONS.find((region) => region.code === code)?.name ?? code;
}

/** "RON_91" -> "RON 91", from the shared fuel table. */
function fuelDisplayName(code: DoeFuelTypeCode): string {
  return DOE_FUEL_TYPES.find((fuel) => fuel.code === code)?.name ?? code;
}

/** Compact distance for the fuel card source line (e.g. "850 m", "1.2 km"). */
function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * "Sunday, September 28" — local device date, no network, no stored state. */
function getTodayLabel(now = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** One small semantic chip. Only rendered when there is a real status to show. */
function Badge({ label, tone }: { label: string; tone: HomeActivityTone }) {
  return (
    <View style={[styles.badge, { backgroundColor: BADGE_TONE[tone] }]}>
      <Text style={[styles.badgeText, { color: STATUS_TONES[tone] }]}>{label}</Text>
    </View>
  );
}



type HomeActivityIcon = 'navigate-outline' | 'pricetag-outline';
type HomeActivityTone = 'pending' | 'verified' | 'rejected' | 'review' | 'neutral';

type HomeActivity = {
  id: string;
  createdAt: string;
  title: string;
  secondary: string;
  detail: string;
  icon: HomeActivityIcon;
  /**
   * One small semantic chip per row: the transport mode for a trip, the
   * moderation status for a price report. Never a second badge, and never on
   * every row -- the point is that it means something when it is there.
   */
  badge?: string;
  badgeTone?: HomeActivityTone;
};

/** Report statuses defined by constants/communityReports.ts. */
const REPORT_STATUS: Record<string, { label: string; tone: HomeActivityTone }> = {
  pending: { label: 'Pending', tone: 'pending' },
  verified: { label: 'Verified', tone: 'verified' },
  rejected: { label: 'Rejected', tone: 'rejected' },
  needs_review: { label: 'Needs review', tone: 'review' },
};

/** Status colors only — plain text, no pill, so status stays readable but quiet. */
const STATUS_TONES: Record<HomeActivityTone, string> = {
  pending: palette.warning,
  verified: GasTaColors.forest,
  rejected: palette.danger,
  review: GasTaColors.forestDark,
  neutral: GasTaColors.textMuted,
};

/** Soft chip fills, tuned to stay inside the cream/forest system. */
const BADGE_TONE: Record<HomeActivityTone, string> = {
  pending: 'rgba(180, 83, 9, 0.12)',
  verified: GasTaColors.forestGlow,
  rejected: palette.dangerSoft,
  review: GasTaColors.creamDark,
  neutral: GasTaColors.cream,
};

function getDisplayName(user: User): string {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }
  return user.email?.split('@')[0] || 'GasTa user';
}

/** Device local time: 05:00-11:59 morning, 12:00-17:59 afternoon, 18:00-04:59 evening. */
function getGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function tripRouteLabel(record: TripRecord): string {
  if (record.origin_label || record.destination_label) {
    return `${record.origin_label ?? '…'} → ${record.destination_label ?? '…'}`;
  }
  return `${record.distance_km} km trip`;
}

function reportStatusLabel(status: string): string {
  return status.replace('_', ' ');
}

/** Known statuses get a pill; anything unexpected still renders as a neutral pill. */
function reportStatusBadge(status: string): { label: string; tone: HomeActivityTone } {
  const known = REPORT_STATUS[status];
  if (known) return known;

  const label = reportStatusLabel(status).trim();
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    tone: 'neutral',
  };
}

/** Compact status for the row header — a small dot plus tinted text, never a badge. */
export default function HomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { contentMaxWidth, horizontalPadding, width: windowWidth } = useResponsive();
  // Lets the branded hero bleed up under the status bar instead of leaving a
  // cream strip above it. Declared here, with the other hooks and above every
  // early return -- a hook below one changes the hook order between the loading
  // and loaded renders.
  const insets = useSafeAreaInsets();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [price, setPrice] = useState<DashboardPriceSummary | null>(null);
  const [budget, setBudget] = useState<DashboardBudgetSummary | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [reports, setReports] = useState<DashboardReport[]>([]);
  /**
   * Owned vehicles only, for the "At a glance" cards.
   *
   * `fetchVehicles` filters on `user_id = <me>`, so this can never contain a
   * shared vehicle, and it is ONE call -- not a per-vehicle refill lookup. The
   * last-refill price and date come from the vehicle row's own cached columns,
   * so no refill history is fetched at all.
   */
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pending, setPending] = useState<DashboardPendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  /** Local-only expansion of the already-loaded activity list. No query. */
  const [showAllRecent, setShowAllRecent] = useState(false);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const now = new Date();

    /*
     * Two phases, both internally parallel.
     *
     * Phase 1 is everything that does not depend on a resolved value: budget,
     * trips, reports, vehicles, pending, and the location read. Phase 2 is the
     * price query, because it needs the region and fuel type that phase 1
     * produces.
     *
     * Every call keeps its own `.catch()`, so one failing source degrades to an
     * empty section instead of an error screen. There is still no N+1 and no
     * per-vehicle refill query.
     */
    const [nextBudget, nextTrips, nextReports, nextVehicles, nextPending, place] =
      await Promise.all([
        fetchDashboardBudgetSummary(user.id, now.getFullYear(), now.getMonth() + 1).catch(
          () => null
        ),
        fetchRecentTrips(user.id, 8).catch(() => [] as TripRecord[]),
        fetchRecentUserReports(user.id, 8).catch(() => [] as DashboardReport[]),
        fetchVehicles(user.id).catch(() => [] as Vehicle[]),
        fetchDashboardPendingSummary(),
        // Non-prompting: reads an existing grant, returns null otherwise.
        resolveCurrentPlace({ requestIfNeeded: false }).catch(() => null),
      ]);

    setBudget(nextBudget);
    setTrips(nextTrips);
    setReports(nextReports);
    setVehicles(nextVehicles);
    setPending(nextPending);

    // The primary vehicle's own fuel type, resolved id -> DOE code. A failure
    // resolves to null, which falls back to the labelled reference fuel.
    const primaryVehicleFuel = nextVehicles[0]?.fuel_type_id ?? null;
    const resolvedFuel = await resolveVehicleFuelCode(primaryVehicleFuel);

    const effectiveRegion = place?.regionCode ?? DASHBOARD_REGION;
    const effectiveFuel = resolvedFuel ?? DASHBOARD_FUEL_TYPE;

    const nextPrice = await fetchDashboardPriceSummary(
      effectiveRegion,
      effectiveFuel,
      place?.regionCode != null,
      resolvedFuel != null,
      place
        ? { latitude: place.latitude, longitude: place.longitude }
        : null
    ).catch(() => null);

    setPrice(nextPrice);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const activities = useMemo<HomeActivity[]>(() => {
    const tripItems = trips.map((record) => ({
      id: `trip-${record.id}`,
      createdAt: record.created_at,
      title: tripRouteLabel(record),
      secondary: formatDate(record.created_at),
      detail: `${record.distance_km} km · recommended`,
      icon: 'navigate-outline' as const,
      badge: transportModeLabel(record.recommended_mode_code),
      badgeTone: 'verified' as const,
    }));
    const reportItems = reports.map((report) => {
      const status = reportStatusBadge(report.status);
      return {
        id: `report-${report.id}`,
        createdAt: report.createdAt,
        title: 'Price report',
        secondary: report.stationName,
        detail: `${report.fuelTypeName} · ${formatCurrency(report.price)}/L`,
        icon: 'pricetag-outline' as const,
        badge: status.label,
        badgeTone: status.tone,
      };
    });

    return [...tripItems, ...reportItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [reports, trips]);

  /**
   * Recent is capped for density. Both source fetches already return up to 8
   * each, so this only trims the merged list that is already in memory.
   *
   * No hook: slicing is trivial, and a hook declared after the early returns
   * below would change the hook order between the loading and loaded renders,
   * which React reports as "Rendered more hooks than during the previous
   * render". A plain const cannot have that problem.
   */
  const RECENT_COLLAPSED = 2;
  const RECENT_MAX = 6;
  const visibleActivities = (
    showAllRecent ? activities : activities.slice(0, RECENT_COLLAPSED)
  ).slice(0, RECENT_MAX);
  /**
   * How many the "view more" action would actually reveal.
   *
   * When the loaded list is longer than the expanded cap this reports the cap
   * rather than the true total, so the label never promises rows that will not
   * appear. There is no merged activity/history screen to send the user to
   * (trip/history.tsx is trips only), so expansion is local and issues no query.
   */
  const hiddenCount = Math.min(
    Math.max(activities.length - RECENT_COLLAPSED, 0),
    RECENT_MAX - RECENT_COLLAPSED
  );
  const canExpand = hiddenCount > 0;

  /**
   * The vehicle shown in "At a glance".
   *
   * `fetchVehicles` returns only vehicles the user owns, newest-created first,
   * so the first entry follows the app's existing stable order and can never be
   * a shared vehicle. No "primary vehicle" concept exists in the data model, so
   * none is invented here.
   */
  const primaryVehicle = vehicles[0] ?? null;
  const vehicleName = primaryVehicle
    ? primaryVehicle.nickname?.trim() || `${primaryVehicle.brand} ${primaryVehicle.model}`.trim()
    : null;

  // Navigation handlers must be declared with the other hooks, above the early
  // returns below — hooks after a conditional return change the hook order.
  const goToPrices = useCallback(() => router.push('/(tabs)/prices'), [router]);
  const goToTrip = useCallback(() => router.push('/(tabs)/trip'), [router]);
  // "Log refill" lands on Vehicles in this pass. The direct deep-link into a
  // specific vehicle's form needs an `initiallyOpenForm` prop on
  // VehicleRefillPanel plus route params on the Vehicles screen, and that
  // plumbing is deliberately deferred so this pass adds no navigation state.
  const goToVehicles = useCallback(() => router.push('/(tabs)/vehicles'), [router]);
  const goToBudget = useCallback(() => router.push('/(tabs)/budget'), [router]);

  /**
   * Home is allowed a slightly wider shell than the shared `contentMaxWidth`
   * (which tops out at 480 on desktop) so a browser does not show a narrow
   * mobile column adrift in empty space. Still capped, never full-bleed.
   */
  const homeMaxWidth = Math.max(contentMaxWidth, 640);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading your dashboard…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to view your GasTa dashboard."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  const displayName = getDisplayName(user);
  const firstName = displayName.split(/\s+/)[0] || displayName;

  // The fuel type stays the service's concern (DASHBOARD_FUEL_TYPE); the section
  // heading is intentionally generic so it does not duplicate that in the UI.

  const todayLabel = getTodayLabel();

  /**
   * Visible wordmark width. Measured, not guessed: this is the width of the
   * ARTWORK after the transparent margin is cropped, so the mark reads at roughly
   * 130px on a phone and caps at 168px on a desktop rather than upscaling a
   * raster past the point it stays crisp.
   */
  const brandLogoWidth = Math.round(
    Math.min(Math.max(windowWidth * 0.35, 118), 168)
  );

  /**
   * Whether the tagline needs two lines.
   *
   * Below ~390px a single line would force the wordmark down to stay legible, or
   * overflow, so it breaks after the first sentence instead. The wordmark keeps
   * its size either way -- the tagline is what adapts, never the logo.
   */
  const taglineBreaks = windowWidth < 390;

  // "31%" beside the headline. Derived from the same progress the bar uses, so
  // the two can never disagree. Only shown when there is a real limit.
  const budgetPercentLabel =
    budget?.hasBudget && !budget.actualUnavailable && budget.limitAmount > 0
      ? `${Math.round(budget.progress * 100)}%`
      : null;

  // Recommendation card copy — DOE-first "best this week" layout.
  const recoRegionLabel = price
    ? regionDisplayName(price.regionCode ?? regionCode ?? DASHBOARD_REGION)
    : null;
  const recoEyebrow = price
    ? price.source === 'community'
      ? price.isNearbyRecommended
        ? `Cheapest nearby · ${fuelDisplayName(price.fuelCode)}`
        : `Community pick · ${fuelDisplayName(price.fuelCode)}`
      : `Cheapest ${fuelDisplayName(price.fuelCode)} · ${recoRegionLabel}`
    : null;

  const recoUpdatedLabel =
    price?.bulletinAgeDays == null
      ? null
      : price.bulletinAgeDays <= 0
        ? 'Updated today'
        : price.bulletinAgeDays === 1
          ? 'Updated yesterday'
          : `Updated ${price.bulletinAgeDays} days ago`;

  const recoDelta =
    price?.vsLastBulletin != null && Number.isFinite(price.vsLastBulletin)
      ? price.vsLastBulletin
      : null;

  const recoSavingsLabel =
    price?.savingsOnFill != null && price.savingsOnFill > 0
      ? `Save about ${formatPeso(Math.round(price.savingsOnFill))} on a ${DASHBOARD_RECO_FILL_LITERS} L fill-up vs average`
      : null;

  /**
   * A quiet qualifier under the price when the fuel is NOT the vehicle's own --
   * either no vehicle exists, or its fuel type could not be resolved. Without
   * this, a RON 91 reference figure sits directly beside a diesel vehicle with
   * nothing signalling the mismatch.
   */
  const fuelFallbackNote = price?.isFuelFallback
    ? `${fuelDisplayName(price.fuelCode)} reference · not your vehicle's fuel`
    : null;

  // Budget figures are ACTUAL accepted refill spending, shared with the Budget
  // page through fetchDashboardBudgetSummary. The trip estimate is deliberately
  // not mixed in.
  const budgetIsOver = (budget?.overBy ?? 0) > 0;
  const budgetHeadroom = formatPeso(
    budgetIsOver ? (budget?.overBy ?? 0) : (budget?.remaining ?? 0)
  );
  const budgetLimit = budget?.hasBudget ? formatPeso(budget.limitAmount) : null;
  const budgetSpent = budget?.hasBudget && !budget.actualUnavailable
    ? formatPeso(budget.spent)
    : null;
  const budgetProgress = budget?.hasBudget && !budget.actualUnavailable ? budget.progress : null;
  const budgetProgressWidth = `${Math.round((budgetProgress ?? 0) * 100)}%` as `${number}%`;
  const budgetFillColor =
    budget?.status === 'exceeded'
      ? palette.danger
      : budget?.status === 'warning'
        ? palette.warning
        : GasTaColors.forest;
  return (
    <ScrollView
      // The canonical cream, same as the scene behind it. Explicit rather than
      // transparent so an iOS bounce or a web overscroll exposes this exact
      // shade instead of whatever happens to be behind the ScrollView.
      style={[styles.flex, styles.scroll]}
      contentContainerStyle={[
        styles.shell,
        {
          maxWidth: homeMaxWidth,
          // Home opted out of the scene's painted bottom strip (see the Home tab
          // in _layout.tsx), so it reserves the identical clearance here. The
          // body continues behind the floating bar instead of stopping at a
          // differently-coloured band, and the last row stays reachable.
          paddingBottom: floatingNavContentInset(insets.bottom),
        },
      ]}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}>
      {/*
        COMPACT HEADER. The wordmark sits on the cream canvas beside a quiet
        profile action, with the greeting as the real content. No hero banner and
        no drop shadow: the reference composition is information-first, and the
        dark "This month" card below is the only thing competing for attention.

        The wordmark is sized by the asset's CONTENT aspect (3.34:1), not the
        1254x1254 file aspect, so the mark renders at its real height instead of
        ~35px inside a square of transparent padding.
      */}
      {/*
        Same horizontal padding as the card grid below, so the wordmark and the
        cards share one margin down the page. Written as a JSX comment -- a bare
        `//` line here is a text node, and React Native throws "Text strings must
        be rendered within a <Text> component" for it.
      */}
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <View style={styles.headerRow}>
          <BrandWordmark width={brandLogoWidth} />
          {/*
            Brand tagline, not an action.

            The top-right control was a second shortcut for a screen that the
            bottom tab bar already owns, so it carried no information. A short
            statement of what the product is does, and it balances the wordmark
            without adding another thing to tap.

            "LOWER COSTS" is the only emphasised run. On a narrow phone the line
            breaks deliberately after the first sentence rather than wherever the
            text happens to run out, so the accent never lands mid-phrase.
          */}
          <View style={styles.tagline}>
            {taglineBreaks ? (
              <>
                <Text style={[styles.taglineLine, styles.taglineLineNarrow]}>
                  SMART CHOICES.
                </Text>
                <Text style={[styles.taglineLine, styles.taglineLineNarrow]}>
                  <Text style={styles.taglineAccent}>LOWER COSTS.</Text> EVERY TRIP.
                </Text>
              </>
            ) : (
              <Text style={styles.taglineLine}>
                SMART CHOICES. <Text style={styles.taglineAccent}>LOWER COSTS.</Text> EVERY TRIP.
              </Text>
            )}
          </View>
        </View>
        <Text style={styles.greeting} numberOfLines={1}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={styles.headerDate} numberOfLines={1}>
          {todayLabel}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={[styles.grid, { paddingHorizontal: horizontalPadding }]}>
          {/*
            THIS MONTH — the primary hero. A dark forest card, because this is the
            one number the user opened the app for, and the reference composition
            gives it the visual weight. Still the accepted-allocations-only
            actual spend; the trip estimate is never mixed in.
          */}
          <View style={styles.monthCard}>
            <View style={styles.monthHead}>
              <Text style={styles.monthLabel}>This month</Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="View budget"
                hitSlop={8}
                onPress={goToBudget}
                style={({ pressed }) => [styles.monthHeadLink, pressed && styles.pressed]}>
                <Text style={styles.monthHeadLinkText}>View budget</Text>
                <Ionicons name="chevron-forward" size={12} color={GasTaColors.cream} />
              </Pressable>
            </View>

            {budget?.hasBudget ? (
              budget.actualUnavailable ? (
                // Never claim a zero we could not verify.
                <Text style={styles.monthUnavailable}>Refill spending unavailable</Text>
              ) : (
                <>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    numberOfLines={1}
                    style={styles.monthAmount}>
                    {budgetSpent}
                  </Text>
                  <Text numberOfLines={1} style={styles.monthSub}>
                    {[
                      `of ${budgetLimit} budget`,
                      budgetPercentLabel ? `${budgetPercentLabel} used` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={styles.monthTrack}>
                    <View
                      style={[
                        styles.monthFill,
                        {
                          width: budgetProgressWidth,
                          backgroundColor: budgetIsOver ? ON_FOREST.over : ON_FOREST.fill,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.monthFoot}>
                    <Text numberOfLines={1} style={styles.monthFootLeft}>
                      {budgetHeadroom} {budgetIsOver ? 'over' : 'left'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Log refill"
                      onPress={goToVehicles}
                      style={({ pressed }) => [styles.logRefillPill, pressed && styles.pressed]}>
                      <Ionicons name="add" size={14} color={GasTaColors.forest} />
                      <Text style={styles.logRefillPillText}>Log refill</Text>
                    </Pressable>
                  </View>
                </>
              )
            ) : budget?.actualUnavailable ? (
              <Text style={styles.monthUnavailable}>Refill spending unavailable</Text>
            ) : (
              <>
                <Text style={styles.monthAmount}>
                  {budget ? formatPeso(budget.spent) : '—'}
                </Text>
                <Text numberOfLines={1} style={styles.monthSub}>
                  spent on refills this month
                </Text>
                <View style={styles.monthFoot}>
                  <Text style={styles.monthFootLeft}>No monthly budget set</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Log refill"
                    onPress={goToVehicles}
                    style={({ pressed }) => [styles.logRefillPill, pressed && styles.pressed]}>
                    <Ionicons name="add" size={14} color={GasTaColors.forest} />
                    <Text style={styles.logRefillPillText}>Log refill</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          {/*
            DOE recommendation panel (proposed layout): cheapest brand this week,
            week-over-week delta, fill-up savings vs average, runners-up, and
            dual CTAs. Uses forestDark + cream tokens so it sits in the GasTa
            system next to This month — not a one-off mock palette.
          */}
          <View style={styles.block}>
            {price ? (
              <View style={styles.recoCard}>
                <View style={styles.recoTop}>
                  {recoEyebrow ? (
                    <Text numberOfLines={2} style={styles.recoEyebrow}>
                      {recoEyebrow}
                    </Text>
                  ) : null}
                  {recoUpdatedLabel ? (
                    <View style={styles.recoAgePill}>
                      <Text style={styles.recoAgePillText}>{recoUpdatedLabel}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.recoPriceRow}>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    numberOfLines={1}
                    style={styles.recoPrice}>
                    {formatCurrency(price.price)}
                    <Text style={styles.recoUnit}>/L</Text>
                  </Text>
                  {recoDelta != null ? (
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.recoDelta,
                        recoDelta > 0 ? styles.recoDeltaUp : null,
                      ]}>
                      {recoDelta === 0
                        ? 'No change vs last bulletin'
                        : `${recoDelta < 0 ? '↘' : '↗'} ${formatCurrency(Math.abs(recoDelta))} vs last bulletin`}
                    </Text>
                  ) : null}
                </View>

                <Text numberOfLines={1} style={styles.recoBrand}>
                  {price.stationName}
                </Text>
                {recoSavingsLabel ? (
                  <Text style={styles.recoSavings}>{recoSavingsLabel}</Text>
                ) : price.isNearbyRecommended && price.distanceKm != null ? (
                  <Text style={styles.recoSavings}>
                    {formatDistanceKm(price.distanceKm)} away · community verified
                  </Text>
                ) : null}

                {price.runnersUp.length > 0 ? (
                  <View style={styles.recoList}>
                    {price.runnersUp.map((row) => (
                      <View key={`${row.rank}-${row.name}`} style={styles.recoListRow}>
                        <Text numberOfLines={1} style={styles.recoListName}>
                          {row.rank} · {row.name}
                        </Text>
                        <Text style={styles.recoListPrice}>{formatCurrency(row.price)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.recoActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Log refill at this price"
                    onPress={goToVehicles}
                    style={({ pressed }) => [styles.recoPrimaryBtn, pressed && styles.pressed]}>
                    <Ionicons name="add" size={15} color={GasTaColors.forestDark} />
                    <Text style={styles.recoPrimaryBtnText}>Log refill at this price</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="See all fuel prices"
                    onPress={goToPrices}
                    style={({ pressed }) => [styles.recoSecondaryBtn, pressed && styles.pressed]}>
                    <Text style={styles.recoSecondaryBtnText}>See all</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyLine}>No price recommendation yet</Text>
            )}

            {fuelFallbackNote ? (
              <Text style={styles.fuelNote}>{fuelFallbackNote}</Text>
            ) : null}
          </View>

          {/*
            AT A GLANCE. One call to fetchVehicles, no per-vehicle refill lookup.
            The last-refill figures come from the vehicle row's own cached
            columns, so nothing here is a second round trip. With no owned
            vehicle this collapses to one action instead of two empty cards.
          */}
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>At a glance</Text>
            {primaryVehicle ? (
              <View style={styles.glanceRow}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="View vehicles"
                  onPress={goToVehicles}
                  style={({ pressed }) => [styles.glanceCard, pressed && styles.pressed]}>
                  <View style={styles.glanceIcon}>
                    <Ionicons name="car-outline" size={15} color={GasTaColors.forest} />
                  </View>
                  <Text style={styles.glanceLabel}>Your vehicle</Text>
                  <Text numberOfLines={2} style={styles.glanceValue}>
                    {vehicleName}
                  </Text>
                  {primaryVehicle.fuel_efficiency_km_per_liter ? (
                    <Text numberOfLines={1} style={styles.glanceDetail}>
                      {primaryVehicle.fuel_efficiency_km_per_liter} km/L
                    </Text>
                  ) : null}
                </Pressable>

                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Log refill"
                  onPress={goToVehicles}
                  style={({ pressed }) => [styles.glanceCard, pressed && styles.pressed]}>
                  <View style={styles.glanceIcon}>
                    <Ionicons name="water-outline" size={15} color={GasTaColors.forest} />
                  </View>
                  <Text style={styles.glanceLabel}>Last refill price</Text>
                  {primaryVehicle.last_refill_price != null ? (
                    <>
                      <Text numberOfLines={1} style={styles.glanceValue}>
                        {formatCurrency(primaryVehicle.last_refill_price)}/L
                      </Text>
                      {primaryVehicle.last_refill_at ? (
                        <Text numberOfLines={1} style={styles.glanceDetail}>
                          {formatDate(primaryVehicle.last_refill_at)}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.glanceValue}>No refill yet</Text>
                      <Text numberOfLines={1} style={styles.glanceDetail}>
                        Log your first refill
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Add your first vehicle"
                onPress={goToVehicles}
                style={({ pressed }) => [styles.addVehicleCard, pressed && styles.pressed]}>
                <Ionicons name="add-circle-outline" size={16} color={GasTaColors.forest} />
                <Text style={styles.addVehicleText}>Add your first vehicle</Text>
                <Ionicons name="chevron-forward" size={14} color={GasTaColors.forest} />
              </Pressable>
            )}
          </View>

          {/*
            PENDING RESPONSIBILITY.

            A signal only, never an addition to the budget figures above: Home's
            spend is accepted allocations alone, and a share still awaiting a
            response is not yet a personal charge. Folding it in would make this
            screen disagree with the Budget page, which keeps the same separation.

            Rendered only when there is something to respond to, so the common
            case costs no vertical space.
          */}
          {pending && pending.count > 0 ? (
            <View style={styles.block}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Review pending refill responsibility"
                accessibilityHint="Opens your vehicles"
                onPress={goToVehicles}
                style={({ pressed }) => [styles.pendingCard, pressed && styles.pressed]}>
                <View style={styles.pendingIcon}>
                  <Ionicons name="hourglass-outline" size={15} color={palette.warning} />
                </View>
                <View style={styles.pendingText}>
                  <Text style={styles.pendingTitle}>Pending responsibility</Text>
                  <Text numberOfLines={1} style={styles.pendingHint}>
                    {pending.count === 1
                      ? '1 refill awaiting your response'
                      : `${pending.count} refills awaiting your response`}
                  </Text>
                </View>
                <Text style={styles.pendingValue}>{formatPeso(pending.total)}</Text>
                <Ionicons name="chevron-forward" size={14} color={GasTaColors.forestMuted} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.blockLast}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Recent</Text>
              {/*
                "View more" lives in the section header, in normal flow. It used
                to sit at the end of the list where it could land under the
                floating tab bar or the dev overlay; up here it is always visible
                and always clear of both.
              */}
              {canExpand ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAllRecent ? 'Show fewer activities' : `View ${hiddenCount} more activities`
                  }
                  hitSlop={8}
                  onPress={() => setShowAllRecent((v) => !v)}
                  style={({ pressed }) => [styles.sectionLink, pressed && styles.pressed]}>
                  <Text style={styles.sectionLinkText}>
                    {showAllRecent ? 'Show less' : `View ${hiddenCount} more`}
                  </Text>
                  <Ionicons
                    name={showAllRecent ? 'chevron-up' : 'chevron-forward'}
                    size={12}
                    color={GasTaColors.forest}
                  />
                </Pressable>
              ) : null}
            </View>

            {visibleActivities.length === 0 ? (
              <Text style={styles.emptyLine}>No recent activity yet.</Text>
            ) : (
              <>
                {visibleActivities.map((activity) => (
                  <View key={activity.id} style={styles.recentCard}>
                    <View
                      style={[
                        styles.recentIcon,
                        activity.icon === 'navigate-outline'
                          ? styles.recentIconTrip
                          : styles.recentIconReport,
                      ]}>
                      <Ionicons
                        name={activity.icon}
                        size={14}
                        color={
                          activity.icon === 'navigate-outline'
                            ? GasTaColors.forestDark
                            : GasTaColors.forest
                        }
                      />
                    </View>
                    <View style={styles.recentInfo}>
                      <Text numberOfLines={1} style={styles.recentTitle}>
                        {activity.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.recentDetail}>
                        {activity.secondary} · {activity.detail}
                      </Text>
                    </View>
                    {activity.badge && activity.badgeTone ? (
                      <Badge label={activity.badge} tone={activity.badgeTone} />
                    ) : null}
                  </View>
                ))}
              </>
            )}

            {canExpand || visibleActivities.length === 0 ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Plan a trip"
                hitSlop={8}
                onPress={goToTrip}
                style={({ pressed }) => [styles.planTripLink, pressed && styles.pressed]}>
                <Ionicons name="navigate-outline" size={12} color={GasTaColors.forest} />
                <Text style={styles.planTripText}>Plan a trip</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  /** Same cream as the scene, so overscroll never exposes a different shade. */
  scroll: { backgroundColor: GasTaColors.cream },
  /**
   * The centred dashboard shell. `maxWidth` is injected from useResponsive, so
   * on a phone this is full-bleed (the header reaches both edges) and on a
   * desktop it caps the whole dashboard, header included.
   *
   * It paints the canonical `cream` -- the same token Vehicles, Budget and
   * Profile show. That matters for more than looks: the shell is what fills the
   * viewport AND the reserved bottom padding, so keeping it on the canonical
   * tone is what stops a second shade appearing at the bottom while scrolling.
   */
  shell: {
    alignSelf: 'center',
    width: '100%',
    backgroundColor: GasTaColors.cream,
  },
  pressed: { opacity: 0.6 },

  /* ---- header ------------------------------------------------------------ */
  /** Transparent: the shell behind it is already the page cream. */
  header: { paddingTop: 10, paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /**
   * Tagline block. The wordmark is pinned with `flexShrink: 0` on its wrapper
   * (see BrandWordmark) so the tagline wraps instead of squeezing the logo.
   */
  tagline: { flexShrink: 1, alignItems: 'flex-end' },
  taglineLine: {
    color: GasTaColors.forestMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.6,
    textAlign: 'right',
  },
  /** Slightly tighter on narrow phones so both phrase-lines still fit beside the logo. */
  taglineLineNarrow: { fontSize: 9, lineHeight: 13, letterSpacing: 0.4 },
  /** The single emphasised run, in the theme's forest. No new hue, no navy. */
  taglineAccent: { color: GasTaColors.forest, fontWeight: '700' },
  greeting: {
    color: GasTaColors.forestDark,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 18,
  },
  headerDate: { color: GasTaColors.textMuted, fontSize: 13, lineHeight: 17, marginTop: 3 },

  /* ---- dashboard body ---------------------------------------------------- */
  /**
   * Deliberately NO backgroundColor.
   *
   * This block used to be `creamLight`, which painted an opaque, slightly
   * whiter panel over the rest of the page. Two consequences: it was a different
   * shade from the cream on Vehicles / Budget / Profile, and its top edge cut a
   * hard horizontal line across the screen just below the header -- the seam
   * that made the page look like two layers sliding past each other.
   *
   * Letting the shell's canonical cream through removes both problems, and
   * keeps this file consistent with the other migrated tabs, which leave their
   * root, ScrollView and content container transparent for the same reason.
   *
   * `flexGrow` is still required: it makes content shorter than the viewport
   * scrollable, so the last Recent row can travel above the floating tab bar.
   */
  body: {
    flexGrow: 1,
  },
  grid: { width: '100%' },

  sectionLabel: {
    color: GasTaColors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionLinkText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '700' },
  block: { marginTop: spacing.xl },
  blockLast: { marginTop: spacing.xl, marginBottom: spacing.md },

  /* ---- this month: the dark hero ----------------------------------------- */
  monthCard: {
    backgroundColor: GasTaColors.forestDark,
    borderRadius: 20,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  monthLabel: {
    color: ON_FOREST.label,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  monthHeadLink: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  monthHeadLinkText: { color: ON_FOREST.body, fontSize: 12, fontWeight: '700' },
  monthAmount: {
    color: GasTaColors.white,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 2,
  },
  monthSub: { color: ON_FOREST.sub, fontSize: 12, lineHeight: 17, marginTop: 1 },
  monthUnavailable: { color: ON_FOREST.sub, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  monthTrack: {
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: ON_FOREST.track,
    overflow: 'hidden',
    marginTop: spacing.sm + 2,
  },
  monthFill: { height: '100%', borderRadius: radii.pill },
  monthFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm + 2,
  },
  monthFootLeft: { color: ON_FOREST.body, fontSize: 13, fontWeight: '700' },
  /** The one warm pill in the hero -- the contextual primary action. */
  logRefillPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.cream,
  },
  logRefillPillText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '800' },

  /* ---- at a glance ------------------------------------------------------- */
  glanceRow: { flexDirection: 'row', gap: spacing.sm },
  glanceCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: GasTaColors.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    // Equal padding on both cards, and a capped name so a long vehicle cannot
    // make one card visibly taller than its neighbour.
    padding: spacing.sm + 2,
  },
  glanceIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.forestGlow,
    marginBottom: 6,
  },
  glanceLabel: {
    color: GasTaColors.textSoft,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  glanceValue: {
    color: GasTaColors.forestDark,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 1,
  },
  glanceDetail: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 15 },
  addVehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: GasTaColors.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.forestBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  addVehicleText: { flex: 1, color: GasTaColors.forestDark, fontSize: 14, fontWeight: '700' },

  /* ---- DOE recommendation (proposed layout, GasTa forest tokens) --------- */
  recoCard: {
    backgroundColor: GasTaColors.forestDark,
    borderRadius: 20,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
  },
  recoTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recoEyebrow: {
    flex: 1,
    minWidth: 0,
    color: ON_FOREST.fill,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  recoAgePill: {
    flexShrink: 0,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(248, 240, 229, 0.14)',
  },
  recoAgePillText: {
    color: ON_FOREST.body,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  recoPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm + 2,
  },
  recoPrice: {
    color: GasTaColors.white,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1,
    flexShrink: 1,
    minWidth: 0,
  },
  recoUnit: { fontSize: 15, fontWeight: '600', color: ON_FOREST.sub },
  recoDelta: {
    flexShrink: 1,
    maxWidth: 132,
    color: ON_FOREST.fill,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'right',
    paddingBottom: 4,
  },
  recoDeltaUp: { color: ON_FOREST.over },
  recoBrand: {
    color: GasTaColors.cream,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  recoSavings: {
    color: ON_FOREST.body,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 4,
  },
  recoList: {
    marginTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(248, 240, 229, 0.18)',
    paddingTop: spacing.sm + 2,
  },
  recoListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  recoListName: {
    flex: 1,
    minWidth: 0,
    color: ON_FOREST.sub,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  recoListPrice: {
    color: ON_FOREST.body,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  recoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md + 2,
  },
  recoPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.cream,
  },
  recoPrimaryBtnText: {
    color: GasTaColors.forestDark,
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  recoSecondaryBtn: {
    flexShrink: 0,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(248, 240, 229, 0.35)',
  },
  recoSecondaryBtnText: {
    color: GasTaColors.cream,
    fontSize: 12,
    fontWeight: '700',
  },
  /**
   * Qualifier under the recommendation card, shown only when the fuel is not
   * the vehicle's own. Muted so it reads as a footnote on the figure above.
   */
  fuelNote: {
    color: GasTaColors.forestMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.xs + 2,
  },

  /* ---- pending responsibility ---------------------------------------------- */
  /*
   * Warm-white row, matching every other Home card. The only colour cue is the
   * amber icon and value, so it reads as "needs a response" without becoming an
   * alarm or being mistaken for money already spent.
   */
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: GasTaColors.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.forestBorder,
  },
  pendingIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(180, 83, 9, 0.10)',
  },
  // minWidth 0 lets the text column shrink at 320px instead of pushing the
  // peso value and chevron off the row.
  pendingText: { flex: 1, minWidth: 0 },
  pendingTitle: {
    color: GasTaColors.forestDark,
    fontSize: 14,
    fontWeight: '700',
  },
  pendingHint: {
    color: GasTaColors.forestMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  pendingValue: {
    color: GasTaColors.forestDark,
    fontSize: 15,
    fontWeight: '800',
  },

  /* ---- recent ------------------------------------------------------------ */
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: GasTaColors.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  recentIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  recentIconTrip: { backgroundColor: GasTaColors.forestGlow },
  recentIconReport: { backgroundColor: GasTaColors.cream },
  recentInfo: { flex: 1, minWidth: 0 },
  recentTitle: { color: GasTaColors.forestDark, fontSize: 13, lineHeight: 17, fontWeight: '700' },
  recentDetail: { color: GasTaColors.textSoft, fontSize: 11, lineHeight: 15, marginTop: 1 },
  /** Quiet secondary action under Recent, in normal flow. */
  planTripLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  planTripText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '700' },

  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.sm, flexShrink: 0 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '700' },

  emptyLine: { color: GasTaColors.textMuted, fontSize: 13, lineHeight: 19 },
});
