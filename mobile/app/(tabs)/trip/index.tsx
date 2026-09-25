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
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
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
  const tabBarScrollHandler = useTabBarScrollHandler();
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
  const [result, setResult] = useState<ReturnType<typeof calculateTripRecommendation> | null>(null);

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
        if (!user) {
          setVehicles([]);
          setSelectedVehicleId('manual');
          return;
        }
        const list = await fetchVehicles(user.id);
        setVehicles(list);
        const paramVehicle =
          params.vehicleId && params.vehicleId !== 'manual' ? params.vehicleId : null;
        const nextVehicle =
          paramVehicle && list.some((vehicle) => vehicle.id === paramVehicle)
            ? paramVehicle
            : list[0]?.id ?? 'manual';
        setSelectedVehicleId(nextVehicle);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, params.vehicleId]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const hasRegisteredVehicles = vehicles.length > 0;

  useEffect(() => {
    if (!hasRegisteredVehicles) {
      if (selectedVehicleId !== 'manual') setSelectedVehicleId('manual');
      return;
    }
    if (!vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [hasRegisteredVehicles, selectedVehicleId, vehicles]);

  useEffect(() => {
    if (!selectedVehicle) return;
    setEfficiency(String(selectedVehicle.fuel_efficiency_km_per_liter));
  }, [selectedVehicle]);

  const lastRefillPrice = useMemo(() => {
    if (hasRegisteredVehicles) {
      return selectedVehicle?.last_refill_price ?? null;
    }
    const manual = parseFloat(manualLastRefillPrice);
    return Number.isFinite(manual) && manual > 0 ? manual : null;
  }, [hasRegisteredVehicles, selectedVehicle, manualLastRefillPrice]);

  const missingLastRefillPrice =
    hasRegisteredVehicles && selectedVehicle?.last_refill_price == null;

  // Inputs are editable without recalculating. Any calculation input change
  // invalidates the previous result until the user taps Optimize again.
  useEffect(() => {
    setResult(null);
  }, [
    origin,
    destination,
    distance,
    efficiency,
    manualLastRefillPrice,
    lastRefillPrice,
    hasRegisteredVehicles,
    selectedVehicleId,
    weights,
  ]);

  const handleOptimize = useCallback(() => {
    const distanceKm = parseFloat(distance);
    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = lastRefillPrice;

    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      Alert.alert('Invalid distance', 'Enter a distance greater than zero.');
      return;
    }
    if (!Number.isFinite(fuelEfficiencyKmPerLiter) || fuelEfficiencyKmPerLiter <= 0) {
      Alert.alert('Invalid fuel efficiency', 'Enter a fuel efficiency greater than zero.');
      return;
    }
    if (!weightsSumToOne(weights)) {
      Alert.alert('Invalid weights', 'Criterion weights must sum to 1.0.');
      return;
    }
    if (hasRegisteredVehicles && !selectedVehicle) {
      Alert.alert('Vehicle required', 'Select a registered vehicle before optimizing.');
      return;
    }
    if (price == null || price <= 0) {
      Alert.alert(
        'Last-refill price required',
        hasRegisteredVehicles
          ? 'Add a last-refill price to this vehicle before optimizing.'
          : 'Enter your last fuel price before optimizing.'
      );
      return;
    }

    setResult(
      calculateTripRecommendation({
        distanceKm,
        fuelPricePerLiter: price,
        fuelEfficiencyKmPerLiter,
        weights,
      })
    );
  }, [
    distance,
    efficiency,
    hasRegisteredVehicles,
    lastRefillPrice,
    selectedVehicle,
    weights,
  ]);

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

  const vehicleOptions = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: vehicle.nickname ?? `${vehicle.brand} ${vehicle.model}`,
  }));

  const routeLabel =
    origin.trim() || destination.trim()
      ? `${origin.trim() || '…'} → ${destination.trim() || '…'}`
      : null;

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
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
        {hasRegisteredVehicles ? (
          <>
            <ChipSelect
              label="Your vehicle"
              options={vehicleOptions}
              value={selectedVehicle?.id ?? null}
              onChange={(vehicleId) => setSelectedVehicleId(vehicleId)}
            />
            <LabeledInput
              label="Fuel efficiency (km/L)"
              value={efficiency}
              editable={false}
            />
            {missingLastRefillPrice ? (
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
          </>
        ) : (
          <>
            <Text style={[styles.manualNotice, { color: theme.textSecondary }]}>
              No vehicle registered — enter your last fuel price manually.
            </Text>
            <LabeledInput
              label="Fuel efficiency (km/L)"
              value={efficiency}
              onChangeText={setEfficiency}
              keyboardType="decimal-pad"
            />
            <LabeledInput
              label="Last fuel price (₱/L)"
              value={manualLastRefillPrice}
              onChangeText={setManualLastRefillPrice}
              keyboardType="decimal-pad"
            />
          </>
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

      <PrimaryButton label="Optimize" onPress={handleOptimize} style={styles.actionBtn} />

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
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  meta: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  refillPill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  refillValue: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  warningText: { fontSize: 14, lineHeight: 21, marginBottom: spacing.sm },
  manualNotice: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  warningBtn: { marginTop: spacing.xs },
  routeLabel: { fontSize: 15, fontWeight: '700', marginBottom: spacing.sm },
  error: { color: palette.danger, marginBottom: spacing.sm, fontWeight: '700' },
  actionBtn: { marginTop: spacing.sm },
});
