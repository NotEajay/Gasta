import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import FormSection from '@/components/ui/FormSection';
import LoadingState from '@/components/ui/LoadingState';
import ModeRankCard from '@/components/ui/ModeRankCard';
import PageHero from '@/components/ui/PageHero';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SectionHeader from '@/components/ui/SectionHeader';
import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import { palette, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, transportModeLabel } from '@/lib/format';
import { weightsSumToOne } from '@/lib/mcda';
import { createSavedTrip } from '@/lib/services/savedTrips';
import { logTripToHistory } from '@/lib/services/trips';
import { fetchVehicles } from '@/lib/services/vehicles';
import { calculateTripRecommendation } from '@/lib/tripCalculator';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { MCDAWeights } from '@/types/mcda';
import type { Vehicle } from '@/types';

export default function TripOptimizerScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    origin?: string;
    destination?: string;
    distance?: string;
    vehicleId?: string;
    fuelCostWeight?: string;
    travelTimeWeight?: string;
    templateName?: string;
  }>();
  const { user } = useAuth();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [distance, setDistance] = useState('10');
  const [efficiency, setEfficiency] = useState('14');
  const [manualLastRefillPrice, setManualLastRefillPrice] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | 'manual'>('manual');
  const [weights, setWeights] = useState<MCDAWeights>(DEFAULT_MCDA_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loggingHistory, setLoggingHistory] = useState(false);

  useEffect(() => {
    if (params.origin) setOrigin(params.origin);
    if (params.destination) setDestination(params.destination);
    if (params.distance) setDistance(params.distance);
    if (params.templateName) setTemplateName(params.templateName);
    if (params.vehicleId) {
      setSelectedVehicleId(params.vehicleId === 'manual' ? 'manual' : params.vehicleId);
    }
    if (params.fuelCostWeight && params.travelTimeWeight) {
      const fuelCost = parseFloat(params.fuelCostWeight);
      const travelTime = parseFloat(params.travelTimeWeight);
      if (Number.isFinite(fuelCost) && Number.isFinite(travelTime)) {
        setWeights({ fuelCost, travelTime });
      }
    }
  }, [
    params.origin,
    params.destination,
    params.distance,
    params.vehicleId,
    params.fuelCostWeight,
    params.travelTimeWeight,
    params.templateName,
  ]);

  useEffect(() => {
    async function load() {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      try {
        if (user) {
          const list = await fetchVehicles(user.id);
          setVehicles(list);
          const paramVehicle =
            params.vehicleId && params.vehicleId !== 'manual' ? params.vehicleId : null;
          if (paramVehicle && list.some((v) => v.id === paramVehicle)) {
            setSelectedVehicleId(paramVehicle);
          } else if (!params.vehicleId && list[0]) {
            setSelectedVehicleId(list[0].id);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, params.vehicleId]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  useEffect(() => {
    if (!selectedVehicle) return;
    setEfficiency(String(selectedVehicle.fuel_efficiency_km_per_liter));
    if (selectedVehicle.last_refill_price != null) {
      setManualLastRefillPrice(String(selectedVehicle.last_refill_price));
    } else {
      setManualLastRefillPrice('');
    }
  }, [selectedVehicle]);

  const lastRefillPrice = useMemo(() => {
    if (selectedVehicleId !== 'manual' && selectedVehicle) {
      return selectedVehicle.last_refill_price;
    }
    const manual = parseFloat(manualLastRefillPrice);
    return Number.isFinite(manual) && manual > 0 ? manual : null;
  }, [selectedVehicleId, selectedVehicle, manualLastRefillPrice]);

  const missingLastRefillPrice =
    selectedVehicleId !== 'manual' && selectedVehicle != null && selectedVehicle.last_refill_price == null;

  const result = useMemo(() => {
    const distanceKm = parseFloat(distance);
    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = lastRefillPrice ?? 0;
    if (!distanceKm || distanceKm <= 0 || !price) return null;
    if (!weightsSumToOne(weights)) return null;
    return calculateTripRecommendation({
      distanceKm,
      fuelPricePerLiter: price,
      fuelEfficiencyKmPerLiter: fuelEfficiencyKmPerLiter || 1,
      weights,
    });
  }, [distance, efficiency, lastRefillPrice, weights]);

  const maxScore = result?.evaluations[0]?.weightedScore ?? 1;

  const updateWeight = (key: keyof MCDAWeights, value: string) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return;
    setWeights((prev) => ({ ...prev, [key]: num }));
  };

  const requireAuth = useCallback(() => {
    Alert.alert('Sign in required', 'Sign in to save trips and view history.');
    router.push('/login');
    return false;
  }, [router]);

  const handleSaveTemplate = useCallback(async () => {
    if (!user && !requireAuth()) return;
    if (!user) return;

    const name = templateName.trim();
    const distanceKm = parseFloat(distance);
    if (!name) {
      Alert.alert('Name required', 'Enter a template name before saving.');
      return;
    }
    if (!distanceKm || distanceKm <= 0) {
      Alert.alert('Invalid distance', 'Enter a distance greater than zero.');
      return;
    }
    if (!weightsSumToOne(weights)) {
      Alert.alert('Invalid weights', 'Criterion weights must sum to 1.0.');
      return;
    }

    setSavingTemplate(true);
    try {
      await createSavedTrip({
        userId: user.id,
        name,
        originLabel: origin.trim() || undefined,
        destinationLabel: destination.trim() || undefined,
        vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
        distanceKm,
        weights,
      });
      Alert.alert('Saved', 'Trip template saved. Re-run it anytime from Saved Trips.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }, [user, requireAuth, templateName, origin, destination, distance, selectedVehicleId, weights]);

  const handleLogHistory = useCallback(async () => {
    if (!user && !requireAuth()) return;
    if (!user || !result?.recommended) return;

    setLoggingHistory(true);
    try {
      await logTripToHistory({
        userId: user.id,
        vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
        distanceKm: parseFloat(distance),
        originLabel: origin.trim() || undefined,
        destinationLabel: destination.trim() || undefined,
        weights,
        evaluations: result.evaluations,
        recommendedModeCode: result.recommended.modeCode,
      });
      Alert.alert('Logged', 'This calculation was added to Trip History.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to log trip');
    } finally {
      setLoggingHistory(false);
    }
  }, [user, requireAuth, result, selectedVehicleId, distance, origin, destination, weights]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (loading) return <LoadingState message="Loading trip data…" />;

  const vehicleOptions = [
    { value: 'manual' as const, label: 'Manual entry' },
    ...vehicles.map((v) => ({
      value: v.id as string,
      label: v.nickname ?? `${v.brand} ${v.model}`,
    })),
  ];

  const routeLabel =
    origin.trim() || destination.trim()
      ? `${origin.trim() || '…'} → ${destination.trim() || '…'}`
      : null;

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <PageHero
        module="trip"
        title="Trip Optimizer"
        subtitle="Compare transport modes by fuel cost and travel time."
        navItems={[
          { href: '/(tabs)/trip/saved', label: 'Saved trips' },
          { href: '/(tabs)/trip/history', label: 'History' },
        ]}
      />

      <FormSection title="Route" subtitle="Optional labels for saved trips" module="trip">
        <LabeledInput label="Origin" value={origin} onChangeText={setOrigin} placeholder="e.g. Quezon City" />
        <LabeledInput label="Destination" value={destination} onChangeText={setDestination} placeholder="e.g. Makati" />
        <LabeledInput
          label="Distance (km)"
          value={distance}
          onChangeText={setDistance}
          keyboardType="decimal-pad"
        />
      </FormSection>

      <FormSection title="Vehicle & fuel" module="trip">
        {user && vehicles.length > 0 && (
          <ChipSelect
            label="Your vehicle"
            options={vehicleOptions}
            value={selectedVehicleId}
            onChange={(v) => setSelectedVehicleId(v)}
          />
        )}
        <LabeledInput
          label="Fuel efficiency (km/L)"
          value={efficiency}
          onChangeText={setEfficiency}
          keyboardType="decimal-pad"
          editable={selectedVehicleId === 'manual'}
        />
        {selectedVehicleId === 'manual' ? (
          <LabeledInput
            label="Last refill price (₱/L)"
            value={manualLastRefillPrice}
            onChangeText={setManualLastRefillPrice}
            keyboardType="decimal-pad"
          />
        ) : missingLastRefillPrice ? (
          <Card style={{ backgroundColor: palette.warningSoft, borderColor: palette.warning }}>
            <Text style={[styles.warningText, { color: theme.text }]}>
              This vehicle has no last-refill price. Add one in My Vehicles before running SAW.
            </Text>
            <PrimaryButton
              label="Go to My Vehicles"
              variant="secondary"
              onPress={() => router.push('/(tabs)/vehicles')}
              style={styles.warningBtn}
            />
          </Card>
        ) : (
          <View style={[styles.refillPill, { backgroundColor: theme.overlay }]}>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>Last refill</Text>
            <Text style={[styles.refillValue, { color: theme.text }]}>
              {formatCurrency(lastRefillPrice!)}/L
            </Text>
          </View>
        )}
      </FormSection>

      <FormSection title="Priority weights" subtitle="Must sum to 1.0" module="trip">
        <LabeledInput
          label="Fuel cost weight"
          value={String(weights.fuelCost)}
          onChangeText={(v) => updateWeight('fuelCost', v)}
          keyboardType="decimal-pad"
        />
        <LabeledInput
          label="Travel time weight"
          value={String(weights.travelTime)}
          onChangeText={(v) => updateWeight('travelTime', v)}
          keyboardType="decimal-pad"
        />
        {!weightsSumToOne(weights) && (
          <Text style={styles.error}>Weights must sum to 1.0</Text>
        )}
      </FormSection>

      {result?.recommended && (
        <>
          {routeLabel ? (
            <Text style={[styles.routeLabel, { color: theme.textSecondary }]}>{routeLabel}</Text>
          ) : null}
          <SectionHeader
            title="Results"
            subtitle={`Best: ${transportModeLabel(result.recommended.modeCode)} · ${result.recommended.weightedScore.toFixed(3)}`}
            module="trip"
          />
          {result.evaluations.map((ev, index) => (
            <ModeRankCard
              key={ev.modeCode}
              rank={index + 1}
              evaluation={ev}
              label={transportModeLabel(ev.modeCode)}
              recommended={ev.modeCode === result.recommended.modeCode}
              maxScore={maxScore}
            />
          ))}
        </>
      )}

      <FormSection title="Save trip" module="trip">
        <LabeledInput
          label="Template name"
          value={templateName}
          onChangeText={setTemplateName}
          placeholder="e.g. Home to office"
        />
        <PrimaryButton
          label={savingTemplate ? 'Saving…' : 'Save as template'}
          variant="secondary"
          onPress={handleSaveTemplate}
          disabled={savingTemplate}
        />
        {result?.recommended && (
          <PrimaryButton
            label={loggingHistory ? 'Logging…' : 'Log to history'}
            onPress={handleLogHistory}
            disabled={loggingHistory}
            style={styles.actionBtn}
          />
        )}
      </FormSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  meta: { fontSize: 12, fontWeight: '600' },
  refillPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  refillValue: { fontSize: 16, fontWeight: '800' },
  warningText: { lineHeight: 22, marginBottom: spacing.sm },
  warningBtn: { marginTop: spacing.xs },
  routeLabel: { fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  error: { color: palette.danger, marginBottom: spacing.sm, fontWeight: '600' },
  actionBtn: { marginTop: spacing.sm },
});
