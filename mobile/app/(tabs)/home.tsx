import { Ionicons } from '@expo/vector-icons';
import type { User } from '@supabase/supabase-js';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import LoadingState from '@/components/ui/LoadingState';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { useResponsive } from '@/hooks/useResponsive';
import { formatCurrency, formatDate, formatPeso, transportModeLabel } from '@/lib/format';
import {
  DASHBOARD_FUEL_TYPE,
  fetchDashboardBudgetSummary,
  fetchDashboardPriceSummary,
  fetchRecentUserReports,
  type DashboardBudgetSummary,
  type DashboardPriceSummary,
  type DashboardReport,
} from '@/lib/services/dashboard';
import { fetchRecentTrips } from '@/lib/services/trips';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { TripRecord } from '@/types/mcda';

/** Branded Home banner. The asset already carries the GasTa logo + wordmark. */
const homeHeaderImage = require('@/assets/images/homeheader.png');

/** Rhythm between major sections, and the single padding value inside a surface. */
const SECTION_GAP = 28;
const SURFACE_PAD = 20;

type HomeActivityIcon = 'navigate-outline' | 'pricetag-outline';
type HomeActivityTone = 'pending' | 'verified' | 'rejected' | 'review' | 'neutral';

type HomeActivity = {
  id: string;
  createdAt: string;
  title: string;
  secondary: string;
  detail: string;
  icon: HomeActivityIcon;
  statusLabel?: string;
  statusTone?: HomeActivityTone;
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
  verified: HomeColors.primaryDark,
  rejected: palette.danger,
  review: HomeColors.navy,
  neutral: HomeColors.muted,
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
function StatusNote({ label, tone }: { label: string; tone: HomeActivityTone }) {
  const color = STATUS_TONES[tone];
  return (
    <View style={styles.statusNote}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.statusText, { color }]}>
        {label}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { width: windowWidth } = useResponsive();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [price, setPrice] = useState<DashboardPriceSummary | null>(null);
  const [budget, setBudget] = useState<DashboardBudgetSummary | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [reports, setReports] = useState<DashboardReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const now = new Date();
    const [nextPrice, nextBudget, nextTrips, nextReports] = await Promise.all([
      fetchDashboardPriceSummary().catch(() => null),
      fetchDashboardBudgetSummary(user.id, now.getFullYear(), now.getMonth() + 1).catch(() => null),
      fetchRecentTrips(user.id, 8).catch(() => [] as TripRecord[]),
      fetchRecentUserReports(user.id, 8).catch(() => [] as DashboardReport[]),
    ]);

    setPrice(nextPrice);
    setBudget(nextBudget);
    setTrips(nextTrips);
    setReports(nextReports);
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
      detail: `${transportModeLabel(record.recommended_mode_code)} recommended`,
      icon: 'navigate-outline' as const,
    }));
    const reportItems = reports.map((report) => {
      const status = reportStatusBadge(report.status);
      return {
        id: `report-${report.id}`,
        createdAt: report.createdAt,
        title: 'Price report submitted',
        secondary: report.stationName,
        detail: `${report.fuelTypeName} · ${formatCurrency(report.price)}/L`,
        icon: 'pricetag-outline' as const,
        statusLabel: status.label,
        statusTone: status.tone,
      };
    });

    return [...tripItems, ...reportItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [reports, trips]);

  // Navigation handlers must be declared with the other hooks, above the early
  // returns below — hooks after a conditional return change the hook order.
  const goToPrices = useCallback(() => router.push('/(tabs)/prices'), [router]);
  const goToTrip = useCallback(() => router.push('/(tabs)/trip'), [router]);

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

  // ~84% of the 2:1 artwork stays visible on phones, so the wordmark is never cropped.
  const bannerHeight = Math.round(Math.min(windowWidth * 0.42, 210));

  // Reuses the existing fuel-type constant instead of duplicating "RON 91".
  const priceHeading = `Cheapest ${DASHBOARD_FUEL_TYPE.replace('_', ' ')} nearby`;

  // Attribution only. The existing summary carries no timestamp, so none is invented.
  const priceSource = price
    ? price.source === 'community'
      ? 'Community verified'
      : 'DOE bulletin'
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
        : HomeColors.primary;

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: HomeColors.background }]}
      contentContainerStyle={styles.content}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}>
      <View style={styles.bannerWrap}>
        <Image
          accessibilityLabel="GasTa"
          accessibilityRole="image"
          source={homeHeaderImage}
          resizeMode="cover"
          style={[styles.banner, { height: bannerHeight }]}
        />
      </View>

      <View style={styles.greeting}>
        <Text style={styles.greetingTitle} numberOfLines={2}>
          {getGreeting()}, {firstName} 👋
        </Text>
        <Text style={styles.greetingSub}>Here's your fuel overview for today.</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.surface}>
          <Text style={styles.surfaceLabel}>{priceHeading}</Text>
          {price ? (
            <>
              <View style={styles.priceLine}>
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  numberOfLines={1}
                  style={styles.priceValue}>
                  {formatCurrency(price.price)}
                  <Text style={styles.priceUnit}>/L</Text>
                </Text>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="View fuel prices"
                  hitSlop={10}
                  onPress={goToPrices}
                  style={({ pressed }) => [styles.inlineLink, pressed && styles.inlineLinkPressed]}>
                  <Text numberOfLines={1} style={styles.inlineLinkText}>
                    View prices
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={HomeColors.primary} />
                </Pressable>
              </View>
              <Text numberOfLines={1} style={styles.stationName}>
                {price.stationName}
              </Text>
              <Text numberOfLines={1} style={styles.stationMeta}>
                {price.location}
              </Text>
              {priceSource ? (
                <Text numberOfLines={1} style={styles.sourceMeta}>
                  {priceSource}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.emptyLine}>No price data yet</Text>
          )}

          <View style={styles.divider} />

          <Text style={styles.surfaceLabel}>Fuel budget</Text>
          {budget?.hasBudget ? (
            budget.actualUnavailable ? (
              // Never claim a zero we could not verify.
              <Text style={styles.emptyLine}>Refill spending unavailable</Text>
            ) : (
              <>
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  numberOfLines={1}
                  style={[styles.budgetValue, budgetIsOver && styles.budgetValueOver]}>
                  {budgetHeadroom} {budgetIsOver ? 'over' : 'left'}
                </Text>
                <Text numberOfLines={1} style={styles.budgetMeta}>
                  of {budgetLimit} this month
                </Text>
                {budgetProgress === null ? null : (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: budgetProgressWidth, backgroundColor: budgetFillColor },
                      ]}
                    />
                  </View>
                )}
                <Text numberOfLines={1} style={styles.budgetSpent}>
                  {budgetSpent} spent
                </Text>
              </>
            )
          ) : budget?.actualUnavailable ? (
            <Text style={styles.emptyLine}>Refill spending unavailable</Text>
          ) : (
            <>
              <Text style={styles.emptyLine}>No monthly budget set</Text>
              {budget ? (
                <Text numberOfLines={1} style={styles.budgetSpent}>
                  {formatPeso(budget.spent)} actual refill spending
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Quick actions</Text>
        <View style={styles.actionGrid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Find prices"
            onPress={goToPrices}
            style={({ pressed }) => [
              styles.actionTile,
              styles.actionTileFuel,
              pressed && styles.actionTilePressed,
            ]}>
            <View style={styles.actionTileIcon}>
              <Ionicons name="location-outline" size={20} color={HomeColors.primary} />
            </View>
            <Text numberOfLines={2} style={styles.actionTileLabel}>
              Find fuel prices
            </Text>
            <Text numberOfLines={2} style={styles.actionTileHint}>
              Compare prices in your area
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan a trip"
            onPress={goToTrip}
            style={({ pressed }) => [
              styles.actionTile,
              styles.actionTileTrip,
              pressed && styles.actionTilePressed,
            ]}>
            <View style={styles.actionTileHeader}>
              <View style={styles.actionTileIcon}>
                <Ionicons name="navigate-outline" size={20} color={HomeColors.navy} />
              </View>
              <Text numberOfLines={2} style={styles.actionTileLabel}>
                Plan a trip
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.actionTileHint}>
              Estimate route and fuel cost
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionLast}>
        <Text style={styles.sectionLabel}>Recent activity</Text>
        {activities.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyLine}>No recent activity yet</Text>
            <Text style={styles.emptyMessage}>
              Logged trips and submitted price reports will appear here.
            </Text>
          </View>
        ) : (
          <>
            {activities.map((activity, index) => {
              // Existing data already tags each entry as a trip or a report.
              const isTrip = activity.icon === 'navigate-outline';
              const isLast = index === activities.length - 1;

              return (
                <View key={activity.id} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    <View
                      style={[
                        styles.timelineMarker,
                        isTrip ? styles.markerTrip : styles.markerReport,
                      ]}>
                      <Ionicons
                        name={activity.icon}
                        size={14}
                        color={isTrip ? HomeColors.navy : HomeColors.primary}
                      />
                    </View>
                    {isLast ? null : <View style={styles.timelineLine} />}
                  </View>

                  <View style={styles.timelineContent}>
                    <View style={styles.activityHead}>
                      <Text numberOfLines={1} style={styles.activityTitle}>
                        {activity.title}
                      </Text>
                      {activity.statusLabel && activity.statusTone ? (
                        <StatusNote label={activity.statusLabel} tone={activity.statusTone} />
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.activitySecondary}>
                      {activity.secondary}
                    </Text>
                    <Text numberOfLines={1} style={styles.activityDetail}>
                      {activity.detail}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  bannerWrap: {
    marginHorizontal: -spacing.lg,
    backgroundColor: HomeColors.background,
  },
  banner: {
    width: '100%',
  },
  greeting: {
    marginTop: spacing.xl,
    marginBottom: SECTION_GAP,
  },
  greetingTitle: {
    color: HomeColors.navy,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  greetingSub: {
    color: HomeColors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  /** The single white surface per section. Hairline border only — no shadow. */
  surface: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    paddingHorizontal: SURFACE_PAD,
    paddingVertical: SURFACE_PAD,
  },
  section: {
    marginBottom: SECTION_GAP,
  },
  /** The final section needs no trailing gap before the floating nav. */
  sectionLast: {
    marginBottom: 0,
  },
  sectionLabel: {
    color: HomeColors.navy,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  surfaceLabel: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HomeColors.border,
    marginVertical: spacing.lg,
  },
  priceLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.md,
  },
  priceValue: {
    flexShrink: 1,
    color: HomeColors.primary,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  priceUnit: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  stationName: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  stationMeta: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  sourceMeta: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.sm,
  },
  emptyLine: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  emptyMessage: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  inlineLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  inlineLinkPressed: {
    opacity: 0.55,
  },
  inlineLinkText: {
    color: HomeColors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  budgetValue: {
    color: HomeColors.navy,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: spacing.xs,
  },
  budgetValueOver: {
    color: palette.danger,
  },
  budgetMeta: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  budgetSpent: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  progressTrack: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: HomeColors.primarySoft,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: HomeColors.primary,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  /**
   * Two standalone shortcuts rather than rows in one white card. Each tile has
   * its own tint and border so they read as separate, tappable objects.
   */
  actionTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  actionTileFuel: {
    backgroundColor: HomeColors.primarySoft,
    borderColor: HomeColors.primaryBorder,
    gap: spacing.sm,
  },
  /** Different rhythm: label sits beside the icon, hint is pushed to the bottom. */
  actionTileTrip: {
    backgroundColor: HomeColors.navySoft,
    borderColor: HomeColors.border,
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionTilePressed: {
    opacity: 0.7,
  },
  actionTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionTileIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    // White chip on the tinted tile gives depth without a new colour token.
    backgroundColor: GasTaColors.white,
  },
  actionTileLabel: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  actionTileHint: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyBlock: {
    backgroundColor: HomeColors.navySoft,
    borderRadius: radii.md,
    paddingHorizontal: SURFACE_PAD,
    paddingVertical: spacing.lg,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  /** Fixed-width rail so every entry's text starts on the same vertical line. */
  timelineRail: {
    width: 28,
    alignItems: 'center',
  },
  timelineMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerTrip: {
    backgroundColor: HomeColors.navySoft,
  },
  markerReport: {
    backgroundColor: HomeColors.primarySoft,
  },
  /** Stretches to the row height, joining each marker to the next one. */
  timelineLine: {
    flex: 1,
    width: StyleSheet.hairlineWidth,
    backgroundColor: HomeColors.border,
    marginTop: spacing.xs,
  },
  timelineContent: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.md,
  },
  activityHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activityTitle: {
    flexShrink: 1,
    color: HomeColors.navy,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  activitySecondary: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  activityDetail: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  statusNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
});
