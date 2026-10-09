import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import TripSectionHeader from '@/components/trip/TripSectionHeader';
import Card from '@/components/ui/Card';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatCurrency, formatDate, transportModeLabel } from '@/lib/format';
import { fetchRecentTrips } from '@/lib/services/trips';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { TripRecord } from '@/types/mcda';

function ownVehicleFuelCost(record: TripRecord): number | null {
  const own = record.mode_evaluations.find((e) => e.modeCode === 'OWN_VEHICLE');
  return own?.raw.fuelCost ?? null;
}

function routeLabel(record: TripRecord): string {
  if (record.origin_label || record.destination_label) {
    return `${record.origin_label ?? '…'} → ${record.destination_label ?? '…'}`;
  }
  return `${record.distance_km} km`;
}

export default function TripHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const { user, loading: authLoading } = useAuth();
  const [records, setRecords] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!user || !isSupabaseConfigured) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchRecentTrips(user.id);
      if (requestId === loadRequestId.current) setRecords(rows);
    } catch {
      if (requestId === loadRequestId.current) setLoadError('Couldn’t load trip history. Please try again.');
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { loadRequestId.current += 1; };
  }, [load]));

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading trip history…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to view your trip calculation history."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <TripSectionHeader active="history" />

      {loadError ? (
        <Card>
          <Text>{loadError}</Text>
          <PrimaryButton label="Try again" onPress={load} style={styles.actionBtn} />
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <Text>No trip history yet. Compare trip costs to record your first trip.</Text>
          <PrimaryButton
            label="New trip"
            variant="secondary"
            onPress={() => router.push('/(tabs)/trip')}
            style={styles.actionBtn}
          />
        </Card>
      ) : (
        records.map((record) => {
          const fuel = ownVehicleFuelCost(record);
          return (
            <Card key={record.id}>
              <Text style={styles.date}>{formatDate(record.created_at)}</Text>
              <Text style={styles.route}>{routeLabel(record)}</Text>
              <Text style={styles.meta}>
                Recommended: {transportModeLabel(record.recommended_mode_code)}
              </Text>
              {fuel != null && (
                <Text style={styles.meta}>Own-vehicle fuel: {formatCurrency(fuel)}</Text>
              )}
              <Text style={styles.meta}>{record.distance_km} km</Text>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // spacing.xxxl does not exist; the token set stops at xxl (48). xxl is what
  // the other bottom-anchored tab screens use for the same purpose (see
  // trip/index.tsx content padding and budget.tsx), so this restores the
  // intended "extra room to clear the floating tab bar" without inventing a
  // new global spacing step for two call sites.
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  date: { fontSize: 13, opacity: 0.7 },
  route: { fontSize: 17, fontWeight: '700', marginVertical: 4 },
  meta: { opacity: 0.85, marginTop: 2 },
  actionBtn: { marginTop: 12 },
});
