import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

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
import { evaluateModes, weightsSumToOne } from '@/lib/mcda';
import { createSavedTrip } from '@/lib/services/savedTrips';
import { searchPlaces, type PlaceSearchResult } from '@/lib/services/places';
import { fetchRoute, type RouteCoordinate, type RouteResult } from '@/lib/services/routes';
import { logTripToHistory } from '@/lib/services/trips';
import { fetchVehicles } from '@/lib/services/vehicles';
import { buildModeRawScores, calculateTripRecommendation } from '@/lib/tripCalculator';
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
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [originCoordinate, setOriginCoordinate] = useState<RouteCoordinate | null>(null);
  const [destinationCoordinate, setDestinationCoordinate] = useState<RouteCoordinate | null>(null);
  const [pickerTarget, setPickerTarget] = useState<'origin' | 'destination' | null>(null);
  const [pickerRegion, setPickerRegion] = useState<Region>({
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);
  const [pickerSelectionLabel, setPickerSelectionLabel] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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

  const effectiveDistanceKm = route?.distanceKm ?? parseFloat(distance);

  const result = useMemo(() => {
    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = lastRefillPrice ?? 0;
    if (!effectiveDistanceKm || effectiveDistanceKm <= 0 || !price) return null;
    if (!weightsSumToOne(weights)) return null;
    const input = {
      distanceKm: effectiveDistanceKm,
      fuelPricePerLiter: price,
      fuelEfficiencyKmPerLiter: fuelEfficiencyKmPerLiter || 1,
      weights,
    };
    if (!route) return calculateTripRecommendation(input);

    const rawScores = buildModeRawScores(input).map((mode) =>
      mode.modeCode === 'OWN_VEHICLE'
        ? { ...mode, travelTime: route.durationMinutes }
        : mode
    );
    const evaluations = evaluateModes(rawScores, weights).sort(
      (a, b) => b.weightedScore - a.weightedScore
    );
    return { evaluations, recommended: evaluations[0] ?? null };
  }, [effectiveDistanceKm, efficiency, lastRefillPrice, route, weights]);

  const maxScore = result?.evaluations[0]?.weightedScore ?? 1;

  const updateWeight = (key: keyof MCDAWeights, value: string) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return;
    setWeights((prev) => ({ ...prev, [key]: num }));
  };

  const handleRouteLookup = useCallback(async () => {
    if ((!originCoordinate && !origin.trim()) || (!destinationCoordinate && !destination.trim())) {
      setRouteError('Choose and confirm both an origin and destination first.');
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    try {
      const nextRoute = await fetchRoute(
        originCoordinate ?? origin.trim(),
        destinationCoordinate ?? destination.trim()
      );
      setRoute(nextRoute);
      setDistance(String(nextRoute.distanceKm.toFixed(2)));
    } catch (error) {
      setRoute(null);
      setRouteError(error instanceof Error ? error.message : 'Route lookup failed.');
    } finally {
      setRouteLoading(false);
    }
  }, [origin, destination, originCoordinate, destinationCoordinate]);

  const openPicker = (target: 'origin' | 'destination') => {
    const selected = target === 'origin' ? originCoordinate : destinationCoordinate;
    if (selected) {
      setPickerRegion((current) => ({
        ...current,
        latitude: selected.latitude,
        longitude: selected.longitude,
      }));
    }
    setPlaceQuery('');
    setPlaceResults([]);
    setPlacesError(null);
    setSelectedPlace(null);
    setPickerSelectionLabel(null);
    setLocationError(null);
    setPickerTarget(target);
  };

  useEffect(() => {
    if (!pickerTarget) return;
    const existingSelection =
      pickerTarget === 'origin' ? originCoordinate : destinationCoordinate;
    if (existingSelection) return;

    let cancelled = false;
    const loadCurrentLocation = async () => {
      setLocationLoading(true);
      setLocationError(null);
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) setLocationError('Location permission is off. Search for a place instead.');
          return;
        }
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const coordinate = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        setPickerRegion((region) => ({
          ...region,
          ...coordinate,
        }));
        if (pickerTarget === 'origin') {
          setPickerSelectionLabel('Current location');
        }
      } catch {
        if (!cancelled) {
          setLocationError('Current location is unavailable. Search for a place instead.');
        }
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    loadCurrentLocation();
    return () => {
      cancelled = true;
    };
  }, [pickerTarget, originCoordinate, destinationCoordinate]);

  useEffect(() => {
    if (!pickerTarget || !placeQuery.trim()) {
      setPlaceResults([]);
      setPlacesError(null);
      setPlacesLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setPlacesLoading(true);
      setPlacesError(null);
      try {
        const results = await searchPlaces(placeQuery);
        if (!cancelled) setPlaceResults(results);
      } catch (error) {
        if (!cancelled) {
          setPlaceResults([]);
          setPlacesError(error instanceof Error ? error.message : 'Place search failed.');
        }
      } finally {
        if (!cancelled) setPlacesLoading(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickerTarget, placeQuery]);

  const selectPlace = (place: PlaceSearchResult) => {
    setSelectedPlace(place);
    setPickerSelectionLabel(place.name);
    setPickerRegion((current) => ({
      ...current,
      latitude: place.coordinate.latitude,
      longitude: place.coordinate.longitude,
    }));
    setPlaceQuery(place.name);
    setPlaceResults([]);
    setPlacesError(null);
  };

  const confirmPicker = () => {
    if (!pickerTarget) return;
    const coordinate = {
      latitude: pickerRegion.latitude,
      longitude: pickerRegion.longitude,
    };
    if (pickerTarget === 'origin') {
      setOriginCoordinate(coordinate);
      setOrigin(selectedPlace?.name ?? pickerSelectionLabel ?? 'Selected map location');
    } else {
      setDestinationCoordinate(coordinate);
      setDestination(
        selectedPlace?.name ?? pickerSelectionLabel ?? 'Selected map location'
      );
    }
    setRoute(null);
    setRouteError(null);
    setSelectedPlace(null);
    setPickerSelectionLabel(null);
    setPlaceQuery('');
    setPlaceResults([]);
    setPickerTarget(null);
  };

  const handleDistanceChange = (value: string) => {
    setDistance(value);
    setRoute(null);
    setRouteError(null);
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
    const distanceKm = effectiveDistanceKm;
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
  }, [user, requireAuth, templateName, origin, destination, effectiveDistanceKm, selectedVehicleId, weights]);

  const handleLogHistory = useCallback(async () => {
    if (!user && !requireAuth()) return;
    if (!user || !result?.recommended) return;

    setLoggingHistory(true);
    try {
      await logTripToHistory({
        userId: user.id,
        vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
        distanceKm: effectiveDistanceKm,
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
  }, [user, requireAuth, result, selectedVehicleId, effectiveDistanceKm, origin, destination, weights]);

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
  const recommendedEvaluation = result?.evaluations.find(
    (evaluation) => evaluation.modeCode === 'OWN_VEHICLE'
  );
  const selectedVehicleLabel =
    selectedVehicle?.nickname ??
    (selectedVehicle ? `${selectedVehicle.brand} ${selectedVehicle.model}` : 'Manual vehicle details');

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

      <FormSection title="Plan your route" subtitle="Choose two points to calculate your trip" module="trip">
        <View style={styles.routeInputCard}>
          <View style={styles.routeLine}>
            <View style={[styles.routeDot, { backgroundColor: palette.primary }]} />
            <View style={styles.routeLineStem} />
            <View style={[styles.routeDot, styles.destinationDot]} />
          </View>
          <View style={styles.routeFields}>
            <Pressable
              onPress={() => openPicker('origin')}
              style={({ pressed }) => [styles.routeField, pressed && styles.routeFieldPressed]}>
              <Text style={[styles.routeFieldLabel, { color: theme.textSecondary }]}>Origin</Text>
              <Text
                numberOfLines={1}
                style={[styles.routeFieldValue, { color: originCoordinate ? theme.text : theme.textMuted }]}>
                {originCoordinate ? origin : 'Choose a starting point'}
              </Text>
            </Pressable>
            <View style={styles.routeDivider} />
            <Pressable
              onPress={() => openPicker('destination')}
              style={({ pressed }) => [styles.routeField, pressed && styles.routeFieldPressed]}>
              <Text style={[styles.routeFieldLabel, { color: theme.textSecondary }]}>Destination</Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.routeFieldValue,
                  { color: destinationCoordinate ? theme.text : theme.textMuted },
                ]}>
                {destinationCoordinate ? destination : 'Choose a destination'}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.routeActions}>
          <PrimaryButton
            label={originCoordinate ? 'Change origin' : 'Choose origin on map'}
            variant="secondary"
            onPress={() => openPicker('origin')}
            size="sm"
            style={styles.routeAction}
          />
          <PrimaryButton
            label={destinationCoordinate ? 'Change destination' : 'Choose destination on map'}
            variant="secondary"
            onPress={() => openPicker('destination')}
            size="sm"
            style={styles.routeAction}
          />
        </View>
        <View style={styles.manualFallback}>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            Manual distance fallback
          </Text>
          <LabeledInput
            label="Distance (km)"
            value={distance}
            onChangeText={handleDistanceChange}
            keyboardType="decimal-pad"
          />
        </View>
        <PrimaryButton
          label={routeLoading ? 'Planning your trip…' : 'Calculate trip'}
          onPress={handleRouteLookup}
          disabled={routeLoading || (!originCoordinate && !origin.trim()) || (!destinationCoordinate && !destination.trim())}
        />
        {routeLoading && (
          <View style={[styles.loadingCard, { backgroundColor: theme.overlay }]}>
            <ActivityIndicator color={palette.primary} />
            <View style={styles.loadingCopy}>
              <Text style={[styles.loadingTitle, { color: theme.text }]}>Planning your trip</Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                Finding route and estimating travel time…
              </Text>
            </View>
          </View>
        )}
        {route && (
          <Card style={[styles.routeSummary, { backgroundColor: theme.overlay }]}>
            <Text style={[styles.summaryEyebrow, { color: theme.textSecondary }]}>YOUR TRIP</Text>
            <Text style={[styles.summaryRoute, { color: theme.text }]} numberOfLines={2}>
              {routeLabel}
            </Text>
            <View style={styles.summaryMetrics}>
              <View style={styles.summaryMetric}>
                <Text style={[styles.summaryMetricValue, { color: theme.text }]}>
                  {route.distanceKm.toFixed(1)} km
                </Text>
                <Text style={[styles.meta, { color: theme.textSecondary }]}>Distance</Text>
              </View>
              <View style={styles.summaryMetric}>
                <Text style={[styles.summaryMetricValue, { color: theme.text }]}>
                  {route.durationMinutes.toFixed(0)} min
                </Text>
                <Text style={[styles.meta, { color: theme.textSecondary }]}>Travel time</Text>
              </View>
              {recommendedEvaluation && (
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryMetricValue, { color: theme.text }]}>
                    {formatCurrency(recommendedEvaluation.raw.fuelCost)}
                  </Text>
                  <Text style={[styles.meta, { color: theme.textSecondary }]}>Fuel estimate</Text>
                </View>
              )}
            </View>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              Route distance and time are provided by Google Maps.
            </Text>
          </Card>
        )}
        {routeError && <Text style={styles.error}>{routeError}</Text>}
      </FormSection>

      <Modal visible={pickerTarget !== null} animationType="slide" onRequestClose={() => setPickerTarget(null)}>
        <View style={[styles.pickerScreen, { backgroundColor: theme.background }]}>
          <SectionHeader
            title={pickerTarget === 'origin' ? 'Choose Origin' : 'Choose Destination'}
            subtitle="Pan and zoom the map underneath the center pin."
            module="trip"
          />
          <View style={styles.pickerSearchWrap}>
            <TextInput
              value={placeQuery}
              onChangeText={(value) => {
                setPlaceQuery(value);
                setSelectedPlace(null);
                setPickerSelectionLabel(null);
              }}
              placeholder={pickerTarget === 'origin' ? 'Search origin' : 'Search destination'}
              placeholderTextColor={theme.textMuted}
              style={[styles.pickerSearchInput, { color: theme.text, backgroundColor: theme.surface }]}
              autoCorrect={false}
              returnKeyType="search"
            />
            {placesLoading && <ActivityIndicator color={palette.primary} style={styles.searchSpinner} />}
            {placeResults.length > 0 && (
              <Card style={styles.placeResults}>
                {placeResults.map((place) => (
                  <Pressable
                    key={place.id}
                    onPress={() => selectPlace(place)}
                    style={({ pressed }) => [styles.placeResult, pressed && styles.placeResultPressed]}>
                    <Text style={[styles.placeName, { color: theme.text }]}>{place.name}</Text>
                    <Text style={[styles.placeAddress, { color: theme.textSecondary }]}>
                      {place.address}
                    </Text>
                  </Pressable>
                ))}
              </Card>
            )}
          </View>
          {placesError && <Text style={styles.error}>{placesError}</Text>}
          {locationError && <Text style={styles.helperText}>{locationError}</Text>}
          {locationLoading && (
            <View style={styles.locationStatus}>
              <ActivityIndicator color={palette.primary} size="small" />
              <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                Finding your current location…
              </Text>
            </View>
          )}
          {selectedPlace && (
            <Card compact style={styles.selectedPlaceCard}>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>Selected location</Text>
              <Text style={[styles.placeName, { color: theme.text }]}>{selectedPlace.name}</Text>
              <Text style={[styles.placeAddress, { color: theme.textSecondary }]}>
                {selectedPlace.address}
              </Text>
            </Card>
          )}
          <View style={styles.pickerMapFrame}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.pickerMap}
              region={pickerRegion}
              onRegionChangeComplete={setPickerRegion}
              showsCompass
              showsPointsOfInterests
            >
              <Marker coordinate={pickerRegion} pinColor={palette.primary} />
            </MapView>
          </View>
          <Text style={[styles.pickerHint, { color: theme.textSecondary }]}>
            {pickerSelectionLabel
              ? `Selected: ${pickerSelectionLabel}`
              : 'Search for a place or move the map to choose a location.'}
          </Text>
          <PrimaryButton
            label={pickerTarget === 'origin' ? 'Confirm Origin' : 'Confirm Destination'}
            onPress={confirmPicker}
          />
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setPickerTarget(null)}
            style={styles.actionBtn}
          />
        </View>
      </Modal>

      <FormSection title="Vehicle & fuel" subtitle="Used to estimate your trip cost" module="trip">
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
        {!missingLastRefillPrice && (
          <View style={[styles.vehicleSummary, { backgroundColor: theme.overlay }]}>
            <View style={styles.vehicleIcon}>
              <Text style={styles.vehicleIconText}>V</Text>
            </View>
            <View style={styles.vehicleSummaryCopy}>
              <Text style={[styles.vehicleName, { color: theme.text }]}>{selectedVehicleLabel}</Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {efficiency || '—'} km/L fuel efficiency
              </Text>
            </View>
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
            title="Recommendation"
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
  routeInputCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: palette.primarySoft,
    borderRadius: 16,
    padding: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  routeLine: {
    width: 22,
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  destinationDot: {
    backgroundColor: palette.warning,
  },
  routeLineStem: {
    width: 1,
    height: 36,
    backgroundColor: palette.primarySoft,
  },
  routeFields: { flex: 1 },
  routeField: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  routeFieldPressed: { backgroundColor: palette.primarySoft },
  routeFieldLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  routeFieldValue: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  routeDivider: { height: 1, backgroundColor: palette.primarySoft },
  routeActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  routeAction: { flex: 1 },
  manualFallback: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.primarySoft,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  loadingCopy: { flex: 1 },
  loadingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  routeSummary: { marginTop: spacing.sm },
  summaryEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  summaryRoute: { fontSize: 16, fontWeight: '700', lineHeight: 22, marginTop: spacing.xs },
  summaryMetrics: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  summaryMetric: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  summaryMetricValue: { fontSize: 17, fontWeight: '800', marginBottom: 2 },
  vehicleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  vehicleIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleIconText: { color: '#F8F0E5', fontSize: 16, fontWeight: '800' },
  vehicleSummaryCopy: { flex: 1 },
  vehicleName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  error: { color: palette.danger, marginBottom: spacing.sm, fontWeight: '600' },
  actionBtn: { marginTop: spacing.sm },
  pickerScreen: { flex: 1, padding: spacing.lg, paddingTop: spacing.xl },
  pickerMapFrame: {
    flex: 1,
    minHeight: 360,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.primarySoft,
    marginVertical: spacing.md,
  },
  pickerMap: { flex: 1 },
  pickerHint: { textAlign: 'center', marginBottom: spacing.md, fontWeight: '600', lineHeight: 18 },
  helperText: { fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pickerSearchWrap: { position: 'relative', zIndex: 2 },
  pickerSearchInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.primarySoft,
    paddingHorizontal: spacing.md,
    paddingRight: spacing.xl,
    fontSize: 16,
  },
  searchSpinner: { position: 'absolute', right: spacing.md, top: 15 },
  placeResults: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    padding: 0,
    zIndex: 3,
  },
  placeResult: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.primarySoft },
  placeResultPressed: { backgroundColor: palette.successSoft },
  placeName: { fontSize: 15, fontWeight: '700' },
  placeAddress: { fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  selectedPlaceCard: { marginTop: spacing.sm, borderColor: palette.primarySoft },
});
