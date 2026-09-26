import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import { HomeColors } from '@/constants/home';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate, transportModeLabel } from '@/lib/format';
import { fetchTripsForVehicle } from '@/lib/services/trips';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { TripRecord } from '@/types/mcda';

function ownVehicleFuelCost(record: TripRecord): number | null {
  const own = record.mode_evaluations.find((evaluation) => evaluation.modeCode === 'OWN_VEHICLE');
  return own?.raw.fuelCost ?? null;
}

/** True when the trip has real location labels, so distance is not already the route. */
function hasRouteLabels(record: TripRecord): boolean {
  return Boolean(record.origin_label || record.destination_label);
}

function routeLabel(record: TripRecord): string {
  if (hasRouteLabels(record)) {
    return `${record.origin_label ?? '…'} → ${record.destination_label ?? '…'}`;
  }
  return `${record.distance_km} km`;
}

export default function SharedVehicleHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{
    vehicleId?: string;
    vehicleLabel?: string;
  }>();
  const vehicleId = typeof params.vehicleId === 'string' ? params.vehicleId : '';
  const vehicleLabel =
    typeof params.vehicleLabel === 'string' && params.vehicleLabel.trim()
      ? params.vehicleLabel
      : 'Shared vehicle';
  const [records, setRecords] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured || !vehicleId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      setRecords(await fetchTripsForVehicle(vehicleId));
    } catch (e) {
      // Surfaced in the list, so a failure is never mistaken for "no trips".
      setRecords([]);
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user, vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  const renderItem = useCallback(({ item }: { item: TripRecord }) => {
    const fuel = ownVehicleFuelCost(item);
    // routeLabel already falls back to the distance, so only repeat it when a
    // real origin/destination pair exists.
    const showDistance = hasRouteLabels(item);

    return (
      <View style={styles.card}>
        <Text numberOfLines={1} style={styles.date}>
          {formatDate(item.created_at)}
        </Text>
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.route}>
          {routeLabel(item)}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaGroup}>
            <View style={styles.metaItem}>
              <Ionicons name="navigate-outline" size={14} color={HomeColors.muted} />
              <Text numberOfLines={1} style={styles.metaText}>
                {transportModeLabel(item.recommended_mode_code)}
              </Text>
            </View>
            {showDistance ? (
              <View style={styles.metaItem}>
                <Ionicons name="map-outline" size={14} color={HomeColors.muted} />
                <Text numberOfLines={1} style={styles.metaText}>
                  {item.distance_km} km
                </Text>
              </View>
            ) : null}
          </View>
          {fuel != null ? (
            <View style={styles.metaItem}>
              <Ionicons name="cash-outline" size={14} color={HomeColors.primary} />
              <Text numberOfLines={1} style={styles.fuelText}>
                {formatCurrency(fuel)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }, []);

  const renderHeader = () => (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => router.back()}
        style={styles.backBtn}>
        <Ionicons name="chevron-back" size={18} color={HomeColors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text numberOfLines={2} style={styles.headerTitle}>
        {vehicleLabel}
      </Text>
      <Text style={styles.headerSubtitle}>
        {records.length > 0
          ? `Shared trip history · ${records.length} trip${records.length !== 1 ? 's' : ''}`
          : 'Shared trip history'}
      </Text>
    </View>
  );

  const renderListEmpty = () => (
    <View style={styles.stateBlock}>
      <Text style={styles.stateTitle}>{error ? "Couldn't load trips" : 'No trips yet'}</Text>
      <Text style={styles.stateMessage}>
        {error ?? 'Trips recorded with this shared vehicle will appear here.'}
      </Text>
      {error ? (
        <Pressable
          accessibilityLabel="Try again"
          accessibilityRole="button"
          onPress={handleRetry}
          style={styles.retryBtn}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.screen}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={HomeColors.primary} />
        <Text style={styles.loadingText}>Loading shared trips…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to view shared vehicle trip history."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        // Status-bar clearance only: the base padding is unchanged and the inset
        // is added on top, so the header clears the notch without extra padding.
        contentContainerStyle={[styles.content, { paddingTop: spacing.lg + insets.top }]}
        data={records}
        initialNumToRender={10}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderListEmpty}
        ListHeaderComponent={renderHeader}
        maxToRenderPerBatch={10}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: HomeColors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  header: { marginBottom: spacing.lg },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    paddingVertical: 4,
  },
  backText: {
    color: HomeColors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    color: HomeColors.navy,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: spacing.sm,
  },
  headerSubtitle: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  // Flat trip row: hairline border, no shadow, no blur, no gradient.
  card: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    marginBottom: spacing.sm,
  },
  date: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  route: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  metaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
    minWidth: 0,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  metaText: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  fuelText: {
    color: HomeColors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },

  stateBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
  },
  stateTitle: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  stateMessage: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
  },
  retryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
  },
  retryText: {
    color: HomeColors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: HomeColors.background,
  },
  loadingText: {
    color: HomeColors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
