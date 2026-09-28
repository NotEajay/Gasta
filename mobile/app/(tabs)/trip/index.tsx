import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import ModeRankCard from '@/components/ui/ModeRankCard';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatPeso, transportModeLabel } from '@/lib/format';
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
  /**
   * Inline validation for the missing-template-name case. This replaces the
   * previous `Alert.alert('Name required', ...)` so the field itself shows the
   * problem. It never changes the save payload or the service call.
   */
  const [templateNameError, setTemplateNameError] = useState<string | null>(null);
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
   * These do not introduce a new scoring system: every preset and the slider
   * write straight into the existing `weights` object, so `calculateTripRecommendation`
   * receives exactly the shape it always has. The slider is a 0–1 "savings
   * preference": `fuelCost = value`, `travelTime = 1 - value`, rounded to 2dp so
   * the pair always sums to exactly 1.0 and `weightsSumToOne` stays satisfied.
   */
  const WEIGHT_PRESETS = useMemo(
    () => [
      { key: 'money', label: 'Save money', fuelCost: 0.75, travelTime: 0.25 },
      { key: 'balanced', label: 'Balanced', fuelCost: 0.5, travelTime: 0.5 },
      { key: 'time', label: 'Faster trip', fuelCost: 0.25, travelTime: 0.75 },
    ],
    []
  );

  const savingsFocus = weights.fuelCost;
  const savingsPercent = Math.round(weights.fuelCost * 100);
  const timePercent = Math.round(weights.travelTime * 100);

  /** Applies a two-decimal weight pair that always sums to exactly 1.0. */
  const applyWeightPair = useCallback((fuelCost: number, travelTime: number) => {
    const fuel = Math.round(fuelCost * 100) / 100;
    const time = Math.round(travelTime * 100) / 100;
    setWeights({ fuelCost: fuel, travelTime: time });
  }, []);

  /** Slider handler: one 0–1 value maps to the complementary weight pair. */
  const handleSavingsChange = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      applyWeightPair(clamped, 1 - clamped);
    },
    [applyWeightPair]
  );

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

  const vehicleOptions = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: vehicle.nickname ?? `${vehicle.brand} ${vehicle.model}`,
  }));

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      {/* Refined header. PageHero is intentionally not used here: its full-bleed
          white block and oversized title read heavier than the newer Budget and
          Home headers. This is presentation only — the Saved/History targets
          are the same routes. */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerTitle}>Trip Optimizer</Text>
            <Text style={styles.headerSubtitle}>
              Compare route, travel time, and estimated fuel costs.
            </Text>
          </View>
        </View>
        <View style={styles.headerNavRow}>
          <Link href={'/(tabs)/trip/saved' as never} asChild>
            <Pressable
              accessibilityRole="link"
              style={({ pressed }) => [styles.headerNav, pressed && styles.headerNavPressed]}>
              <Ionicons name="bookmark-outline" size={14} color={HomeColors.navy} />
              <Text style={styles.headerNavText}>Saved</Text>
            </Pressable>
          </Link>
          <Link href={'/(tabs)/trip/history' as never} asChild>
            <Pressable
              accessibilityRole="link"
              style={({ pressed }) => [styles.headerNav, pressed && styles.headerNavPressed]}>
              <Ionicons name="time-outline" size={14} color={HomeColors.navy} />
              <Text style={styles.headerNavText}>History</Text>
            </Pressable>
          </Link>
        </View>
      </View>

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
              Pick the vehicle and fuel price used for the estimate.
            </Text>
          </View>
        </View>

        {hasRegisteredVehicles ? (
          <>
            <ChipSelect
              label="Your vehicle"
              options={vehicleOptions}
              value={selectedVehicle?.id ?? null}
              onChange={(vehicleId) => setSelectedVehicleId(vehicleId)}
            />

            {selectedVehicle ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.vehicleName}>
                {selectedVehicle.nickname ??
                  `${selectedVehicle.brand} ${selectedVehicle.model}`}
              </Text>
            ) : null}
            {selectedVehicle?.nickname ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.vehicleMeta}>
                {selectedVehicle.brand} {selectedVehicle.model}
              </Text>
            ) : null}

            {/* Restrained inline warning; the blocking behaviour is unchanged. */}
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
                {/* This is a RATE used for estimation, never money spent. */}
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
              No vehicle registered. Enter your fuel details manually.
            </Text>
            <LabeledInput
              label="Fuel efficiency"
              value={efficiency}
              onChangeText={setEfficiency}
              keyboardType="decimal-pad"
              placeholder="14.0"
            />
            <LabeledInput
              label="Fuel price"
              value={manualLastRefillPrice}
              onChangeText={setManualLastRefillPrice}
              keyboardType="decimal-pad"
              placeholder="62.50"
            />
          </>
        )}
      </View>

      {/*
        Preference, not a raw weight editor. The presets and the slider are two
        views of the SAME `weights` state — there is no duplicate weight state
        and no new scoring path.
      */}
      <View style={styles.prefBlock}>
        <View style={styles.prefHeadRow}>
          <Ionicons name="options-outline" size={15} color={HomeColors.muted} />
          <Text style={styles.prefTitle}>What matters more?</Text>
        </View>
        <Text style={styles.prefHint}>
          Choose how GasTa should balance saving money and travel time.
        </Text>

        <View style={styles.presetRow}>
          {WEIGHT_PRESETS.map((preset) => {
            const selected =
              Math.abs(weights.fuelCost - preset.fuelCost) < 0.005 &&
              Math.abs(weights.travelTime - preset.travelTime) < 0.005;
            return (
              <Pressable
                key={preset.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={preset.label}
                onPress={() => applyWeightPair(preset.fuelCost, preset.travelTime)}
                style={({ pressed }) => [
                  styles.preset,
                  selected && styles.presetSelected,
                  pressed && styles.presetPressed,
                ]}>
                <Text
                  numberOfLines={1}
                  style={[styles.presetLabel, selected && styles.presetLabelSelected]}>
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.sliderBlock}>
          <View style={styles.sliderLabelsRow}>
            <Text style={[styles.sliderEndLabel, savingsFocus > 0.5 && styles.sliderEndLabelActive]}>
              Save money
            </Text>
            <Text style={[styles.sliderEndLabel, savingsFocus < 0.5 && styles.sliderEndLabelActive]}>
              Faster trip
            </Text>
          </View>
          <Slider
            accessibilityLabel="Balance between saving money and travel time"
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={savingsFocus}
            onValueChange={handleSavingsChange}
            minimumTrackTintColor={HomeColors.primary}
            maximumTrackTintColor={HomeColors.border}
            thumbTintColor={HomeColors.primary}
          />
          <Text style={styles.prefDetail}>
            {savingsPercent}% savings · {timePercent}% travel time
          </Text>
        </View>

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

  // ------------------------------------------------------------- header
  header: {
    marginBottom: spacing.xl,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headerTitleBlock: { flex: 1 },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: HomeColors.navy,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: HomeColors.muted,
    marginTop: 3,
  },
  // Secondary actions, not loose standalone text lines.
  headerNavRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  headerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
  },
  headerNavPressed: { opacity: 0.7 },
  headerNavText: {
    fontSize: 13,
    fontWeight: '600',
    color: HomeColors.navy,
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
  presetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Comfortable tap target (~36pt tall) for each preset.
  preset: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
  },
  presetSelected: {
    backgroundColor: HomeColors.primarySoft,
    borderColor: HomeColors.primary,
  },
  presetPressed: { opacity: 0.75 },
  presetLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: HomeColors.muted,
    textAlign: 'center',
  },
  presetLabelSelected: {
    color: HomeColors.primaryDark,
    fontWeight: '700',
  },
  sliderBlock: {
    marginTop: spacing.md,
  },
  sliderLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Endpoint labels; the active side is emphasised rather than both shouted.
  sliderEndLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: HomeColors.muted,
  },
  sliderEndLabelActive: {
    color: HomeColors.primaryDark,
    fontWeight: '700',
  },
  slider: {
    height: 36,
    marginHorizontal: -spacing.xs,
    marginTop: 2,
  },
  // Derived from the live weights — not stored separately.
  prefDetail: {
    fontSize: 12,
    lineHeight: 17,
    color: HomeColors.muted,
    textAlign: 'center',
    marginTop: 2,
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
