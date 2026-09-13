import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SubPageHeader from '@/components/ui/SubPageHeader';
import { spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
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
  const { user, loading: authLoading } = useAuth();
  const [records, setRecords] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      setRecords(await fetchRecentTrips(user.id));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

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
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="trip"
        title="Trip History"
        subtitle="Logged SAW runs — budget spending comes from these."
      />

      {records.length === 0 ? (
        <Card>
          <Text>No trip history yet. Run the optimizer and tap Log to history.</Text>
          <PrimaryButton
            label="Go to optimizer"
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
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  date: { fontSize: 13, opacity: 0.7 },
  route: { fontSize: 17, fontWeight: '700', marginVertical: 4 },
  meta: { opacity: 0.85, marginTop: 2 },
  actionBtn: { marginTop: 12 },
});
