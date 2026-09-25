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
import { BrandColors, radii, shadow, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatCurrency, formatDate, transportModeLabel } from '@/lib/format';
import {
  fetchDashboardBudgetSummary,
  fetchDashboardPriceSummary,
  fetchRecentUserReports,
  type DashboardBudgetSummary,
  type DashboardPriceSummary,
  type DashboardReport,
} from '@/lib/services/dashboard';
import { fetchRecentTrips } from '@/lib/services/trips';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { TripRecord } from '@/types/mcda';

type HomeActivityIcon = 'navigate-outline' | 'pricetag-outline';

type HomeActivity = {
  id: string;
  createdAt: string;
  title: string;
  subtitle: string;
  icon: HomeActivityIcon;
};

function getDisplayName(user: User): string {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }
  return user.email?.split('@')[0] || 'GasTa user';
}

function getGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
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

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
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
      subtitle: `${formatDate(record.created_at)} · ${transportModeLabel(record.recommended_mode_code)} recommended`,
      icon: 'navigate-outline' as const,
    }));
    const reportItems = reports.map((report) => ({
      id: `report-${report.id}`,
      createdAt: report.createdAt,
      title: 'Price report submitted',
      subtitle: `${report.stationName} · ${report.fuelTypeName} · ${formatCurrency(report.price)}/L · ${reportStatusLabel(report.status)}`,
      icon: 'pricetag-outline' as const,
    }));

    return [...tripItems, ...reportItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [reports, trips]);

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
  const priceValue = price ? `${formatCurrency(price.price)}/L` : 'No price data yet';
  const priceMeta = price
    ? price.source === 'community'
      ? `${price.stationName} · ${price.location}`
      : `${price.stationName} · DOE bulletin · ${price.location}`
    : 'NCR · RON 91';
  const budgetValue = budget?.hasBudget ? formatCurrency(budget.remaining) : 'No budget set';
  const budgetMeta = budget?.hasBudget
    ? `of ${formatCurrency(budget.limitAmount)} total`
    : 'No budget set for this month';

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image
            accessibilityLabel="GasTa logo"
            source={require('@/assets/images/gasta-logo.png')}
            resizeMode="contain"
            style={styles.logoImage}
          />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>
              <Text style={styles.brandPrimary}>Gas</Text>
              <Text style={styles.brandNavy}>ta!</Text>
            </Text>
            <Text style={styles.greeting}>
              {getGreeting()}, {firstName}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.statGrid}>
        <View style={[styles.statCard, shadow(theme.scheme, 'sm')]}>
          <View style={styles.statLabelRow}>
            <View style={styles.statIconGreen}>
              <Ionicons name="pricetag" size={15} color={HomeColors.primary} />
            </View>
            <Text style={styles.statLabel}>Cheapest RON 91 nearby</Text>
          </View>
          <Text style={[styles.statValue, { color: HomeColors.primary }, !price && styles.emptyValue]}>
            {priceValue}
          </Text>
          <Text style={styles.statMeta} numberOfLines={2}>
            {priceMeta}
          </Text>
        </View>

        <View style={[styles.statCard, shadow(theme.scheme, 'sm')]}>
          <View style={styles.statLabelRow}>
            <View style={styles.statIconNavy}>
              <Ionicons name="wallet-outline" size={15} color={BrandColors.navy} />
            </View>
            <Text style={styles.statLabel}>Budget left this month</Text>
          </View>
          <Text style={[styles.statValue, { color: BrandColors.navy }, !budget?.hasBudget && styles.emptyValue]}>
            {budgetValue}
          </Text>
          <Text style={styles.statMeta} numberOfLines={2}>
            {budgetMeta}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find prices"
          onPress={() => router.push('/(tabs)/prices')}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}>
          <Ionicons name="location-outline" size={20} color={HomeColors.primary} />
          <Text style={styles.actionText}>Find prices</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Plan a trip"
          onPress={() => router.push('/(tabs)/trip')}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}>
          <Ionicons name="navigate-outline" size={20} color={HomeColors.primary} />
          <Text style={styles.actionText}>Plan a trip</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Recent activity</Text>
      {activities.length === 0 ? (
        <View style={styles.emptyActivity}>
          <Ionicons name="time-outline" size={22} color={theme.textMuted} />
          <Text style={styles.emptyTitle}>No recent activity yet</Text>
          <Text style={styles.emptyMessage}>Logged trips and submitted price reports will appear here.</Text>
        </View>
      ) : (
        <View style={styles.activityCard}>
          {activities.map((activity, index) => (
            <View
              key={activity.id}
              style={[styles.activityRow, index < activities.length - 1 && styles.activityDivider]}>
              <View style={styles.activityIcon}>
                <Ionicons name={activity.icon} size={19} color={HomeColors.primary} />
              </View>
              <View style={styles.activityCopy}>
                <Text style={styles.activityTitle} numberOfLines={1}>
                  {activity.title}
                </Text>
                <Text style={styles.activitySubtitle} numberOfLines={2}>
                  {activity.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logoImage: {
    width: 44,
    height: 44,
    marginRight: spacing.md,
  },
  brandCopy: { flex: 1 },
  brandName: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  brandPrimary: { color: HomeColors.primary },
  brandNavy: { color: BrandColors.navy },
  greeting: {
    color: BrandColors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  statGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 154,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: BrandColors.white,
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  statIconGreen: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.primarySoft,
    marginRight: spacing.xs,
  },
  statIconNavy: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.navySoft,
    marginRight: spacing.xs,
  },
  statLabel: {
    flex: 1,
    color: BrandColors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  statValue: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: spacing.md,
  },
  emptyValue: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  statMeta: {
    color: BrandColors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  sectionLabel: {
    color: BrandColors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  actionButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: HomeColors.primaryBorder,
    backgroundColor: BrandColors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionPressed: {
    backgroundColor: HomeColors.primarySoft,
    opacity: 0.9,
  },
  actionText: {
    color: BrandColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  emptyActivity: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: BrandColors.white,
  },
  emptyTitle: {
    color: BrandColors.navy,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  emptyMessage: {
    color: BrandColors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  activityCard: {
    borderRadius: radii.md,
    backgroundColor: BrandColors.white,
    paddingHorizontal: spacing.md,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  activityDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.border,
  },
  activityIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.primarySoft,
    marginRight: spacing.md,
  },
  activityCopy: { flex: 1, minWidth: 0 },
  activityTitle: {
    color: BrandColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  activitySubtitle: {
    color: BrandColors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});

