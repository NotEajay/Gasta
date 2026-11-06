import { Ionicons } from '@expo/vector-icons';
import type { User } from '@supabase/supabase-js';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floatingNavContentInset } from '@/app/(tabs)/_layout';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import BrandWordmark from '@/components/ui/BrandWordmark';
import LoadingState from '@/components/ui/LoadingState';
import FuelInsightsPanel from '@/components/insights/FuelInsightsPanel';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { useResponsive } from '@/hooks/useResponsive';
import { getBulletinFreshness } from '@/lib/services/fuelPrices';
import {
  formatBulletinRange,
  formatCurrency,
  formatDate,
  formatPeso,
  transportModeLabel,
} from '@/lib/format';
import {
  DASHBOARD_FUEL_TYPE,
  DASHBOARD_REGION,
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

/** Legible supporting text on the dark fuel feature. */
const ON_FOREST = {
  label: '#D7E1EC',
  body: '#F3F6FA',
  sub: '#C1CEDC',
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
  const {
    contentMaxWidth,
    horizontalPadding,
    isDesktop,
    width: windowWidth,
  } = useResponsive();
  // Hooks stay above the loading/auth returns.
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
  const goToFuelHistory = useCallback((year: number, month: number) => {
    router.push({ pathname: '/(tabs)/budget', params: {
      view: 'history', year: String(year), month: String(month), insight_request: String(Date.now()),
    } });
  }, [router]);
  const insightNow = new Date();

  /**
   * Home uses the shared page shell. On a browser that is a wide dashboard
   * canvas (see `useResponsive`), still capped so it never stretches edge to
   * edge on an ultrawide display.
   */
  const homeMaxWidth = isDesktop ? contentMaxWidth : Math.min(windowWidth, 760);

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

  /**
   * Visible wordmark width. Measured, not guessed: this is the width of the
   * ARTWORK after the transparent margin is cropped, so the mark reads at roughly
   * 130px on a phone and caps at 168px on a desktop rather than upscaling a
   * raster past the point it stays crisp.
   */
  const brandLogoWidth = Math.round(
    Math.min(Math.max(windowWidth * 0.32, 116), 148)
  );

  // "31%" beside the headline. Derived from the same progress the bar uses, so
  // the two can never disagree. Only shown when there is a real limit.
  // Recommendation card copy — DOE-first "best this week" layout.
  const recoRegionLabel = price
    ? regionDisplayName(price.regionCode ?? DASHBOARD_REGION)
    : null;
  const recoUpdatedLabel =
    price?.source === 'doe' && price.bulletinDate
      ? formatBulletinRange(price.bulletinDate)
      : null;
  const recoFreshness =
    price?.source === 'doe' && price.bulletinDate
      ? getBulletinFreshness(price.bulletinDate)
      : null;
  const recoIsStale = recoFreshness?.status === 'stale';

  const recoDelta =
    price?.vsLastBulletin != null && Number.isFinite(price.vsLastBulletin)
      ? price.vsLastBulletin
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
  const budgetProgress = budget?.hasBudget && !budget.actualUnavailable ? budget.progress : null;
  const budgetProgressWidth = `${Math.round((budgetProgress ?? 0) * 100)}%` as `${number}%`;

  const budgetCard = (
    <Pressable testID="home-spending-card" accessibilityRole="button" accessibilityLabel="View budget"
      onPress={goToBudget} style={({ pressed }) => [styles.monthCard, pressed && styles.pressed]}>
      <View style={styles.monthHead}>
        <Text style={styles.monthLabel}>Your spending · {insightNow.toLocaleDateString('en-PH', { month: 'short' })}</Text>
        <View style={styles.inlineLink}><Text style={styles.sectionLinkText}>Budget</Text><Ionicons name="arrow-forward" size={14} color={GasTaColors.forest} /></View>
      </View>
      {budget && !budget.actualUnavailable ? <>
        <View style={styles.spendingFigures}>
          <View style={styles.fill}><Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={styles.monthAmount}>{formatPeso(budget.spent)}</Text>
            <Text style={styles.meta}>Recorded refill expenses</Text></View>
          <View style={styles.spendingRemaining}>
            {budget.hasBudget ? <><Text style={[styles.remainingAmount, budgetIsOver && { color: palette.danger }]}>{budgetHeadroom}</Text>
              <Text style={styles.meta}>{budgetIsOver ? 'over' : 'left of'} {budgetLimit}</Text></>
              : <Text style={styles.sectionLinkText}>Set a budget</Text>}
          </View>
        </View>
        {budget.hasBudget ? <View style={styles.monthTrack} accessibilityRole="progressbar" accessibilityLabel="Monthly budget used"
          accessibilityValue={{ min: 0, max: 100, now: Math.round((budgetProgress ?? 0) * 100) }}>
          <View style={[styles.monthFill, { width: budgetProgressWidth, backgroundColor: budgetIsOver ? palette.danger : GasTaColors.forest }]} />
        </View> : null}
      </> : <View style={styles.unavailableSpend}><Text style={styles.monthUnavailable}>Spending unavailable</Text>
        <Text style={styles.meta}>Open Budget to review your recorded refills.</Text></View>}
    </Pressable>
  );

  const quickActions = (
    <View testID="home-quick-actions" style={styles.quickActions}>
      {[
        { label: 'Plan a trip', icon: 'navigate-outline' as const, onPress: goToTrip },
        { label: 'Log refill', icon: 'water-outline' as const, onPress: goToVehicles },
      ].map((item) => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label}
        onPress={item.onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
        <Ionicons name={item.icon} size={20} color={GasTaColors.forest} />
        <Text style={styles.quickLabel}>{item.label}</Text>
        <Ionicons name="arrow-forward" size={14} color={GasTaColors.textMuted} />
      </Pressable>)}
    </View>
  );

  const insightPreview = (
    <FuelInsightsPanel userId={user.id} year={insightNow.getFullYear()} month={insightNow.getMonth() + 1}
      compact highlight onViewHistory={goToFuelHistory} />
  );

  const pricePreview = (
    <View testID="home-fuel-feature" style={styles.fuelFeature}>
      <View style={styles.fuelTop}>
        <Text style={styles.fuelEyebrow}>FUEL PRICE WATCH</Text>
        {price ? <View style={styles.fuelSourceBadge}>
          <Ionicons name={price.source === 'community' ? 'shield-checkmark-outline' : 'document-text-outline'} size={13} color={GasTaColors.white} />
          <Text style={styles.fuelSource}>{price.source === 'doe' ? 'DOE bulletin estimate' : 'Verified community price'}</Text>
        </View> : null}
      </View>
      {price ? <>
        <Text style={styles.fuelScope}>{fuelDisplayName(price.fuelCode)} · {price.isRegionFallback ? `${recoRegionLabel} reference` : recoRegionLabel}</Text>
        <View style={styles.fuelPriceRow}>
          <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={styles.fuelPrice}>{formatCurrency(price.price)}<Text style={styles.fuelUnit}> /L</Text></Text>
          {recoDelta != null ? <View style={styles.fuelDelta}>
            <Ionicons name={recoDelta < 0 ? 'trending-down' : recoDelta > 0 ? 'trending-up' : 'remove'} size={18}
              color={recoDelta < 0 ? GasTaColors.accent : recoDelta > 0 ? ON_FOREST.over : ON_FOREST.body} />
            <Text style={[styles.fuelDeltaValue, { color: recoDelta < 0 ? GasTaColors.accent : recoDelta > 0 ? ON_FOREST.over : ON_FOREST.body }]}>
              {recoDelta === 0 ? 'No change' : `${recoDelta > 0 ? '+' : '−'}${formatCurrency(Math.abs(recoDelta))}/L`}
            </Text>
            <Text style={styles.fuelDeltaCaption}>vs last bulletin</Text>
          </View> : null}
        </View>
        <Text style={styles.fuelStation}>{price.stationName}</Text>
        {price.isNearbyRecommended && price.distanceKm != null ? <Text style={styles.fuelDetail}>{formatDistanceKm(price.distanceKm)} away</Text> : null}
        <View style={styles.fuelMetadata}>
          {recoUpdatedLabel ? <Text style={styles.fuelDetail}>{recoUpdatedLabel}</Text> : null}
          {recoFreshness ? <Text style={[styles.fuelFreshness, recoIsStale && styles.fuelStale]}>{recoFreshness.label}</Text> : null}
        </View>
        {fuelFallbackNote ? <Text style={styles.fuelFallback}>{fuelFallbackNote}</Text> : null}
      </> : <View style={styles.fuelEmpty}>
        <Text style={styles.fuelEmptyTitle}>Know before{ '\n' }you fill up.</Text>
        <Text style={styles.fuelDetail}>Explore regional bulletins and verified community prices. No recommendation is available yet.</Text>
      </View>}
      <Pressable accessibilityRole="button" accessibilityLabel={price ? 'See all fuel prices' : 'Browse fuel prices'}
        onPress={goToPrices} style={({ pressed }) => [styles.compareAction, pressed && styles.pressed]}>
        <Text style={styles.compareLabel}>Compare fuel prices</Text><Ionicons name="arrow-forward" size={19} color={GasTaColors.forestDark} />
      </Pressable>
    </View>
  );

  const vehiclePreview = (
    <Pressable accessibilityRole="button" accessibilityLabel={primaryVehicle ? 'View vehicles and last refill' : 'Add your first vehicle'}
      onPress={goToVehicles} style={({ pressed }) => [styles.vehicleCard, pressed && styles.pressed]}>
      <View style={styles.priceIcon}><Ionicons name={primaryVehicle ? 'car-outline' : 'add-outline'} size={22} color={GasTaColors.forest} /></View>
      <View style={styles.fill}>
        <Text style={styles.meta}>{primaryVehicle ? 'Your vehicle' : 'Your garage'}</Text>
        <Text style={styles.vehicleName} numberOfLines={2}>{vehicleName || 'Add your first vehicle'}</Text>
        {primaryVehicle?.fuel_efficiency_km_per_liter ? <Text style={styles.meta}>{primaryVehicle.fuel_efficiency_km_per_liter} km/L</Text> : null}
      </View>
      {primaryVehicle ? <View style={styles.vehicleRefill}>
        <Text style={styles.meta}>Last refill</Text>
        <Text style={styles.vehicleRefillValue}>{primaryVehicle.last_refill_price != null ? `${formatCurrency(primaryVehicle.last_refill_price)}/L` : 'Not logged'}</Text>
        {primaryVehicle.last_refill_at ? <Text style={styles.meta}>{formatDate(primaryVehicle.last_refill_at)}</Text> : null}
      </View> : <Ionicons name="chevron-forward" size={16} color={GasTaColors.textMuted} />}
    </Pressable>
  );

  const recentActivity = (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Recent activity</Text>
        {canExpand ? <Pressable accessibilityRole="button"
          accessibilityLabel={showAllRecent ? 'Show fewer activities' : `View ${hiddenCount} more activities`}
          onPress={() => setShowAllRecent((value) => !value)} style={styles.textAction}>
          <Text style={styles.sectionLinkText}>{showAllRecent ? 'Show less' : 'View more'}</Text>
        </Pressable> : null}
      </View>
      <View style={styles.recentList}>
        {visibleActivities.length === 0 ? <Text style={styles.emptyLine}>Your trips and price reports will appear here.</Text> : visibleActivities.map((activity) => (
          <View key={activity.id} style={styles.recentRow}>
            <View style={styles.recentIcon}><Ionicons name={activity.icon} size={18} color={GasTaColors.forest} /></View>
            <View style={styles.fill}>
              <Text style={styles.recentTitle}>{activity.title}</Text>
              <Text style={styles.meta}>{activity.secondary} · {activity.detail}</Text>
            </View>
            {activity.badge && activity.badgeTone ? <Badge label={activity.badge} tone={activity.badgeTone} /> : null}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.shell, {
      maxWidth: homeMaxWidth, paddingHorizontal: isDesktop ? horizontalPadding : 20,
      paddingBottom: isDesktop ? spacing.xl : floatingNavContentInset(insets.bottom),
    }]} onScroll={tabBarScrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {!isDesktop ? <BrandWordmark width={brandLogoWidth} /> : <Text style={styles.dashboardLabel}>YOUR DASHBOARD</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Open your profile" hitSlop={4}
            onPress={() => router.navigate('/(tabs)/profile')} style={({ pressed }) => [styles.profileAction, pressed && styles.pressed]}>
            <Ionicons name="person-outline" size={20} color={GasTaColors.forestDark} />
          </Pressable>
        </View>
        <Text style={styles.greeting} numberOfLines={2}>{getGreeting()}, {firstName}</Text>
      </View>
      <View style={[styles.dashboardGrid, isDesktop && styles.dashboardGridDesktop]}>
        <View style={[styles.mainColumn, isDesktop && styles.mainColumnDesktop]}>
          {pricePreview}
          {quickActions}
          {isDesktop ? recentActivity : null}
        </View>
        <View style={[styles.sideColumn, isDesktop && styles.sideColumnDesktop]}>
          {budgetCard}
          <View style={styles.insightsSection}>{insightPreview}</View>
          {vehiclePreview}
          {pending && pending.count > 0 ? <Pressable accessibilityRole="button"
            accessibilityLabel="Review pending refill responsibility" onPress={goToVehicles}
            style={({ pressed }) => [styles.pendingCard, pressed && styles.pressed]}>
            <Ionicons name="hourglass-outline" size={20} color={palette.warning} />
            <View style={styles.fill}><Text style={styles.pendingTitle}>{pending.count} pending refill{pending.count === 1 ? '' : 's'}</Text>
              <Text style={styles.meta}>Review your share</Text></View>
            <Text style={styles.pendingValue}>{formatPeso(pending.total)}</Text>
            <Ionicons name="chevron-forward" size={14} color={GasTaColors.textMuted} />
          </Pressable> : null}
          {!isDesktop ? recentActivity : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { flex: 1, minWidth: 0 },
  scroll: { flex: 1, backgroundColor: GasTaColors.cream },
  shell: { width: '100%', alignSelf: 'center', paddingTop: 12 },
  header: { marginBottom: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  profileAction: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, backgroundColor: GasTaColors.white },
  dashboardLabel: { color: GasTaColors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  greeting: { color: GasTaColors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.6, marginTop: 12 },
  dashboardGrid: { width: '100%' },
  dashboardGridDesktop: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  mainColumn: { minWidth: 0, width: '100%' },
  mainColumnDesktop: { flex: 1.2, width: undefined },
  sideColumn: { minWidth: 0, marginTop: 20, width: '100%' },
  sideColumnDesktop: { flex: 1, marginTop: 0, width: undefined },
  monthCard: { borderRadius: 18, padding: 16, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  monthLabel: { color: GasTaColors.textMuted, fontSize: 12, fontWeight: '600' },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  spendingFigures: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  spendingRemaining: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  remainingAmount: { color: GasTaColors.textPrimary, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  monthAmount: { fontSize: 28, lineHeight: 34, color: GasTaColors.forestDark, fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  monthTrack: { height: 4, backgroundColor: GasTaColors.glassBorderSubtle, borderRadius: radii.pill, overflow: 'hidden', marginTop: 14 },
  monthFill: { height: '100%', borderRadius: radii.pill },
  monthUnavailable: { color: GasTaColors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  unavailableSpend: { paddingTop: 14 },
  quickActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  quickAction: { flex: 1, minWidth: 0, minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, borderRadius: 16 },
  quickLabel: { flexShrink: 1, color: GasTaColors.textPrimary, fontSize: 13, fontWeight: '600' },
  fuelFeature: { borderRadius: 26, padding: 20, backgroundColor: GasTaColors.forestDark },
  fuelTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fuelEyebrow: { color: ON_FOREST.label, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  fuelSourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  fuelSource: { color: ON_FOREST.body, fontSize: 10, fontWeight: '500' },
  fuelScope: { color: ON_FOREST.body, fontSize: 13, lineHeight: 19, marginTop: 20 },
  fuelPriceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 4 },
  fuelPrice: { flexShrink: 1, color: GasTaColors.white, fontSize: 52, lineHeight: 64, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  fuelUnit: { color: ON_FOREST.label, fontSize: 18, fontWeight: '500', letterSpacing: 0 },
  fuelDelta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  fuelDeltaValue: { fontSize: 12, fontWeight: '600' },
  fuelDeltaCaption: { color: ON_FOREST.sub, fontSize: 10 },
  fuelStation: { color: GasTaColors.white, fontSize: 16, fontWeight: '600', marginTop: 5 },
  fuelDetail: { color: ON_FOREST.sub, fontSize: 11, lineHeight: 17 },
  fuelMetadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' },
  fuelFreshness: { color: ON_FOREST.label, fontSize: 10, fontWeight: '600' },
  fuelStale: { color: '#FFD28A' },
  fuelFallback: { color: ON_FOREST.sub, fontSize: 11, lineHeight: 17, marginTop: 6 },
  fuelEmpty: { paddingVertical: 20, gap: 10 },
  fuelEmptyTitle: { color: GasTaColors.white, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8 },
  compareAction: { minHeight: 48, paddingHorizontal: 16, marginTop: 20, borderRadius: 14, backgroundColor: GasTaColors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  compareLabel: { color: GasTaColors.forestDark, fontSize: 13, fontWeight: '700' },
  insightsSection: { marginTop: 20 },
  section: { marginTop: 20 },
  sectionHead: { minHeight: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 },
  sectionTitle: { color: GasTaColors.textPrimary, fontSize: 16, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2 },
  textAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 40, gap: 5, paddingHorizontal: 4 },
  sectionLinkText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '600' },
  priceIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: GasTaColors.forestGlow },
  meta: { color: GasTaColors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  vehicleCard: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, borderRadius: 18, marginTop: 20 },
  vehicleName: { color: GasTaColors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 3 },
  vehicleRefill: { alignItems: 'flex-end', maxWidth: '44%' },
  vehicleRefillValue: { color: GasTaColors.forestDark, fontSize: 14, fontWeight: '700', marginTop: 3 },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 16, backgroundColor: '#FFF7E9', marginTop: 16 },
  pendingTitle: { color: GasTaColors.textPrimary, fontSize: 13, fontWeight: '600' },
  pendingValue: { color: GasTaColors.textPrimary, fontSize: 14, fontWeight: '700' },
  recentList: { borderRadius: 18, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, overflow: 'hidden' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GasTaColors.glassBorderSubtle },
  recentIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: GasTaColors.forestGlow },
  recentTitle: { color: GasTaColors.textPrimary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, maxWidth: 88 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  emptyLine: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 18, padding: 16 },
  pressed: { opacity: 0.65 },
});
