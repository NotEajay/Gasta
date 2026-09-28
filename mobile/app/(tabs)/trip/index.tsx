import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import TripSectionHeader from '@/components/trip/TripSectionHeader';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import ModeRankCard from '@/components/ui/ModeRankCard';
import PrimaryButton from '@/components/ui/PrimaryButton';
import PriorityBalanceBar from '@/components/ui/PriorityBalanceBar';
import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatPeso, transportModeLabel } from '@/lib/format';
import { weightsSumToOne } from '@/lib/mcda';
import { createSavedTrip } from '@/lib/services/savedTrips';
import { logTripToHistory } from '@/lib/services/trips';
import { fetchVehicleCatalog, fetchVehicles } from '@/lib/services/vehicles';
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
import type { Vehicle, VehicleCatalogEntry } from '@/types';

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
  /**
   * Inline validation for the missing-template-name case. This replaces the
   * previous `Alert.alert('Name required', ...)` so the field itself shows the
   * problem. It never changes the save payload or the service call.
   */
  const [templateNameError, setTemplateNameError] = useState<string | null>(null);
  const [efficiency, setEfficiency] = useState('14');
  const [manualLastRefillPrice, setManualLastRefillPrice] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalogEntry[]>([]);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<VehicleCatalogEntry | null>(
    null,
  );
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
        const catalogPromise = fetchVehicleCatalog().catch(() => [] as VehicleCatalogEntry[]);

        if (!user) {
          setVehicles([]);
          setSelectedVehicleId('manual');
          setCatalog(await catalogPromise);
          return;
        }

        const [list, catalogList] = await Promise.all([
          fetchVehicles(user.id),
          catalogPromise,
        ]);
        setVehicles(list);
        setCatalog(catalogList);

        // Respect an explicit "manual" / Other selection from saved-trip params.
        if (params.vehicleId === 'manual') {
          setSelectedVehicleId('manual');
          return;
        }

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
  const isManualVehicle = selectedVehicleId === 'manual';

  const catalogSearchResults = useMemo(() => {
    if (!catalogSearchQuery.trim() || selectedCatalogEntry) return [];
    const query = catalogSearchQuery.toLowerCase();
    return catalog.filter(
      (entry) =>
        entry.brand.toLowerCase().includes(query) ||
        entry.model.toLowerCase().includes(query),
    );
  }, [catalog, catalogSearchQuery, selectedCatalogEntry]);

  useEffect(() => {
    // Other / manual is always allowed, even when saved vehicles exist.
    if (selectedVehicleId === 'manual') return;
    if (!hasRegisteredVehicles) {
      setSelectedVehicleId('manual');
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

  const handleSelectCatalogEntry = useCallback((entry: VehicleCatalogEntry) => {
    setSelectedCatalogEntry(entry);
    setEfficiency(String(entry.fuel_efficiency_km_per_liter));
    setCatalogSearchQuery('');
  }, []);

  const handleClearCatalogSelection = useCallback(() => {
    setSelectedCatalogEntry(null);
  }, []);

  const handleVehicleChipChange = useCallback((vehicleId: string) => {
    setSelectedVehicleId(vehicleId === 'manual' ? 'manual' : vehicleId);
    if (vehicleId === 'manual') return;
    setSelectedCatalogEntry(null);
    setCatalogSearchQuery('');
  }, []);

  const lastRefillPrice = useMemo(() => {
    if (!isManualVehicle && selectedVehicle) {
      return selectedVehicle.last_refill_price ?? null;
    }
    const manual = parseFloat(manualLastRefillPrice);
    return Number.isFinite(manual) && manual > 0 ? manual : null;
  }, [isManualVehicle, selectedVehicle, manualLastRefillPrice]);

  const missingLastRefillPrice =
    !isManualVehicle && selectedVehicle?.last_refill_price == null;

  const optimizeRequestId = useRef(0);

  // Route/vehicle inputs are editable without recalculating. Changing them
  // clears the previous route until Optimize is tapped again. Weight changes
  // do NOT clear the route — they live-rescore the existing distance/time.
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
    isManualVehicle,
    lastRefillPrice,
    manualLastRefillPrice,
    origin,
    originLocation,
    selectedVehicleId,
  ]);

  // Live SAW rescore when priorities change after a successful Optimize.
  useEffect(() => {
    if (routeDistanceKm == null || routeDurationMinutes == null) return;

    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = lastRefillPrice;
    if (!Number.isFinite(fuelEfficiencyKmPerLiter) || fuelEfficiencyKmPerLiter <= 0) return;
    if (price == null || price <= 0) return;
    if (!weightsSumToOne(weights)) return;

    setResult(
      calculateTripRecommendation({
        distanceKm: routeDistanceKm,
        fuelPricePerLiter: price,
        fuelEfficiencyKmPerLiter,
        weights,
        ownVehicleTravelTimeMinutes: routeDurationMinutes,
      }),
    );
  }, [weights, routeDistanceKm, routeDurationMinutes, efficiency, lastRefillPrice]);

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
      if (!isManualVehicle && !selectedVehicle) {
        Alert.alert('Vehicle required', 'Select a registered vehicle before optimizing.');
        return;
      }
      if (price == null || price <= 0) {
        Alert.alert(
          'Fuel price required',
          isManualVehicle
            ? 'Enter the fuel price (₱/L) for this trip before optimizing.'
            : 'Add a last-refill price to this vehicle before optimizing.'
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
    isManualVehicle,
    lastRefillPrice,
    optimizing,
    origin,
    originLocation,
    selectedVehicle,
    weights,
  ]);

  const maxScore = result?.evaluations[0]?.weightedScore ?? 1;

  /**
   * Presentation helper only. `result.evaluations` is already sorted by
   * weightedScore and `result.recommended` is its first entry, so removing it
   * here preserves the exact MCDA ranking order for the remaining rows.
   */
  const remainingEvaluations = useMemo(
    () =>
      result
        ? result.evaluations.filter((ev) => ev.modeCode !== result.recommended?.modeCode)
        : [],
    [result]
  );

  /**
   * User-facing presets for the same two MCDA weights.
   *
   * Slider position maps to travel-time focus: 0 = Cheapest (fuelCost 1),
   * 0.5 = Balanced, 1 = Fastest (travelTime 1). `calculateTripRecommendation`
   * still receives fuelCost + travelTime summing to 1.0.
   */
  const applyWeightPair = useCallback((fuelCost: number, travelTime: number) => {
    const fuel = Math.round(fuelCost * 100) / 100;
    const time = Math.round(travelTime * 100) / 100;
    setWeights({ fuelCost: fuel, travelTime: time });
  }, []);

  /** Slider position 0..1 → complementary SAW weight pair. */
  const handlePriorityChange = useCallback(
    (timeFocus: number) => {
      const clamped = Math.min(1, Math.max(0, timeFocus));
      applyWeightPair(1 - clamped, clamped);
    },
    [applyWeightPair],
  );

  /** Visual slider position: 0 cheapest → 1 fastest. */
  const priorityPosition = weights.travelTime;

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
      // Missing-name is a simple field-level problem, so it is now surfaced
      // inline on the input instead of in a modal. The service is not called.
      setTemplateNameError('Please enter a template name.');
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

  const vehicleOptions = [
    ...vehicles.map((vehicle) => ({
      value: vehicle.id,
      label: vehicle.nickname ?? `${vehicle.brand} ${vehicle.model}`,
    })),
    { value: 'manual' as const, label: 'Other vehicle' },
  ];

  const chipValue =
    selectedVehicleId === 'manual' ? 'manual' : (selectedVehicle?.id ?? null);

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <TripSectionHeader active="new" />

      {/* Step 1 — the primary task. Route leads the flow. */}
      <View style={styles.stepSection}>
        <View style={styles.stepHeadRow}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>1</Text>
          </View>
          <View style={styles.stepHeadText}>
            <Text style={styles.stepTitle}>Route</Text>
            <Text style={styles.stepHint}>Where are you going?</Text>
          </View>
        </View>

        <LabeledInput
          label="From"
          value={origin}
          onChangeText={(value) => {
            setOrigin(value);
            setOriginLocation(null);
          }}
          placeholder="e.g. Quezon City Hall, Quezon City"
        />

        <LabeledInput
          label="To"
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

        {/* Compact: distance and duration are one line, never two big cards. */}
        {routeDistanceKm != null && routeDurationMinutes != null ? (
          <View style={styles.routeChip}>
            <Ionicons name="navigate-outline" size={13} color={HomeColors.primary} />
            <Text style={styles.routeChipText}>
              {routeDistanceKm.toFixed(1)} km ·{' '}
              {Math.round(routeDurationMinutes)} min
            </Text>
          </View>
        ) : null}

        {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
        {/*
          The per-run timing text used to be rendered here. It is developer
          telemetry, not user information, so it now only lives in the console
          logging inside handleOptimize. The timing logic itself is unchanged.
        */}
      </View>

      {/* Step 2 — vehicle/fuel basis. */}
      <View style={styles.stepSection}>
        <View style={styles.stepHeadRow}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>2</Text>
          </View>
          <View style={styles.stepHeadText}>
            <Text style={styles.stepTitle}>Vehicle &amp; fuel</Text>
            <Text style={styles.stepHint}>
              Pick a saved vehicle, or another car for this trip.
            </Text>
          </View>
        </View>

        {hasRegisteredVehicles ? (
          <ChipSelect
            label="Your vehicle"
            options={vehicleOptions}
            value={chipValue}
            onChange={handleVehicleChipChange}
          />
        ) : null}

        {!isManualVehicle && selectedVehicle ? (
          <>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.vehicleName}>
              {selectedVehicle.nickname ??
                `${selectedVehicle.brand} ${selectedVehicle.model}`}
            </Text>
            {selectedVehicle.nickname ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.vehicleMeta}>
                {selectedVehicle.brand} {selectedVehicle.model}
              </Text>
            ) : null}

            {missingLastRefillPrice ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>Fuel price needed</Text>
                <Text style={styles.warnBody}>
                  Add a refill price for this vehicle before optimizing.
                </Text>
                <PrimaryButton
                  label="Go to My Vehicles"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push('/(tabs)/vehicles')}
                  style={styles.warnBtn}
                />
              </View>
            ) : (
              <>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Fuel efficiency</Text>
                  <Text style={styles.statValue}>{efficiency} km/L</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Latest fuel price</Text>
                  <Text style={styles.statValue}>
                    {formatPeso(lastRefillPrice!)}/L
                  </Text>
                </View>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionHint}>
              {hasRegisteredVehicles
                ? 'Search the catalog to fill efficiency, then enter the fuel price for this trip.'
                : 'No vehicle registered. Search the catalog or enter fuel details manually.'}
            </Text>

            <LabeledInput
              label="Search vehicle catalog"
              value={catalogSearchQuery}
              onChangeText={setCatalogSearchQuery}
              placeholder="Type brand or model…"
              editable={!selectedCatalogEntry}
            />

            {selectedCatalogEntry ? (
              <View style={styles.catalogChip}>
                <View style={styles.catalogChipTextBlock}>
                  <Text style={styles.catalogChipTitle}>
                    {selectedCatalogEntry.brand} {selectedCatalogEntry.model} (
                    {selectedCatalogEntry.year})
                  </Text>
                  <Text style={styles.catalogChipMeta}>
                    {selectedCatalogEntry.fuel_efficiency_km_per_liter} km/L
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear catalog selection"
                  onPress={handleClearCatalogSelection}
                  style={styles.catalogClearBtn}>
                  <Ionicons name="close" size={16} color={GasTaColors.textOnForest} />
                </Pressable>
              </View>
            ) : null}

            {catalogSearchResults.length > 0 ? (
              <View style={styles.catalogResults}>
                {catalogSearchResults.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => handleSelectCatalogEntry(entry)}
                    style={({ pressed }) => [
                      styles.catalogResultItem,
                      pressed && styles.catalogResultItemPressed,
                    ]}>
                    <Text style={styles.catalogResultTitle}>
                      {entry.brand} {entry.model} ({entry.year})
                    </Text>
                    <Text style={styles.catalogResultMeta}>
                      {entry.fuel_efficiency_km_per_liter} km/L
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <LabeledInput
              label="Fuel efficiency (km/L)"
              value={efficiency}
              onChangeText={setEfficiency}
              keyboardType="decimal-pad"
              placeholder="14.0"
            />
            {!selectedCatalogEntry ? (
              <Text style={styles.hint}>
                Tip: pick a catalog car to auto-fill, or use a typical sedan range of about
                12–15 km/L.
              </Text>
            ) : null}

            <LabeledInput
              label="Fuel price (₱/L)"
              value={manualLastRefillPrice}
              onChangeText={setManualLastRefillPrice}
              keyboardType="decimal-pad"
              placeholder="62.50"
            />
          </>
        )}
      </View>

      {/*
        Option A priority UI: one slider + live outcome cards. The slider and
        SAW weights are the same state — dragging rescores an existing route
        without a new Directions call.
      */}
      <View style={styles.prefBlock}>
        <View style={styles.prefHeadRow}>
          <Ionicons name="options-outline" size={15} color={HomeColors.muted} />
          <Text style={styles.prefTitle}>What matters more?</Text>
        </View>
        <Text style={styles.prefHint}>
          Drag to balance saving money and travel time. Outcomes update after you optimize.
        </Text>

        <PriorityBalanceBar
          value={priorityPosition}
          onChange={handlePriorityChange}
          estimatedCost={result?.recommended?.raw.fuelCost ?? null}
          estimatedTimeMinutes={result?.recommended?.raw.travelTime ?? null}
          costFormatter={formatPeso}
        />

        {!weightsSumToOne(weights) ? (
          <Text style={styles.tuneError}>Weights must sum to 1.0</Text>
        ) : null}
      </View>

      {/* Main action. Spacing above and below signals the transition from
          "set up" to "run". The handler and disabled/loading behaviour are
          untouched. */}
      <View style={styles.ctaBlock}>
        <PrimaryButton
          label={optimizing ? 'Finding route…' : 'Optimize trip'}
          onPress={handleOptimize}
          disabled={optimizing}
          style={styles.optimizeBtn}
        />
        {!result ? (
          <Text style={styles.ctaHint}>
            Choose a route and vehicle, then optimize to compare travel options.
          </Text>
        ) : null}
      </View>

      {result?.recommended ? (
        <View style={styles.resultSection}>
          <View style={styles.resultHeadRow}>
            <Ionicons name="sparkles-outline" size={15} color={HomeColors.primary} />
            <Text style={styles.resultHead}>Result</Text>
          </View>

          {/*
            Presentation only. Every value below is read directly from the
            existing `result` / route state — no new calculation is introduced,
            and nothing here writes to Budget.
          */}
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Recommended</Text>
            <Text numberOfLines={2} style={styles.heroMode}>
              {transportModeLabel(result.recommended.modeCode)}
            </Text>
            <View style={styles.heroDivider} />
            <Text style={styles.heroLabel}>Estimated trip fuel cost</Text>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.heroValue}>
              {formatPeso(result.recommended.raw.fuelCost)}
            </Text>
            {routeDistanceKm != null && routeDurationMinutes != null ? (
              <View style={styles.heroRouteRow}>
                <Ionicons name="navigate-outline" size={12} color={HomeColors.muted} />
                <Text style={styles.heroRoute}>
                  {routeDistanceKm.toFixed(1)} km · {Math.round(routeDurationMinutes)} min
                </Text>
              </View>
            ) : null}
          </View>

          {remainingEvaluations.length > 0 ? (
            <>
              <Text style={styles.subheading}>Other options</Text>
              {/* Order and scores come straight from MCDA; the recommended
                  mode is already shown above, so ranks continue from 2. */}
              {remainingEvaluations.map((ev, index) => (
                <ModeRankCard
                  key={ev.modeCode}
                  rank={index + 2}
                  evaluation={ev}
                  label={transportModeLabel(ev.modeCode)}
                  maxScore={maxScore}
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {/* Save / log: a follow-up step, not a competing action. Both handlers
          and payloads are unchanged. */}
      <View style={styles.saveSection}>
        <View style={styles.saveHeadRow}>
          <Ionicons name="archive-outline" size={15} color={HomeColors.muted} />
          <Text style={styles.saveHead}>Save this trip</Text>
        </View>

        <View style={styles.saveCard}>
          <Text style={styles.saveActionTitle}>Save as template</Text>
          <Text style={styles.hint}>Reusable route setup you can run again later.</Text>
          <LabeledInput
            label="Template name"
            value={templateName}
            onChangeText={(value) => {
              setTemplateName(value);
              // Clear the inline error as soon as the field holds a value —
              // do not wait for another save attempt.
              if (value.trim() && templateNameError) setTemplateNameError(null);
            }}
            placeholder="e.g. Work commute"
            style={templateNameError ? { borderColor: palette.danger } : undefined}
          />
          {templateNameError ? (
            <Text style={styles.fieldError}>{templateNameError}</Text>
          ) : null}
          <PrimaryButton
            label={savingTemplate ? 'Saving…' : 'Save as template'}
            variant="secondary"
            onPress={handleSaveTemplate}
            disabled={savingTemplate}
            style={styles.saveSecondaryBtn}
          />

          <View style={styles.saveDivider} />

          <Text style={styles.saveActionTitle}>Log to history</Text>
          <Text style={styles.hint}>Records this trip in your trip history.</Text>
          {result?.recommended ? (
            <PrimaryButton
              label={loggingHistory ? 'Logging…' : 'Log to history'}
              onPress={handleLogHistory}
              disabled={loggingHistory}
              style={styles.logBtn}
            />
          ) : (
            <Text style={styles.saveDisabledNote}>
              Optimize a trip first to log it.
            </Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Trip Optimizer presentation tokens.
 *
 * Flat surfaces on the cool light background, navy headings, GasTa green for the
 * single primary action. No gradients, blur, or heavy shadows — the only
 * elevation is a hairline border.
 *
 * The page reads as a guided task flow: a light header, two numbered step
 * blocks (Route, then Vehicle & fuel), one quiet optional tuning block, the
 * main action, the result, and finally the save/log follow-up. Spacing and type
 * scale — not decoration — create that order.
 */
const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    // Extra room so the Save controls and result rows clear the floating tab bar.
    paddingBottom: 120,
  },

  // ------------------------------------------------ numbered step blocks
  stepSection: {
    marginBottom: spacing.xl,
  },
  stepHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.primarySoft,
    borderWidth: 1,
    borderColor: HomeColors.primaryBorder,
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: HomeColors.primaryDark,
  },
  stepHeadText: { flex: 1 },
  stepTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: HomeColors.navy,
  },
  stepHint: {
    fontSize: 13,
    lineHeight: 18,
    color: HomeColors.muted,
    marginTop: 1,
  },

  subheading: {
    ...typography.label,
    color: HomeColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  // Manual-mode helper (no registered vehicles).
  sectionHint: {
    fontSize: 13,
    lineHeight: 19,
    color: HomeColors.muted,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },

  // Route
  pickMapBtn: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
  },
  routeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
    borderWidth: 1,
    borderColor: HomeColors.primaryBorder,
  },
  routeChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: HomeColors.primaryDark,
  },

  // Vehicle & fuel
  vehicleName: {
    fontSize: 16,
    fontWeight: '700',
    color: HomeColors.navy,
    marginBottom: 2,
  },
  vehicleMeta: {
    fontSize: 13,
    color: HomeColors.muted,
    marginBottom: spacing.md,
  },
  catalogChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.forest,
    marginBottom: spacing.md,
  },
  catalogChipTextBlock: {
    flex: 1,
    marginRight: spacing.sm,
  },
  catalogChipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.textOnForest,
  },
  catalogChipMeta: {
    fontSize: 12,
    color: GasTaColors.textOnForest,
    opacity: 0.85,
    marginTop: 2,
  },
  catalogClearBtn: {
    padding: spacing.xs,
  },
  catalogResults: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  catalogResultItem: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
    borderWidth: 1,
    borderColor: HomeColors.primaryBorder,
  },
  catalogResultItemPressed: {
    opacity: 0.85,
  },
  catalogResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: HomeColors.navy,
  },
  catalogResultMeta: {
    fontSize: 12,
    color: HomeColors.muted,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  statLabel: {
    fontSize: 14,
    color: HomeColors.muted,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: HomeColors.navy,
  },
  statDivider: {
    height: 1,
    backgroundColor: HomeColors.border,
  },

  // Restrained inline warning
  warnBox: {
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
    borderLeftWidth: 3,
    borderLeftColor: palette.warning,
  },
  warnTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: HomeColors.navy,
    marginBottom: 2,
  },
  warnBody: {
    fontSize: 13,
    lineHeight: 19,
    color: HomeColors.muted,
    marginBottom: spacing.md,
  },
  warnBtn: {
    borderColor: HomeColors.border,
  },

  // ------------------ what matters more (presets + savings slider)
  // Deliberately the lightest block: tinted surface, muted copy, no step badge.
  prefBlock: {
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.navySoft,
    borderWidth: 1,
    borderColor: HomeColors.border,
    marginBottom: spacing.lg,
  },
  prefHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prefTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: HomeColors.navy,
    flex: 1,
  },
  prefHint: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  tuneError: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.danger,
    marginTop: spacing.xs,
  },

  // --------------------------------------------- main action (the single CTA)
  ctaBlock: {
    marginBottom: spacing.lg,
  },
  optimizeBtn: {
    borderRadius: radii.sm,
  },
  ctaHint: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  // ------------------------------------------------------- result section
  resultSection: {
    marginBottom: spacing.xl,
  },
  resultHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  resultHead: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: HomeColors.navy,
  },
  hero: {
    padding: spacing.md + 2,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
    borderWidth: 1,
    borderColor: HomeColors.primaryBorder,
    borderLeftWidth: 3,
    borderLeftColor: HomeColors.primary,
  },
  heroKicker: {
    ...typography.label,
    color: HomeColors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  heroMode: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: HomeColors.navy,
  },
  heroDivider: {
    height: 1,
    backgroundColor: HomeColors.primaryBorder,
    marginVertical: spacing.sm + 2,
  },
  heroLabel: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
    marginBottom: 2,
  },
  heroValue: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: HomeColors.primaryDark,
  },
  heroRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.sm,
  },
  heroRoute: {
    fontSize: 13,
    fontWeight: '600',
    color: HomeColors.muted,
  },

  // -------------------------------------- save / log (follow-up step)
  saveSection: {
    marginBottom: spacing.xl,
  },
  saveHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  saveHead: {
    fontSize: 14,
    fontWeight: '700',
    color: HomeColors.muted,
  },
  saveCard: {
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
  },
  saveActionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: HomeColors.navy,
    marginBottom: 2,
  },
  saveSecondaryBtn: {
    borderColor: HomeColors.border,
  },
  saveDivider: {
    height: 1,
    backgroundColor: HomeColors.border,
    marginVertical: spacing.md,
  },
  saveDisabledNote: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
  },
  // Inline field validation (template name). Small red helper text, no card.
  fieldError: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.danger,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  logBtn: {
    borderRadius: radii.sm,
  },

  error: { color: palette.danger, fontSize: 13, fontWeight: '600' },
});
