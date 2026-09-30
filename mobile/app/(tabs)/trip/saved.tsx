import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

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
import { formatDate } from '@/lib/format';
import { deleteSavedTrip, fetchSavedTrips } from '@/lib/services/savedTrips';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { SavedTrip } from '@/types';

function routeLabel(trip: SavedTrip): string {
  if (trip.origin_label || trip.destination_label) {
    return `${trip.origin_label ?? '…'} → ${trip.destination_label ?? '…'}`;
  }
  return `${trip.distance_km} km`;
}

export default function SavedTripsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const { user, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      setTrips(await fetchSavedTrips(user.id));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReRun = (trip: SavedTrip) => {
    router.push({
      pathname: '/(tabs)/trip',
      params: {
        origin: trip.origin_label ?? '',
        destination: trip.destination_label ?? '',
        vehicleId: trip.vehicle_id ?? 'manual',
        fuelCostWeight: String(trip.mcda_weights.fuelCost),
        travelTimeWeight: String(trip.mcda_weights.travelTime),
        templateName: trip.name,
      },
    });
  };

  const handleDelete = (trip: SavedTrip) => {
    Alert.alert('Delete template', `Remove "${trip.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSavedTrip(trip.id);
            await load();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete');
          }
        },
      },
    ]);
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading saved trips…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to save and manage trip templates."
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
      <TripSectionHeader active="saved" />

      {trips.length === 0 ? (
        <Card>
          <Text>No saved trips yet. Save a template from New trip.</Text>
          <PrimaryButton
            label="New trip"
            variant="secondary"
            onPress={() => router.push('/(tabs)/trip')}
            style={styles.actionBtn}
          />
        </Card>
      ) : (
        trips.map((trip) => (
          <Card key={trip.id}>
            <Text style={styles.title}>{trip.name}</Text>
            <Text style={styles.meta}>{routeLabel(trip)}</Text>
            <Text style={styles.meta}>
              {trip.distance_km} km · weights {trip.mcda_weights.fuelCost}/
              {trip.mcda_weights.travelTime}
            </Text>
            <Text style={styles.meta}>Updated {formatDate(trip.updated_at)}</Text>
            <PrimaryButton
              label="Re-run"
              onPress={() => handleReRun(trip)}
              style={styles.actionBtn}
            />
            <PrimaryButton
              label="Delete"
              variant="danger"
              onPress={() => handleDelete(trip)}
              style={styles.actionBtn}
            />
          </Card>
        ))
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
  title: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  meta: { opacity: 0.85, marginTop: 2 },
  actionBtn: { marginTop: 10 },
});
