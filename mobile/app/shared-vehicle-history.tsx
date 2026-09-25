import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import SubPageHeader from '@/components/ui/SubPageHeader';
import { spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate, transportModeLabel } from '@/lib/format';
import { fetchTripsForVehicle } from '@/lib/services/trips';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { TripRecord } from '@/types/mcda';

function ownVehicleFuelCost(record: TripRecord): number | null {
  const own = record.mode_evaluations.find((evaluation) => evaluation.modeCode === 'OWN_VEHICLE');
  return own?.raw.fuelCost ?? null;
}

function routeLabel(record: TripRecord): string {
  if (record.origin_label || record.destination_label) {
    return `${record.origin_label ?? '…'} → ${record.destination_label ?? '…'}`;
  }
  return `${record.distance_km} km`;
}

export default function SharedVehicleHistoryScreen() {
  const router = useRouter();
  const theme = useTheme();
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

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured || !vehicleId) {
      setLoading(false);
      return;
    }

    try {
      setRecords(await fetchTripsForVehicle(vehicleId));
    } catch (error) {
      Alert.alert(
        'Unable to load trips',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [user, vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading shared trips…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to view shared vehicle trip history."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  if (!vehicleId) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }]}>
        <ScrollView contentContainerStyle={styles.padding}>
          <SubPageHeader
            module="trip"
            title="Shared vehicle trips"
            subtitle="Read-only trip history for this shared vehicle."
          />
          <EmptyState
            title="Vehicle unavailable"
            message="This shared vehicle could not be found."
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="trip"
        title={`${vehicleLabel} trips`}
        subtitle="Read-only trip history for this shared vehicle."
      />

      {records.length === 0 ? (
        <EmptyState
          title="No shared trips yet"
          message="Trips recorded for this vehicle will appear here."
        />
      ) : (
        records.map((record) => {
          const fuel = ownVehicleFuelCost(record);
          return (
            <Card key={record.id}>
              <Text style={[styles.date, { color: theme.textSecondary }]}>
                {formatDate(record.created_at)}
              </Text>
              <Text style={[styles.route, { color: theme.text }]}>{routeLabel(record)}</Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                Recommended: {transportModeLabel(record.recommended_mode_code)}
              </Text>
              {fuel != null ? (
                <Text style={[styles.meta, { color: theme.textSecondary }]}>
                  Vehicle fuel: {formatCurrency(fuel)}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {record.distance_km} km
              </Text>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  date: { fontSize: 13 },
  route: { fontSize: 17, fontWeight: '700', marginVertical: 4 },
  meta: { fontSize: 14, marginTop: 2 },
});
