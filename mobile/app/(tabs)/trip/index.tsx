import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  DirectionsError,
  getDrivingRoute,
  type DirectionsRoute,
} from '@/lib/services/googleMaps';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  consumeRouteSelection,
  type RouteLocation,
} from '@/lib/services/routeSelection';
import { useTheme } from '@/lib/useTheme';
import type { MCDAWeights } from '@/types/mcda';
import type { Vehicle } from '@/types';

export default function TripOptimizerScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    origin?: string;
    destination?: string;
    vehicleId?: string;
    fuelCostWeight?: string;
    travelTimeWeight?: string;
    templateName?: string;
  }>();
  const { user } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [origin, setOrigin] = useState('');
  const [originLocation, setOriginLocation] = useState<RouteLocation | null>(
    null,
  );
  const [destination, setDestination] = useState('');
  const [destinationRouteValue, setDestinationRouteValue] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [efficiency, setEfficiency] = useState('14');
  const [manualLastRefillPrice, setManualLastRefillPrice] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | 'manual'>('manual');
  const [weights, setWeights] = useState<MCDAWeights>(DEFAULT_MCDA_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loggingHistory, setLoggingHistory] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [lastOptimizeElapsedMs, setLastOptimizeElapsedMs] = useState<number | null>(null);
  const [result, setResult] = useState<ReturnType<typeof calculateTripRecommendation> | null>(null);

  useFocusEffect(
    useCallback(() => {
      const selection = consumeRouteSelection();
      if (!selection) return;
      setOrigin(selection.origin.displayName);
      setOriginLocation(selection.origin);
      setDestination(selection.destination.displayName);
      setDestinationRouteValue(selection.destination.directionsValue);
    }, [])
  );

  useEffect(() => {
    if (params.origin) {
      setOrigin(params.origin);
      setOriginLocation(null);
    }
    if (params.destination) {
      setDestination(params.destination);
      setDestinationRouteValue('');
    }
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

  const optimizeRequestId = useRef(0);

  // Inputs are editable without recalculating. Any calculation input change
  // invalidates the previous route/result until the user taps Optimize again.
  useEffect(() => {
    optimizeRequestId.current += 1;
    setOptimizing(false);
    setResult(null);
    setRouteError(null);
    setRouteDistanceKm(null);
    setRouteDurationMinutes(null);
    setLastOptimizeElapsedMs(null);
  }, [
    destination,
    destinationRouteValue,
    efficiency,
    hasRegisteredVehicles,
    lastRefillPrice,
    manualLastRefillPrice,
    origin,
    originLocation,
    selectedVehicleId,
    weights,
  ]);

  const handleOptimize = useCallback(async () => {
    if (optimizing) return;

    const requestId = ++optimizeRequestId.current;
    const startedAt = Date.now();
    let outcome: 'success' | 'error' = 'error';
    let routeResult: DirectionsRoute | null = null;

    setOptimizing(true);
    setRouteError(null);
    setResult(null);
    setRouteDistanceKm(null);
    setRouteDurationMinutes(null);

    try {
      if (!origin.trim() || !destination.trim()) {
        setRouteError('Enter both an origin and a destination before optimizing.');
        return;
      }
      const originForDirections = originLocation
        ? `${originLocation.latitude},${originLocation.longitude}`
        : origin;
      const destinationForDirections = destinationRouteValue || destination;

      const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
      const price = lastRefillPrice;
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

      routeResult = await getDrivingRoute(originForDirections, destinationForDirections);
      if (requestId !== optimizeRequestId.current) return;

      setRouteDistanceKm(routeResult.distanceKm);
      setRouteDurationMinutes(routeResult.durationMinutes);
      setResult(
        calculateTripRecommendation({
          distanceKm: routeResult.distanceKm,
          fuelPricePerLiter: price,
          fuelEfficiencyKmPerLiter,
          weights,
          ownVehicleTravelTimeMinutes: routeResult.durationMinutes,
        })
      );
      outcome = 'success';
    } catch (error) {
      if (requestId !== optimizeRequestId.current) return;
      setRouteError(
        error instanceof DirectionsError
          ? error.userMessage
          : "Couldn't retrieve a route. Check your connection and try again."
      );
    } finally {
      if (requestId === optimizeRequestId.current) {
        setOptimizing(false);
        const elapsedMs = Date.now() - startedAt;
        setLastOptimizeElapsedMs(elapsedMs);
        if (outcome === 'success') {
          console.log('[Trip Optimizer] Optimize flow completed', {
            elapsedMs,
            distanceKm: routeResult?.distanceKm,
            durationMinutes: routeResult?.durationMinutes,
          });
        } else {
          console.warn('[Trip Optimizer] Optimize flow failed', { elapsedMs });
        }
      }
    }
  }, [
    destination,
    destinationRouteValue,
    efficiency,
    hasRegisteredVehicles,
    lastRefillPrice,
    optimizing,
    origin,
    originLocation,
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
    if (!name) {
      Alert.alert('Name required', 'Enter a template name before saving.');
      return;
    }
    if (!result?.recommended || routeDistanceKm == null) {
      Alert.alert('Optimize first', 'Run Optimize successfully before saving this trip template.');
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
        distanceKm: routeDistanceKm,
        weights,
      });
      Alert.alert('Saved', 'Trip template saved. Re-run it anytime from Saved Trips.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }, [
    user,
    requireAuth,
    templateName,
    origin,
    destination,
    result,
    routeDistanceKm,
    selectedVehicleId,
    weights,
  ]);

  const handleLogHistory = useCallback(async () => {
    if (!user && !requireAuth()) return;
    if (!user || !result?.recommended || routeDistanceKm == null) return;

    setLoggingHistory(true);
    try {
      await logTripToHistory({
        userId: user.id,
        vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
        distanceKm: routeDistanceKm ?? 0,
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
  }, [
    user,
    requireAuth,
    result,
    selectedVehicleId,
    routeDistanceKm,
    origin,
    destination,
    weights,
  ]);

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

      <FormSection title="Route" subtitle="Enter specific locations; route data is retrieved on Optimize" module="trip">
        <LabeledInput
          label="Origin"
          value={origin}
          onChangeText={(value) => {
            setOrigin(value);
            setOriginLocation(null);
          }}
          placeholder="e.g. Quezon City Hall, Quezon City"
        />
        <LabeledInput
          label="Destination"
          value={destination}
          onChangeText={(value) => {
            setDestination(value);
            setDestinationRouteValue('');
          }}
          placeholder="e.g. Makati Avenue, Makati"
        />
        <PrimaryButton
          label="Pick on Map"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/(tabs)/trip/pick-map' as never,
              params: {
                origin: origin.trim() || undefined,
                destination: destination.trim() || undefined,
              },
            })
          }
          style={styles.pickMapBtn}
        />
        {routeDistanceKm != null && routeDurationMinutes != null && (
          <View style={[styles.routeSummary, { backgroundColor: theme.overlay }]}>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>Google Maps route</Text>
            <Text style={[styles.routeSummaryValue, { color: theme.text }]}>
              {routeDistanceKm.toFixed(2)} km · {routeDurationMinutes.toFixed(0)} min driving
            </Text>
          </View>
        )}
        {routeError && <Text style={styles.error}>{routeError}</Text>}
        {lastOptimizeElapsedMs != null && (
          <Text style={[styles.timing, { color: theme.textSecondary }]}>
            Last Optimize flow: {lastOptimizeElapsedMs} ms
          </Text>
        )}
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

      <PrimaryButton
        label={optimizing ? 'Finding route…' : 'Optimize'}
        onPress={handleOptimize}
        disabled={optimizing}
        style={styles.actionBtn}
      />

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
  routeSummary: { padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.sm },
  routeSummaryValue: { fontSize: 17, fontWeight: '800', marginTop: spacing.xs },
  timing: { fontSize: 12, marginTop: spacing.xs },
  error: { color: palette.danger, marginBottom: spacing.sm, fontWeight: '700' },
  actionBtn: { marginTop: spacing.sm },
  pickMapBtn: { marginBottom: spacing.sm },
});
