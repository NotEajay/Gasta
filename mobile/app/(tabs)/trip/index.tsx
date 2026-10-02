import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import TripSectionHeader from '@/components/trip/TripSectionHeader';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import ModeRankCard from '@/components/ui/ModeRankCard';
import PrimaryButton from '@/components/ui/PrimaryButton';
import PriorityBalanceBar from '@/components/ui/PriorityBalanceBar';
import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import { TRANSPORT_MODE_DEFAULTS } from '@/constants/tripDefaults';
import type { TransportModeCode } from '@/constants/transportModes';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatPeso, transportModeLabel } from '@/lib/format';
import { weightsSumToOne } from '@/lib/mcda';
import { createSavedTrip } from '@/lib/services/savedTrips';
import { logTripToHistory } from '@/lib/services/trips';
import {
  regionForTrip,
  resolveTripFuelPrice,
  type TripFuelPriceResult,
} from '@/lib/services/tripFuelPrice';
import {
  matchBulletinArea,
  regionFromCoordinates,
  reverseGeocodeCityOnly,
} from '@/lib/services/location';
import { fetchBulletinAreas, fetchLatestBulletinForRegion } from '@/lib/services/fuelPrices';
import type { DoeRegionCode } from '@/constants/regions';
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
  type PickedRoutePoint,
  type RouteLocation,
} from '@/lib/services/routeSelection';
import {
  PlacesAutocompleteError,
  resolvePlaceSuggestion,
  searchPlaceSuggestions,
  type PlaceSuggestion,
} from '@/lib/services/googlePlacesAutocomplete';
import { getReadableAddress } from '@/lib/services/googleGeocoding';
import { useTheme } from '@/lib/useTheme';
import type { MCDAWeights, ModeEvaluation } from '@/types/mcda';
import type { Vehicle, VehicleCatalogEntry } from '@/types';

type RouteField = 'origin' | 'destination';

type PlaceSearchState = {
  field: RouteField | null;
  query: string;
  loading: boolean;
  suggestions: PlaceSuggestion[];
  error: string | null;
};

const EMPTY_PLACE_SEARCH: PlaceSearchState = {
  field: null,
  query: '',
  loading: false,
  suggestions: [],
  error: null,
};

const COMPARE_TRANSPORT_ROWS: {
  code: TransportModeCode;
  title: string;
  tint: 'own' | 'jeepney' | 'tricycle' | 'rideHailing' | 'walking';
}[] = [
  { code: 'OWN_VEHICLE', title: 'Own vehicle', tint: 'own' },
  { code: 'JEEPNEY', title: 'Jeepney', tint: 'jeepney' },
  { code: 'TRICYCLE', title: 'Tricycle', tint: 'tricycle' },
  { code: 'RIDE_HAILING', title: 'Ride-hailing', tint: 'rideHailing' },
  { code: 'WALKING', title: 'Walking', tint: 'walking' },
];

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
  /**
   * Destination coordinates, kept alongside the Directions string so the trip
   * can be mapped to a DOE pricing area. `destinationRouteValue` is a
   * "lat,lng" payload consumed by Google Maps and is not meant to be parsed by
   * feature code, so the point is retained directly from the picker instead.
   * Stays null when the destination was typed as free text.
   */
  const [destinationPoint, setDestinationPoint] = useState<RouteLocation | null>(null);
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
  const [optimizing, setOptimizing] = useState(false);
  const [placeSearch, setPlaceSearch] = useState<PlaceSearchState>(EMPTY_PLACE_SEARCH);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const placeSearchRequestId = useRef(0);
  const placeResolveRequestId = useRef(0);
  const placeSearchAbort = useRef<AbortController | null>(null);
  const placeSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setDestinationPoint(selection.destination);
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

  /*
   * Trusted fuel price for this trip.
   *
   * Replaces `vehicle.last_refill_price` as the optimizer's price input. A
   * refill figure is what the driver happened to pay at one past fill-up, which
   * is a poor proxy for what fuel costs around the trip being planned. The
   * resolver prefers a fresh VERIFIED community price for the trip's region and
   * the vehicle's fuel type, then falls back to the official DOE bulletin.
   * Pending / unverified community reports are never consulted.
   *
   * A manual trip still lets the user type a price, because that is an explicit
   * input for this specific trip rather than a stored historical value.
   */
  const [tripFuelPrice, setTripFuelPrice] = useState<TripFuelPriceResult | null>(null);
  const [tripFuelPriceLoading, setTripFuelPriceLoading] = useState(false);
  /*
   * Optional per-trip price override.
   *
   * Off by default, so the trusted automatic price (verified community > DOE) is
   * what normally drives the cost. Toggled on only when the driver knows better
   * than the bulletin -- e.g. they just paid, or saw a price at a station.
   *
   * Lifetime is intentionally one screen. It is never written back to the
   * vehicle, never turned into a refill, and never submitted as a community
   * report, so it cannot silently become a trusted price for anyone else.
   */
  const [useCustomFuelPrice, setUseCustomFuelPrice] = useState(false);
  const [customFuelPriceInput, setCustomFuelPriceInput] = useState('');
  const [customFuelPriceError, setCustomFuelPriceError] = useState<string | null>(null);
  /**
   * The comparison result is presented in a bottom sheet, which is the single
   * canonical place it appears. The form underneath keeps its state, so
   * dismissing the sheet never costs the user their inputs.
   */
  const [showResultSheet, setShowResultSheet] = useState(false);

  const manualPriceValue = useMemo(() => {
    if (!isManualVehicle && !useCustomFuelPrice) return null;
    const manual = parseFloat(customFuelPriceInput);
    return Number.isFinite(manual) && manual > 0 ? manual : null;
  }, [isManualVehicle, useCustomFuelPrice, customFuelPriceInput]);

  /*
   * Where the fuel for this trip would actually be bought.
   *
   * ORIGIN first, not destination. An own-vehicle trip normally fuels up near
   * where it starts, so pricing the trip at the destination area was quietly
   * wrong for any long cross-region route. The destination is still used, fully,
   * for routing and the Directions call.
   *
   * Precedence:
   *   1. explicit origin coordinates (picked on the map)
   *   2. the device's current location, when there is no explicit origin
   *   3. nearest-centroid region from those coordinates
   *   4. the area a bulletin actually publishes for that region
   *   5. nothing -> the screen says the price is unavailable
   */
  const [originPlace, setOriginPlace] = useState<{
    regionCode: DoeRegionCode;
    city: string | null;
  } | null>(null);
  const [originArea, setOriginArea] = useState<string | null>(null);

  const tripRegion = useMemo(
    () => originPlace?.regionCode ?? regionForTrip([originLocation]),
    [originPlace, originLocation]
  );

  /*
   * Only ever reached once a region is known, and it resolves the bulletin
   * itself rather than depending on Prices state: Trip does not hold a
   * bulletin. It asks the region for its real areas and returns a matching real
   * area name, or null. It never invents one, so a failed match simply leaves
   * Area unset and the price falls back to the region figure.
   */
  useEffect(() => {
    if (!originPlace) {
      setOriginArea(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const week = await fetchLatestBulletinForRegion(originPlace.regionCode);
        if (cancelled || !week) {
          setOriginArea(null);
          return;
        }
        const areas = await fetchBulletinAreas(week.id, originPlace.regionCode);
        if (!cancelled) setOriginArea(matchBulletinArea(originPlace.city, areas));
      } catch {
        if (!cancelled) setOriginArea(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [originPlace]);

  /*
   * Derive the origin's place from the origin the map picker returned.
   *
   * There is deliberately NO second location control on this screen: the picker
   * already offers "Current location", and it is the single place location is
   * chosen. What this screen needs is not a control but the resolved geography
   * for whatever origin came back.
   *
   * The region is computed synchronously from the coordinates, so the price
   * geography is correct immediately. The city is reverse-geocoded once per
   * origin change (and the location service caches per session), purely to try
   * to match a real bulletin area. A failed or absent city is harmless: the
   * area simply stays unset and pricing falls back to the regional figure.
   */
  useEffect(() => {
    if (!originLocation) {
      setOriginPlace(null);
      return;
    }
    const regionCode = regionFromCoordinates(originLocation.latitude, originLocation.longitude);
    let cancelled = false;
    void reverseGeocodeCityOnly(originLocation.latitude, originLocation.longitude).then(
      (city) => {
        if (cancelled) return;
        setOriginPlace({ regionCode, city });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [originLocation]);

  /*
   * The single number the existing MCDA consumes. `calculateTripRecommendation`
   * takes a plain `fuelPricePerLiter: number` and that contract is preserved:
   * only the *source* of the number changed. It stays null when no trusted
   * price exists, so the optimizer refuses to score rather than invent a cost.
   */
  const effectiveFuelPrice = useMemo(() => {
    // Precedence: manual > verified community > DOE > unavailable.
    if (manualPriceValue != null) return manualPriceValue;
    if (isManualVehicle) return null;
    if (!tripFuelPrice || tripFuelPrice.status !== 'ok') return null;
    return tripFuelPrice.price.pricePerLiter;
  }, [manualPriceValue, isManualVehicle, tripFuelPrice]);

  /**
   * Own-vehicle cost breakdown, derived from the SAME numbers the calculator
   * already used.
   *
   * `buildModeRawScores` computes `ownFuelCost` as exactly
   * `(distanceKm / fuelEfficiencyKmPerLiter) * fuelPricePerLiter`, so the litres
   * shown here are that same quotient and the total is the figure MCDA already
   * produced. Nothing is recomputed with a second formula, and
   * `tripCalculator.ts` is untouched -- `raw.fuelCost` is displayed as the total
   * rather than being multiplied out again.
   */
  const ownVehicleBreakdown = useMemo(() => {
    if (!result || result.recommended.modeCode !== 'OWN_VEHICLE') return null;
    if (routeDistanceKm == null || effectiveFuelPrice == null) return null;
    const efficiencyKmPerLiter = parseFloat(efficiency);
    if (!Number.isFinite(efficiencyKmPerLiter) || efficiencyKmPerLiter <= 0) return null;

    const litersNeeded = routeDistanceKm / efficiencyKmPerLiter;
    return {
      distanceKm: routeDistanceKm,
      efficiencyKmPerLiter,
      litersNeeded,
      pricePerLiter: effectiveFuelPrice,
      // The authoritative total: straight from the MCDA evaluation.
      totalCost: result.recommended.raw.fuelCost,
    };
  }, [result, routeDistanceKm, effectiveFuelPrice, efficiency]);

  /** Which source produced the number the MCDA used, for the result card. */
  const fuelPriceProvenance = useMemo(() => {
    if (manualPriceValue != null) {
      return { label: 'Your price', detail: 'Entered for this trip only' };
    }
    if (tripFuelPrice?.status === 'ok') {
      return { label: tripFuelPrice.price.sourceLabel, detail: tripFuelPrice.price.detail };
    }
    return null;
  }, [manualPriceValue, tripFuelPrice]);

  /**
   * Per-mode confidence line, straight from the fare configuration.
   *
   * A mode with `fareSource` is a regulated figure and names the guide and its
   * class. A mode without one is a local assumption, and says so. That
   * distinction is the point: the optimizer may compare them, but it must not
   * present all of them as equally authoritative.
   *
   * Declared after `fuelPriceProvenance` because it reads it.
   */
  const modeFareNote = useCallback(
    (mode: TransportModeCode): string => {
      if (mode === 'OWN_VEHICLE') {
        return fuelPriceProvenance
          ? `Estimated fuel cost · ${fuelPriceProvenance.label}`
          : 'Estimated fuel cost';
      }
      if (mode === 'WALKING') return 'No fare';
      const defaults =
        TRANSPORT_MODE_DEFAULTS[mode as Exclude<TransportModeCode, 'OWN_VEHICLE'>];
      if (!defaults) return '';
      const modeName = transportModeLabel(mode).toLowerCase();
      if (defaults.fareSource) {
        return `Estimated ${modeName} fare · ${defaults.fareSource.authority}, ${defaults.fareSource.className}`;
      }
      if (mode === 'RIDE_HAILING') {
        return `Estimated ${modeName} fare · actual booking fare may vary`;
      }
      if (mode === 'TRICYCLE') {
        return `Estimated ${modeName} fare · local fares may vary`;
      }
      return `Estimated ${modeName} fare · based on configured fare rules`;
    },
    [fuelPriceProvenance]
  );

  /**
   * What the recommended mode's cost number actually represents.
   *
   * For OWN_VEHICLE it really is a fuel cost: a trusted price multiplied by the
   * litres the trip needs. For every other mode `raw.fuelCost` is a FARE taken
   * from the configured constants, so calling it "fuel cost" was simply wrong.
   * They are estimates from static configuration, not quotes, and the copy now
   * says so rather than implying a live or exact fare.
   */
  const recommendedCost = useMemo(() => {
    const mode = result?.recommended?.modeCode;
    if (!mode) return null;
    if (mode === 'OWN_VEHICLE') {
      return {
        label: 'Estimated fuel cost',
        sourceNote: fuelPriceProvenance
          ? `${fuelPriceProvenance.label} · ${fuelPriceProvenance.detail}`
          : null,
        disclaimer: null as string | null,
      };
    }
    const modeName = transportModeLabel(mode).toLowerCase();
    return {
      label: `Estimated ${modeName} fare`,
      sourceNote: 'Based on configured fare rules',
      disclaimer:
        mode === 'RIDE_HAILING' ? 'Actual app fare may vary with traffic and demand.' : null,
    };
  }, [result, fuelPriceProvenance]);

  const missingFuelPrice =
    !isManualVehicle && tripFuelPrice !== null && tripFuelPrice.status === 'unavailable';

  /*
   * Resolve the trusted price whenever the inputs that define it change.
   *
   * Keyed on the vehicle's fuel type and the trip's region, so switching
   * vehicle, changing destination, or moving to a different DOE area recomputes
   * the source and its date. A stale price from a previous selection cannot
   * survive: the previous result is cleared before the new one is requested,
   * and the fetch is guarded against out-of-order resolution.
   */
  useEffect(() => {
    if (isManualVehicle) {
      setTripFuelPrice(null);
      setTripFuelPriceLoading(false);
      return;
    }
    const fuelTypeId = selectedVehicle?.fuel_type_id ?? null;
    if (!fuelTypeId || !tripRegion) {
      setTripFuelPrice(null);
      setTripFuelPriceLoading(false);
      return;
    }

    let cancelled = false;
    setTripFuelPriceLoading(true);
    setTripFuelPrice(null);
    void resolveTripFuelPrice({ fuelTypeId, regionCode: tripRegion, areaName: originArea })
      .then((result) => {
        if (!cancelled) setTripFuelPrice(result);
      })
      .catch(() => {
        if (!cancelled) {
          setTripFuelPrice({
            status: 'unavailable',
            reason: 'error',
            message: 'Could not load current fuel prices.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setTripFuelPriceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isManualVehicle, selectedVehicle?.fuel_type_id, tripRegion, originArea]);

  useEffect(() => {
    if (!useCustomFuelPrice && !customFuelPriceError) return;
    const raw = customFuelPriceInput.trim();
    if (raw === '') {
      setCustomFuelPriceError(null);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setCustomFuelPriceError('Enter a number, for example 80.00');
    } else if (value <= 0) {
      setCustomFuelPriceError('Enter a price greater than zero.');
    } else {
      setCustomFuelPriceError(null);
    }
  }, [customFuelPriceInput, useCustomFuelPrice, customFuelPriceError]);

  const optimizeRequestId = useRef(0);

  /*
   * Inputs stay editable without recalculating. Changing them invalidates the
   * COMPARISON, so the stale result and sheet are cleared here.
   *
   * It deliberately does NOT clear `routeDistanceKm` / `routeDurationMinutes`.
   * It used to, and that was the source of a visible blink: every origin or
   * destination keystroke wiped the distance, then the debounced preview
   * restored it ~600ms later, so the row blinked out and back on each change.
   * The route preview effect above now owns those two values and keeps the last
   * good figure until its replacement genuinely arrives.
   *
   * Weight changes still do not clear the route -- they live-rescore the
   * existing distance and time.
   */
  useEffect(() => {
    optimizeRequestId.current += 1;
    setOptimizing(false);
    setResult(null);
    setRouteError(null);
    setLastOptimizeElapsedMs(null);
    setShowResultSheet(false);
  }, [
    destination,
    destinationRouteValue,
    efficiency,
    isManualVehicle,
    effectiveFuelPrice,
    manualLastRefillPrice,
    origin,
    originLocation,
    selectedVehicleId,
  ]);

  // Live SAW rescore when priorities change after a successful Optimize.
  useEffect(() => {
    if (routeDistanceKm == null || routeDurationMinutes == null) return;

    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = effectiveFuelPrice;
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
  }, [weights, routeDistanceKm, routeDurationMinutes, efficiency, effectiveFuelPrice]);

  /*
   * Resolve the driving route as soon as the endpoints are set.
   *
   * Distance used to appear only after "Compare trip costs", because the single
   * Directions call lived inside the optimize handler. That made a user pick two
   * endpoints and get nothing back until they had also committed to a
   * comparison -- the number needed in order to judge the route was hidden behind
   * the very action meant to use it.
   *
   * This resolves the route on its own, from route/directions state, so the
   * Route card updates as soon as the endpoints settle. The optimize handler
   * keeps its own call, because scoring needs a duration fetched at that moment.
   *
   * Debounced so it never fires per keystroke, and guarded so a stale response
   * from a previous pair of endpoints cannot overwrite the current one. Clearing
   * the endpoints clears the distance rather than leaving a stale figure.
   */
  /*
   * Whether a replacement route is in flight.
   *
   * Kept SEPARATE from `routeDistanceKm` on purpose. A single piece of state
   * forced a choice: either keep showing the old distance while the new one
   * loads (then the number is briefly wrong), or clear it (then the row blinks
   * out and back). Holding the last good value and flagging "loading"
   * independently lets the row stay put and just read `Updating…`.
   */
  const [routePreviewLoading, setRoutePreviewLoading] = useState(false);

  useEffect(() => {
    const originText = origin.trim();
    const destinationText = destination.trim();

    // Only an ACTUALLY cleared endpoint removes the preview. Changing one keeps
    // the last valid distance on screen until its replacement arrives.
    if (!originText || !destinationText) {
      setRoutePreviewLoading(false);
      setRouteDistanceKm(null);
      setRouteDurationMinutes(null);
      return;
    }

    const originForDirections = originLocation
      ? `${originLocation.latitude},${originLocation.longitude}`
      : originText;
    const destinationForDirections = destinationRouteValue || destinationText;

    let cancelled = false;
    setRoutePreviewLoading(true);

    const timer = setTimeout(() => {
      void getDrivingRoute(originForDirections, destinationForDirections)
        .then((route) => {
          if (cancelled) return;
          // Both values land in the same commit, so the chip never shows a new
          // distance beside a stale duration.
          setRouteDistanceKm(route.distanceKm);
          setRouteDurationMinutes(route.durationMinutes);
          setRoutePreviewLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          // A failed replacement does NOT erase a preview that was working. The
          // value simply stays as it was, and the compare action reports the
          // failure properly if the route truly cannot be resolved.
          setRoutePreviewLoading(false);
        });
    }, ROUTE_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      // Timer cleared here, so a superseded request never sets the flag off
      // while the newer one is still in flight.
      clearTimeout(timer);
    };
  }, [origin, destination, originLocation, destinationRouteValue]);

  /**
   * Every successful "Compare trip costs" writes Trip History automatically.
   * Failures are quiet so a history write never blocks the cost popup.
   */
  const autoLogTripHistory = useCallback(
    async (
      scored: NonNullable<ReturnType<typeof calculateTripRecommendation>>,
      distanceKm: number,
    ) => {
      if (!user || !scored.recommended) return;
      try {
        await logTripToHistory({
          userId: user.id,
          vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
          distanceKm,
          originLabel: origin.trim() || undefined,
          destinationLabel: destination.trim() || undefined,
          weights,
          evaluations: scored.evaluations,
          recommendedModeCode: scored.recommended.modeCode,
        });
      } catch (error) {
        console.warn('[Trip Optimizer] Auto-log to history failed', error);
      }
    },
    [destination, origin, selectedVehicleId, user, weights],
  );

  const handleRouteQueryChange = useCallback(
    (field: RouteField, value: string) => {
      if (field === 'origin') {
        setOrigin(value);
        setOriginLocation(null);
        setOriginPlace(null);
      } else {
        setDestination(value);
        setDestinationRouteValue('');
        setDestinationPoint(null);
      }

      placeSearchRequestId.current += 1;
      placeSearchAbort.current?.abort();
      placeSearchAbort.current = null;
      if (placeSearchTimer.current) {
        clearTimeout(placeSearchTimer.current);
        placeSearchTimer.current = null;
      }

      const trimmed = value.trim();
      if (trimmed.length < 2) {
        setPlaceSearch(EMPTY_PLACE_SEARCH);
        setResolvingPlaceId(null);
        return;
      }

      const requestId = ++placeSearchRequestId.current;
      const abortController = new AbortController();
      placeSearchAbort.current = abortController;
      const biasPoint =
        field === 'destination'
          ? originLocation
          : destinationPoint
            ? {
                latitude: destinationPoint.latitude,
                longitude: destinationPoint.longitude,
              }
            : null;

      placeSearchTimer.current = setTimeout(() => {
        setPlaceSearch({
          field,
          query: trimmed,
          loading: true,
          suggestions: [],
          error: null,
        });
        void searchPlaceSuggestions(
          trimmed,
          biasPoint
            ? { latitude: biasPoint.latitude, longitude: biasPoint.longitude }
            : undefined,
          abortController.signal,
        )
          .then((suggestions) => {
            if (requestId !== placeSearchRequestId.current) return;
            setPlaceSearch({
              field,
              query: trimmed,
              loading: false,
              suggestions,
              error: null,
            });
          })
          .catch((error) => {
            if (
              requestId !== placeSearchRequestId.current ||
              abortController.signal.aborted
            ) {
              return;
            }
            setPlaceSearch({
              field,
              query: trimmed,
              loading: false,
              suggestions: [],
              error:
                error instanceof PlacesAutocompleteError
                  ? error.userMessage
                  : 'Could not search for that location.',
            });
          })
          .finally(() => {
            if (placeSearchAbort.current === abortController) {
              placeSearchAbort.current = null;
            }
          });
      }, 300);
    },
    [destinationPoint, originLocation],
  );

  const handlePlaceSuggestionPress = useCallback(
    async (field: RouteField, suggestion: PlaceSuggestion) => {
      const requestId = ++placeResolveRequestId.current;
      setResolvingPlaceId(suggestion.placeId);
      setPlaceSearch({
        field,
        query: suggestion.description,
        loading: false,
        suggestions: [],
        error: null,
      });

      if (field === 'origin') {
        setOrigin(suggestion.description);
        setOriginLocation(null);
        setOriginPlace(null);
      } else {
        setDestination(suggestion.description);
        setDestinationRouteValue('');
        setDestinationPoint(null);
      }

      try {
        const place = await resolvePlaceSuggestion(suggestion.placeId);
        if (requestId !== placeResolveRequestId.current) return;

        const point: PickedRoutePoint = {
          displayName:
            field === 'origin'
              ? getReadableAddress(place.description)
              : place.description,
          latitude: place.latitude,
          longitude: place.longitude,
          directionsValue: `${place.latitude},${place.longitude}`,
        };

        if (field === 'origin') {
          setOrigin(point.displayName);
          setOriginLocation(point);
        } else {
          setDestination(point.displayName);
          setDestinationRouteValue(point.directionsValue);
          setDestinationPoint(point);
        }
        setPlaceSearch(EMPTY_PLACE_SEARCH);
        setResolvingPlaceId(null);
      } catch (error) {
        if (requestId !== placeResolveRequestId.current) return;
        setResolvingPlaceId(null);
        setPlaceSearch({
          field,
          query: suggestion.description,
          loading: false,
          suggestions: [],
          error:
            error instanceof PlacesAutocompleteError
              ? error.userMessage
              : "Could not load that place's exact location.",
        });
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      placeSearchRequestId.current += 1;
      placeResolveRequestId.current += 1;
      placeSearchAbort.current?.abort();
      if (placeSearchTimer.current) clearTimeout(placeSearchTimer.current);
    };
  }, []);

  const handleOptimize = useCallback(async () => {
    if (optimizing) return;

    if (!origin.trim() || !destination.trim()) {
      setRouteError('Enter both an origin and a destination before optimizing.');
      return;
    }

    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = effectiveFuelPrice;
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
      // Refuse to score rather than inventing a cost. The MCDA still needs one
      // numeric fuel price, so a route with no trusted price simply is not
      // ranked until a current DOE, verified community, or user-entered price
      // exists.
      Alert.alert(
        'Current fuel price unavailable',
        isManualVehicle
          ? 'Enter the fuel price (₱/L) for this trip before optimizing.'
          : customFuelPriceError ??
            (tripFuelPrice?.status === 'unavailable'
              ? tripFuelPrice.message
              : 'No current DOE or verified community price is available for this fuel yet.')
      );
      return;
    }

    const scoreTrip = (distanceKm: number, durationMinutes: number) =>
      calculateTripRecommendation({
        distanceKm,
        fuelPricePerLiter: price,
        fuelEfficiencyKmPerLiter,
        weights,
        ownVehicleTravelTimeMinutes: durationMinutes,
      });

    /*
     * Fast path: the live route preview already produced distance, duration,
     * and (usually) a scored result. Opening the sheet immediately is what
     * "Compare trip costs" should feel like — a second Directions round-trip
     * is unnecessary and was easy to cancel via optimizeRequestId races.
     */
    if (routeDistanceKm != null && routeDurationMinutes != null) {
      const next =
        result?.recommended != null
          ? result
          : scoreTrip(routeDistanceKm, routeDurationMinutes);
      if (!result?.recommended) setResult(next);
      setShowResultSheet(true);
      setRouteError(null);
      void autoLogTripHistory(next, routeDistanceKm);
      return;
    }

    const requestId = ++optimizeRequestId.current;
    const startedAt = Date.now();
    let outcome: 'success' | 'error' = 'error';
    let routeResult: DirectionsRoute | null = null;

    setOptimizing(true);
    setRouteError(null);

    try {
      const originForDirections = originLocation
        ? `${originLocation.latitude},${originLocation.longitude}`
        : origin;
      const destinationForDirections = destinationRouteValue || destination;

      routeResult = await getDrivingRoute(originForDirections, destinationForDirections);
      if (requestId !== optimizeRequestId.current) return;

      const scored = scoreTrip(routeResult.distanceKm, routeResult.durationMinutes);
      setRouteDistanceKm(routeResult.distanceKm);
      setRouteDurationMinutes(routeResult.durationMinutes);
      setResult(scored);
      setShowResultSheet(true);
      void autoLogTripHistory(scored, routeResult.distanceKm);
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
    autoLogTripHistory,
    customFuelPriceError,
    destination,
    destinationRouteValue,
    efficiency,
    isManualVehicle,
    effectiveFuelPrice,
    optimizing,
    origin,
    originLocation,
    result,
    routeDistanceKm,
    routeDurationMinutes,
    selectedVehicle,
    tripFuelPrice,
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

  /** Fast lookup for the Compare Transport preview column. */
  const evaluationByMode = useMemo(() => {
    const map = new Map<TransportModeCode, ModeEvaluation>();
    if (!result) return map;
    for (const evaluation of result.evaluations) {
      map.set(evaluation.modeCode, evaluation);
    }
    return map;
  }, [result]);

  const modeRowTintStyle = {
    own: styles.modeRowOwn,
    jeepney: styles.modeRowJeepney,
    tricycle: styles.modeRowTricycle,
    rideHailing: styles.modeRowRideHailing,
    walking: styles.modeRowWalking,
  } as const;

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

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (loading) return <LoadingState message="Loading trip data…" />;

  return (
    <View style={styles.flex}>
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <TripSectionHeader active="new" />

      {/*
        ROUTE. One warm-white surface holding the two endpoints, the map
        picker and the live distance summary. The picker, its params and the
        Google Directions call are all unchanged -- only the presentation moved
        onto a card.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Route</Text>
        <View style={styles.sectionCard}>
          {/*
            The two endpoints are the most important content in this card, so
            they are the largest thing in it. The label sits INSIDE the field as
            a small uppercase eyebrow rather than above it, which puts the
            address on the first line the eye lands on and removes a row of
            chrome from each field.

            Both remain real `TextInput`s, so typing works exactly as before and
            there is no duplicate route state: the same `origin` / `destination`
            values and the same `setOriginLocation(null)` on edit are all that
            drive selection, pricing and routing.
          */}
          <View style={styles.routeFields}>
            <View style={styles.routeField}>
              <Text style={styles.routeFieldLabel}>Origin</Text>
              <TextInput
                value={origin}
                onChangeText={(value) => handleRouteQueryChange('origin', value)}
                onFocus={() => {
                  if (origin.trim().length >= 2 && placeSearch.field !== 'origin') {
                    handleRouteQueryChange('origin', origin);
                  }
                }}
                placeholder="Search starting point"
                placeholderTextColor={GasTaColors.textMuted}
                style={styles.routeFieldInput}
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            {placeSearch.field === 'origin' ? (
              <View style={styles.suggestionList}>
                {placeSearch.loading || resolvingPlaceId ? (
                  <Text style={styles.suggestionStatus}>Searching places…</Text>
                ) : null}
                {placeSearch.error ? (
                  <Text style={styles.suggestionError}>{placeSearch.error}</Text>
                ) : null}
                {!placeSearch.loading &&
                !resolvingPlaceId &&
                !placeSearch.error &&
                placeSearch.suggestions.length === 0 &&
                placeSearch.query.length >= 2 ? (
                  <Text style={styles.suggestionStatus}>No matching places</Text>
                ) : null}
                {placeSearch.suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.placeId}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${suggestion.description}`}
                    onPress={() => void handlePlaceSuggestionPress('origin', suggestion)}
                    style={({ pressed }) => [
                      styles.suggestionRow,
                      index > 0 && styles.suggestionRowDivider,
                      pressed && styles.pressed,
                    ]}>
                    <Ionicons name="location-outline" size={16} color={GasTaColors.forest} />
                    <Text style={styles.suggestionText} numberOfLines={2}>
                      {suggestion.description}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Lightweight relationship marker. Deliberately thin: it shows the
                two fields are one route, and stays out of the way. */}
            <View style={styles.routeConnector} />

            <View style={styles.routeField}>
              <Text style={styles.routeFieldLabel}>Destination</Text>
              <TextInput
                value={destination}
                onChangeText={(value) => handleRouteQueryChange('destination', value)}
                onFocus={() => {
                  if (
                    destination.trim().length >= 2 &&
                    placeSearch.field !== 'destination'
                  ) {
                    handleRouteQueryChange('destination', destination);
                  }
                }}
                placeholder="Search destination"
                placeholderTextColor={GasTaColors.textMuted}
                style={styles.routeFieldInput}
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            {placeSearch.field === 'destination' ? (
              <View style={styles.suggestionList}>
                {placeSearch.loading || resolvingPlaceId ? (
                  <Text style={styles.suggestionStatus}>Searching places…</Text>
                ) : null}
                {placeSearch.error ? (
                  <Text style={styles.suggestionError}>{placeSearch.error}</Text>
                ) : null}
                {!placeSearch.loading &&
                !resolvingPlaceId &&
                !placeSearch.error &&
                placeSearch.suggestions.length === 0 &&
                placeSearch.query.length >= 2 ? (
                  <Text style={styles.suggestionStatus}>No matching places</Text>
                ) : null}
                {placeSearch.suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.placeId}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${suggestion.description}`}
                    onPress={() =>
                      void handlePlaceSuggestionPress('destination', suggestion)
                    }
                    style={({ pressed }) => [
                      styles.suggestionRow,
                      index > 0 && styles.suggestionRowDivider,
                      pressed && styles.pressed,
                    ]}>
                    <Ionicons name="location-outline" size={16} color={GasTaColors.forest} />
                    <Text style={styles.suggestionText} numberOfLines={2}>
                      {suggestion.description}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {/* Real route values only -- never a placeholder. The last good figure
              stays on screen while a replacement is in flight, so the row does
              not blink; only the chip gains a quiet "updating" note. */}
          {routeDistanceKm != null ? (
            <View style={styles.routeStatRow}>
              <Text style={styles.routeStatLabel}>Total distance</Text>
              <View style={styles.routeStatChip}>
                <Text style={styles.routeStatValue}>
                  {routeDistanceKm.toFixed(1)} km
                </Text>
                {routeDurationMinutes != null ? (
                  <Text style={styles.routeStatMeta}>
                    {' '}
                    · {Math.round(routeDurationMinutes)} min
                  </Text>
                ) : null}
                {routePreviewLoading ? (
                  <Text style={styles.routeStatMeta}> · updating…</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/*
            Secondary, not a competing CTA. A compact outlined pill under the
            fields, so the addresses stay the focus and the card does not carry
            a large full-width button block.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose origin and destination on a map"
            hitSlop={8}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/trip/pick-map' as never,
                params: {
                  origin: origin.trim() || undefined,
                  destination: destination.trim() || undefined,
                },
              })
            }
            style={({ pressed }) => [styles.pickMapPill, pressed && styles.pressed]}>
            <Ionicons name="map-outline" size={14} color={GasTaColors.textOnForest} />
            <Text style={styles.pickMapPillText}>Pick on map</Text>
          </Pressable>

          {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
        </View>
      </View>

      {/*
        VEHICLE. Owned vehicles are compact selectable tiles rather than a chip
        row, because a chip row read as a filter and gave no room to show the
        efficiency that actually drives the cost. Selection logic, the vehicle
        query and `handleVehicleChipChange` are untouched -- only the control
        changed, and it calls the same handler.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Vehicle</Text>
        <View style={styles.sectionCard}>
          {hasRegisteredVehicles ? (
            <>
              <View style={styles.vehicleGrid}>
                {vehicles.map((vehicle) => {
                  const selected = selectedVehicleId === vehicle.id;
                  const name = vehicle.nickname ?? `${vehicle.brand} ${vehicle.model}`;
                  return (
                    <Pressable
                      key={vehicle.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${name}, ${vehicle.fuel_efficiency_km_per_liter} kilometers per liter`}
                      onPress={() => handleVehicleChipChange(vehicle.id)}
                      style={({ pressed }) => [
                        styles.vehicleTile,
                        selected && styles.vehicleTileSelected,
                        pressed && !selected && styles.pressed,
                      ]}>
                      <View style={styles.vehicleTileTop}>
                        <Ionicons
                          name="car-outline"
                          size={15}
                          // Selected tile is solid forest, so the icon must be
                          // light. Using `forest` here (as an earlier pass did)
                          // painted the icon the same colour as its own
                          // background and made it disappear.
                          color={selected ? GasTaColors.textOnForest : GasTaColors.forestMuted}
                        />
                        <Text
                          numberOfLines={1}
                          style={[styles.vehicleTileName, selected && styles.vehicleTileSelectedText]}>
                          {name}
                        </Text>
                        {selected ? (
                          <View style={[styles.vehicleTileCheck, styles.vehicleTileCheckOnDark]}>
                            <Ionicons
                              name="checkmark"
                              size={11}
                              color={GasTaColors.textOnForest}
                            />
                          </View>
                        ) : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.vehicleTileMeta, selected && styles.vehicleTileSelectedMeta]}>
                        {vehicle.brand} {vehicle.model} ·{' '}
                        {vehicle.fuel_efficiency_km_per_liter} km/L
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isManualVehicle }}
                  accessibilityLabel="Other vehicle, enter details manually"
                  onPress={() => handleVehicleChipChange('manual')}
                  style={({ pressed }) => [
                    styles.vehicleTile,
                    isManualVehicle && styles.vehicleTileSelected,
                    pressed && !isManualVehicle && styles.pressed,
                  ]}>
                  <View style={styles.vehicleTileTop}>
                    <Ionicons
                      name="add-circle-outline"
                      size={15}
                      color={
                        isManualVehicle ? GasTaColors.textOnForest : GasTaColors.forestMuted
                      }
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.vehicleTileName,
                        isManualVehicle && styles.vehicleTileSelectedText,
                      ]}>
                      Other vehicle
                    </Text>
                    {isManualVehicle ? (
                      <View style={[styles.vehicleTileCheck, styles.vehicleTileCheckOnDark]}>
                        <Ionicons name="checkmark" size={11} color={GasTaColors.textOnForest} />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.vehicleTileMeta,
                      isManualVehicle && styles.vehicleTileSelectedMeta,
                    ]}>
                    Enter efficiency and price
                  </Text>
                </Pressable>
              </View>

              {/*
                The selected tile already shows efficiency in its meta line,
                but a tile meta is meant to be scannable, not authoritative.
                This strip is the primary reading of the value, so the number is
                set larger here and the tile keeps its compact secondary role.
              */}
              {selectedVehicle ? (
                <View style={styles.effRow}>
                  <Ionicons
                    name="speedometer-outline"
                    size={14}
                    color={GasTaColors.forestMuted}
                  />
                  <Text style={styles.effLabel}>Fuel efficiency</Text>
                  <Text style={styles.effValue}>
                    {selectedVehicle.fuel_efficiency_km_per_liter} km/L
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {/*
        FUEL PRICE. Its own section rather than a detail buried under Vehicle,
        because this single assumption is what the whole cost estimate rests
        on, and the user should be able to see -- and challenge -- it before
        comparing anything. Precedence is unchanged: manual > verified community
        > DOE > unavailable.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Fuel price</Text>
        <View style={styles.sectionCard}>
          {!isManualVehicle && selectedVehicle ? (
            <>
              {/*
                No origin is not the same problem as "no price available".

                Without an origin the resolver has no geography to price against,
                so it is never even called. Showing the generic unavailable copy
                there would blame the price data when the real gap is a missing
                trip start, and it would invite the user to go hunting for a
                bulletin that is sitting there perfectly fine.

                This is deliberately NOT a location prompt. The app never asks for
                the device location on its own -- the user picks an origin, and
                "Current location" is offered inside the map picker. The message
                points at that existing path rather than introducing a second one.
              */}
              {!tripRegion ? (
                <View style={styles.originNeededBox}>
                  <Text style={styles.originNeededTitle}>
                    Select an origin to load local fuel prices.
                  </Text>
                  <Text style={styles.originNeededBody}>
                    Fuel pricing is based on where your trip starts. Choose a start
                    point, or pick your current location on the map.
                  </Text>
                </View>
              ) : missingFuelPrice || tripFuelPriceLoading ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>
                  {tripFuelPriceLoading ? 'Loading fuel price…' : 'Current fuel price unavailable'}
                </Text>
                <Text style={styles.warnBody}>
                  {tripFuelPriceLoading
                    ? 'Checking the latest DOE bulletin and verified community prices.'
                    : tripFuelPrice?.status === 'unavailable'
                      ? tripFuelPrice.message
                      : 'No current DOE or verified community price is available for this fuel yet.'}
                </Text>
                <Text style={styles.warnHint}>
                  Costs are not estimated without a current, trusted price.
                </Text>
              </View>
            ) : isManualVehicle ? (
              <>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Fuel efficiency</Text>
                  <Text style={styles.statValue}>{efficiency} km/L</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Fuel price</Text>
                  <View style={styles.statValueBlock}>
                    <Text style={styles.statValue}>
                      {manualPriceValue != null ? `${formatPeso(manualPriceValue)}/L` : '—'}
                    </Text>
                    <Text style={styles.priceSource}>Entered for this trip</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Fuel efficiency</Text>
                  <Text style={styles.statValue}>{efficiency} km/L</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Current fuel price</Text>
                  <View style={styles.statValueBlock}>
                    <Text style={styles.statValue}>
                      {tripFuelPrice?.status === 'ok'
                        ? `${formatPeso(tripFuelPrice.price.pricePerLiter)}/L`
                        : '—'}
                    </Text>
                    {tripFuelPrice?.status === 'ok' ? (
                      <Text style={styles.priceSource} numberOfLines={2}>
                        {tripFuelPrice.price.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/*
                  Optional override. Off by default, so the trusted automatic
                  price drives the cost unless the driver opts in. Toggling back
                  re-runs the resolver immediately -- nothing is cleared or
                  reopened.
                */}
                {useCustomFuelPrice ? (
                  <View style={styles.overrideBlock}>
                    <LabeledInput
                      label="Price per liter"
                      value={customFuelPriceInput}
                      onChangeText={(text) => {
                        setCustomFuelPriceInput(text);
                        if (customFuelPriceError) setCustomFuelPriceError(null);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 80.00"
                      error={customFuelPriceError ?? undefined}
                    />
                    <Text style={styles.overrideAuto}>
                      Use a price you recently saw or paid. It applies to this trip only.
                    </Text>
                    {tripFuelPrice?.status === 'ok' ? (
                      <Text style={styles.overrideAuto}>
                        Automatic price: {formatPeso(tripFuelPrice.price.pricePerLiter)}/L ·{' '}
                        {tripFuelPrice.price.sourceLabel}
                      </Text>
                    ) : null}
                    <PrimaryButton
                      label="Use automatic price"
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        setUseCustomFuelPrice(false);
                        setCustomFuelPriceInput('');
                        setCustomFuelPriceError(null);
                      }}
                    />
                  </View>
                ) : (
                  <PrimaryButton
                    label="Use my own price"
                    variant="secondary"
                    size="sm"
                    onPress={() => setUseCustomFuelPrice(true)}
                    style={styles.overrideToggle}
                  />
                )}
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
      </View>

      {/*
        COMPARE TRANSPORT. Live preview costs fill in once a route + fuel price
        exist (same SAW numbers the result sheet uses). Source notes stay so a
        jeepney estimate is never read as a confirmed booking fare.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Compare transport</Text>
        <View style={[styles.sectionCard, styles.modeList]}>
          {COMPARE_TRANSPORT_ROWS.map((row) => {
            const evaluation = evaluationByMode.get(row.code);
            const isRecommended = result?.recommended?.modeCode === row.code;
            const ineligible =
              result != null &&
              evaluation == null &&
              row.code !== 'OWN_VEHICLE';
            const previewHint =
              routeDistanceKm == null
                ? 'Set a route'
                : effectiveFuelPrice == null
                  ? 'Need fuel price'
                  : 'Updating…';
            return (
              <View
                key={row.code}
                style={[
                  styles.modeRow,
                  modeRowTintStyle[row.tint],
                  isRecommended && styles.modeRowRecommended,
                ]}>
                <View style={styles.modeRowBody}>
                  <View style={styles.modeRowTitleRow}>
                    <Text style={styles.modeRowTitle}>{row.title}</Text>
                    {isRecommended ? (
                      <Text style={styles.modeRowBadge}>Best match</Text>
                    ) : null}
                  </View>
                  <Text style={styles.modeRowNote}>
                    {row.code === 'WALKING' ? 'No fare' : modeFareNote(row.code)}
                  </Text>
                </View>
                <View style={styles.modeRowMetrics}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={styles.modeRowCost}>
                    {evaluation
                      ? formatPeso(evaluation.raw.fuelCost)
                      : ineligible
                        ? 'N/A'
                        : '—'}
                  </Text>
                  <Text style={styles.modeRowTime}>
                    {evaluation
                      ? `${Math.round(evaluation.raw.travelTime)} min`
                      : ineligible
                        ? 'Too far'
                        : previewHint}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/*
        Option A priority UI: one slider + live outcome cards. The slider and
        SAW weights are the same state — dragging rescores an existing route
        without a new Directions call.
      */}
      <View style={styles.prefBlock}>
        <View style={styles.prefHeadRow}>
          <Ionicons name="options-outline" size={15} color="rgba(255, 255, 255, 0.8)" />
          <Text style={[styles.prefTitle, styles.prefTitleOnDark]}>What matters more?</Text>
        </View>
        <Text style={[styles.prefHint, styles.prefHintOnDark]}>
          Drag to balance saving money and travel time. Preview updates when a
          route and fuel price are ready.
        </Text>

        <PriorityBalanceBar
          value={priorityPosition}
          onChange={handlePriorityChange}
          estimatedCost={result?.recommended?.raw.fuelCost ?? null}
          estimatedTimeMinutes={result?.recommended?.raw.travelTime ?? null}
          costLabel={recommendedCost?.label ?? 'Estimated cost'}
          recommendedModeLabel={
            result?.recommended
              ? transportModeLabel(result.recommended.modeCode)
              : null
          }
          costFormatter={formatPeso}
          tone="dark"
        />

        {!weightsSumToOne(weights) ? (
          <Text style={[styles.tuneError, styles.tuneErrorOnDark]}>Weights must sum to 1.0</Text>
        ) : null}
      </View>

      {/* Main action. Spacing above and below signals the transition from
          "set up" to "run". The handler and disabled/loading behaviour are
          untouched. */}
      <View style={styles.ctaBlock}>
        <PrimaryButton
          label={optimizing ? 'Finding route…' : 'Compare trip costs'}
          variant="secondary"
          onPress={handleOptimize}
          disabled={optimizing}
          style={styles.optimizeBtn}
        />
        {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
        {!result ? (
          <Text style={styles.ctaHint}>
            Choose a route and vehicle, then compare to open the trip cost summary.
          </Text>
        ) : null}
      </View>

      {/*
        Reopen affordance after dismissing the comparison sheet. Save / log live
        inside the sheet now, so this row only brings the result back.
      */}
      {result?.recommended ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show last trip comparison"
          onPress={() => setShowResultSheet(true)}
          style={({ pressed }) => [styles.lastResultBtn, pressed && styles.pressed]}>
          <Ionicons name="sparkles-outline" size={14} color={HomeColors.primary} />
          <Text style={styles.lastResultText}>
            Last result · {transportModeLabel(result.recommended.modeCode)} ·{' '}
            {formatPeso(result.recommended.raw.fuelCost)}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>

      {/*
        RESULT SHEET. Rendered as a sibling of the form ScrollView (not inside
        it) so the Modal is not clipped / blocked by scroll parents. Dismissal
        only hides the sheet; inputs and the scored result stay on the form.
      */}
      <Modal
        visible={showResultSheet && result?.recommended != null}
        transparent
        animationType="slide"
        onRequestClose={() => setShowResultSheet(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss trip comparison"
            style={styles.sheetBackdropDismiss}
            onPress={() => setShowResultSheet(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.receiptHead}>
              <Text style={styles.sheetKicker}>Trip summary</Text>
              <Text style={styles.receiptRoute} numberOfLines={1}>
                {origin.trim() || 'Origin'} → {destination.trim() || 'Destination'}
              </Text>
            </View>
            <ScrollView
              style={styles.sheetBody}
              contentContainerStyle={styles.sheetBodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.receiptTotal}>
                <Text style={styles.receiptTotalLabel}>Recommended for this trip</Text>
                <Text style={styles.receiptTotalMode}>
                  {result ? transportModeLabel(result.recommended.modeCode) : ''}
                </Text>
                <Text
                  style={styles.receiptTotalValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {result ? formatPeso(result.recommended.raw.fuelCost) : ''}
                </Text>
                {recommendedCost?.sourceNote ? (
                  <Text style={styles.receiptNote}>{recommendedCost.sourceNote}</Text>
                ) : null}
              </View>

              {ownVehicleBreakdown ? (
                <>
                  <Text style={styles.receiptSectionLabel}>Breakdown</Text>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Distance</Text>
                    <Text style={styles.receiptRowValue}>
                      {ownVehicleBreakdown.distanceKm.toFixed(1)} km
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Fuel efficiency</Text>
                    <Text style={styles.receiptRowValue}>
                      {ownVehicleBreakdown.efficiencyKmPerLiter} km/L
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Fuel needed</Text>
                    <Text style={styles.receiptRowValue}>
                      {ownVehicleBreakdown.litersNeeded.toFixed(2)} L
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabel}>Fuel price</Text>
                    <Text style={styles.receiptRowValue}>
                      {formatPeso(ownVehicleBreakdown.pricePerLiter)}/L
                    </Text>
                  </View>
                  {fuelPriceProvenance ? (
                    <Text style={styles.receiptNote}>
                      {fuelPriceProvenance.label} · {fuelPriceProvenance.detail}
                    </Text>
                  ) : null}
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabelStrong}>Estimated total</Text>
                    <Text style={styles.receiptRowValueStrong}>
                      {formatPeso(ownVehicleBreakdown.totalCost)}
                    </Text>
                  </View>
                  {selectedVehicle ? (
                    <Text style={styles.receiptNote}>
                      {selectedVehicle.nickname ??
                        `${selectedVehicle.brand} ${selectedVehicle.model}`}{' '}
                      · {ownVehicleBreakdown.efficiencyKmPerLiter} km/L
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.receiptSectionLabel}>Trip</Text>
                  {routeDistanceKm != null ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptRowLabel}>Distance</Text>
                      <Text style={styles.receiptRowValue}>
                        {routeDistanceKm.toFixed(1)} km
                      </Text>
                    </View>
                  ) : null}
                  {result ? (
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptRowLabel}>Travel time</Text>
                      <Text style={styles.receiptRowValue}>
                        {Math.round(result.recommended.raw.travelTime)} min
                      </Text>
                    </View>
                  ) : null}
                  {recommendedCost?.disclaimer ? (
                    <Text style={styles.receiptNote}>{recommendedCost.disclaimer}</Text>
                  ) : null}
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptRowLabelStrong}>Estimated total</Text>
                    <Text style={styles.receiptRowValueStrong}>
                      {result ? formatPeso(result.recommended.raw.fuelCost) : ''}
                    </Text>
                  </View>
                </>
              )}

              {remainingEvaluations.length > 0 ? (
                <>
                  <Text style={styles.receiptSectionLabel}>Other options</Text>
                  {remainingEvaluations.map((ev) => (
                    <View key={ev.modeCode} style={styles.receiptOptionBlock}>
                      <View style={styles.receiptRow}>
                        <Text style={styles.receiptRowLabel}>
                          {transportModeLabel(ev.modeCode)}
                        </Text>
                        <Text style={styles.receiptRowValue}>
                          {formatPeso(ev.raw.fuelCost)} ·{' '}
                          {Math.round(ev.raw.travelTime)} min
                        </Text>
                      </View>
                      <Text style={styles.receiptNote}>{modeFareNote(ev.modeCode)}</Text>
                    </View>
                  ))}
                </>
              ) : null}

              {/* Save moved out of the form page into this sheet. */}
              <View style={styles.sheetSaveBlock}>
                <Text style={styles.saveActionTitle}>Save as template</Text>
                <Text style={styles.hint}>Reusable route setup you can run again later.</Text>
                <LabeledInput
                  label="Template name"
                  value={templateName}
                  onChangeText={(value) => {
                    setTemplateName(value);
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
                <Text style={styles.sheetHistoryNote}>
                  This comparison is saved to Trip History automatically.
                </Text>
              </View>
            </ScrollView>
            <PrimaryButton label="Done" onPress={() => setShowResultSheet(false)} />
          </View>
        </View>
      </Modal>
    </View>
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
/**
 * How long the endpoints must sit still before the route is previewed.
 *
 * Long enough that typing an address never triggers a Directions request per
 * keystroke, short enough that the distance still feels immediate once the user
 * has finished.
 */
const ROUTE_PREVIEW_DEBOUNCE_MS = 600;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    // Extra room so the Save controls and result rows clear the floating tab bar.
    paddingBottom: 120,
  },

  // ------------------------------------------------ numbered step blocks
  /* ------------------------------------------------------------------
   * Section surfaces.
   *
   * The screen used to be one long column of form fields with numbered
   * headings and no surface behind any of them, so Route, Vehicle, Fuel and
   * Compare all ran together and the page read as a single form. Each major
   * step now sits on its own warm-white card, separated by generous vertical
   * space, so the hierarchy is legible before any scrolling.
   *
   * Depth is deliberately restrained: a hairline border and a very light
   * shadow. No gradients, no glass, and no card nested inside another card --
   * inside a section the layout is rows, dividers and quiet inner surfaces.
   * ------------------------------------------------------------------ */
  /* Vertical rhythm between the Route / Vehicle / Fuel price / Compare /
     Result surfaces. */
  /* ---- origin-needed notice (not an error, not a permission prompt) ---- */
  originNeededBox: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    borderStyle: 'dashed',
    backgroundColor: GasTaColors.cream,
  },
  originNeededTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  originNeededBody: {
    fontSize: 12,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: 3,
  },
  /* ---- route fields (label inside, address is the hero) ---- */
  routeFields: {
    gap: spacing.xs,
  },
  suggestionList: {
    marginTop: 2,
    marginBottom: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.white,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  suggestionRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestBorder,
  },
  suggestionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  suggestionStatus: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 12,
    color: GasTaColors.forestMuted,
  },
  suggestionError: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
    color: palette.danger,
  },
  routeField: {
    backgroundColor: GasTaColors.cream,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  routeFieldLabel: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: GasTaColors.forestMuted,
  },
  routeFieldInput: {
    // Largest text in the card: the address is the point of the Route section.
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: GasTaColors.forestDark,
    padding: 0,
    marginTop: 2,
    // Long addresses wrap to at most two lines rather than growing the card.
    minHeight: 44,
    textAlignVertical: 'top',
  },
  /* Thin connector between the two fields. Narrow, so it marks the relationship
     without competing with the addresses. */
  routeConnector: {
    width: 2,
    height: 12,
    alignSelf: 'flex-start',
    marginLeft: spacing.lg,
    borderRadius: 1,
    backgroundColor: GasTaColors.forestGlow,
  },
  routeStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestGlow,
  },
  routeStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: GasTaColors.forestMuted,
  },
  routeStatChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: GasTaColors.cream,
  },
  routeStatValue: {
    fontSize: 14,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  routeStatMeta: {
    fontSize: 11,
    color: GasTaColors.textSoft,
  },
  /* Secondary map action -- a small pill, not a full-width block. */
  pickMapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred in the card and only as wide as its own content. Filled forest so
    // it has real presence, but still lighter than the outlined Compare trip
    // costs button further down the page.
    alignSelf: 'center',
    gap: 5,
    marginTop: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GasTaColors.forestDark,
    backgroundColor: GasTaColors.forest,
  },
  pickMapPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: GasTaColors.textOnForest,
  },
  /* ---- receipt sheet ---- */
  receiptHead: {
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestGlow,
  },
  receiptRoute: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  /* Slightly lifted summary block. One shadow, restrained, on the total only. */
  receiptTotal: {
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.cream,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  receiptTotalLabel: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: GasTaColors.forestMuted,
  },
  receiptTotalMode: {
    fontSize: 17,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    marginTop: 2,
  },
  receiptTotalValue: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1,
    color: GasTaColors.forestDark,
    marginTop: 2,
  },
  receiptSectionLabel: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: GasTaColors.forestMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  receiptRowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: GasTaColors.textSoft,
  },
  receiptRowValue: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
    flexShrink: 0,
  },
  receiptRowLabelStrong: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  receiptRowValueStrong: {
    fontSize: 17,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    flexShrink: 0,
  },
  receiptDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.forestGlow,
    marginVertical: spacing.sm,
  },
  receiptNote: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 3,
  },
  receiptOptionBlock: {
    paddingVertical: 5,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    color: GasTaColors.forestMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: spacing.sm,
  },
  sectionCard: {
    backgroundColor: GasTaColors.creamLight,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    padding: spacing.lg,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  /* Inner fields sit on a warm-beige well so the card does not read as one
     undifferentiated white block. */
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.forestBorder,
    marginVertical: spacing.md,
  },
  /* ---- vehicle tiles ---- */
  vehicleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleTile: {
    // Two comfortable columns on a phone; the tile still shrinks rather than
    // overflowing on very narrow screens.
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 132,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
  },
  /*
   * Selected reads as a solid forest tile with white text, not a pale tint: on
   * a light cream page a filled tile is the only selection signal that stays
   * obvious at a glance, and it matches the filled segmented tab in the header.
   */
  vehicleTileSelected: {
    backgroundColor: GasTaColors.forest,
    borderColor: GasTaColors.forest,
  },
  vehicleTileSelectedText: {
    color: GasTaColors.textOnForest,
  },
  vehicleTileSelectedMeta: {
    color: 'rgba(255, 255, 255, 0.74)',
  },
  vehicleTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  vehicleTileName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  /* Check sits top-right. On a selected (dark) tile the badge inverts to
     white-on-transparent so it stays visible against the forest fill. */
  vehicleTileCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.forestGlow,
  },
  vehicleTileCheckOnDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  vehicleTileMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  pressed: { opacity: 0.7 },
  /* ---- fuel price headline ---- */
  priceHeadline: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: GasTaColors.forestDark,
  },
  priceHeadlineMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  /* ---- mode confidence rows ---- */
  /* ---- fuel efficiency strip (inside the Vehicle card) ---- */
  effRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: GasTaColors.cream,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  effLabel: {
    flex: 1,
    minWidth: 0,
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: GasTaColors.forestMuted,
  },
  effValue: {
    fontSize: 15,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  /* ---- compare transport rows ---- */
  modeList: {
    gap: spacing.xs,
  },
  /*
   * Per-mode tint. All five are the SAME pale value -- the distinction is the
   * 3px accent bar on the leading edge, which keeps the list reading as one
   * block instead of a rainbow of cards. Backgrounds differ only in
   * lightness, so nothing here competes with the dark panel below.
   */
  modeRowOwn: {
    backgroundColor: '#F1F6F1',
    borderLeftColor: GasTaColors.forest,
  },
  modeRowJeepney: {
    backgroundColor: '#F6F7EC',
    borderLeftColor: '#7C9A2E',
  },
  modeRowTricycle: {
    backgroundColor: '#F0F4F7',
    borderLeftColor: '#5C8299',
  },
  modeRowRideHailing: {
    backgroundColor: '#FBF4EA',
    borderLeftColor: '#B07C2A',
  },
  modeRowWalking: {
    backgroundColor: '#F4F6F3',
    borderLeftColor: '#8A9A8A',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    borderRadius: 12,
    overflow: 'hidden',
    // The accent is painted as a left border rather than a child view, so it
    // cannot affect the row's measured width or push the note out of the card.
    borderWidth: 0,
    borderLeftWidth: 3,
  },
  modeRowRecommended: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: GasTaColors.forest,
  },
  modeRowBody: {
    flex: 1,
    minWidth: 0,
  },
  modeRowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  modeRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  modeRowBadge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: GasTaColors.forest,
  },
  modeRowNote: {
    fontSize: 11,
    lineHeight: 15,
    // forestMuted rather than textSoft: on the palest tints the softer grey was
    // washing out, and the Ride-hailing line in particular is the one that must
    // stay readable because it carries the fare disclaimer.
    color: GasTaColors.forestMuted,
    marginTop: 2,
  },
  modeRowMetrics: {
    alignItems: 'flex-end',
    flexShrink: 0,
    minWidth: 72,
  },
  modeRowCost: {
    fontSize: 15,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    letterSpacing: -0.2,
  },
  modeRowTime: {
    fontSize: 11,
    fontWeight: '600',
    color: GasTaColors.forestMuted,
    marginTop: 2,
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
    // forestMuted rather than HomeColors.muted: the label pairs with a bold
    // value directly to its right, and the greyer tone lost the pairing on the
    // white Fuel card. Still clearly lighter than the value it labels.
    color: GasTaColors.forestMuted,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  statValueBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    paddingLeft: spacing.md,
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
  /* Provenance line under the price: which bulletin, or which verified report. */
  /*
   * Provenance line under the price. `textSoft` was too pale on the white card
   * and made the DOE/verified-community detail -- the part that tells the user
   * whether to trust the number above it -- the hardest text in the card to
   * read. forestMuted keeps it clearly subordinate to the value.
   */
  priceSource: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.forestMuted,
    marginTop: 2,
    textAlign: 'right',
  },
  overrideToggle: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  overrideBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestBorder,
  },
  overrideAuto: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginBottom: spacing.sm,
  },
  warnHint: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 6,
  },

  // ------------------ what matters more (presets + savings slider)
  // Deliberately the lightest block: tinted surface, muted copy, no step badge.
  /*
   * The lower half's strong dark card. Paired with the header panel it brackets
   * the form: dark at the top, dark in the middle, light sections between. The
   * shadow is deliberately minimal because the fill already carries the weight.
   */
  prefBlock: {
    padding: spacing.lg,
    borderRadius: 20,
    backgroundColor: GasTaColors.forest,
    borderWidth: 1,
    borderColor: GasTaColors.forestDark,
    marginBottom: spacing.lg,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 3,
  },
  prefHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prefTitleOnDark: {
    color: GasTaColors.textOnForest,
  },
  prefHintOnDark: {
    color: 'rgba(255, 255, 255, 0.72)',
  },
  tuneErrorOnDark: {
    color: 'rgba(255, 255, 255, 0.86)',
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
    // Outlined rather than filled: it must stay the strongest action on the
    // lower half while staying visually lighter than the dark priority panel
    // directly above it. Sized, not giant.
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: spacing.md,
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
  /* Provenance under the headline cost: which price source, or that a fare is
     an estimate from configured rules. */
  heroSource: {
    fontSize: 11,
    lineHeight: 16,
    color: HomeColors.muted,
    marginTop: 4,
  },
  /* Compact detail rows under the headline cost. */
  heroDetail: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  /* ---- result bottom sheet ---- */
  lastResultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.forestGlow,
  },
  lastResultText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 19, 9, 0.45)',
    justifyContent: 'flex-end',
  },
  /** Tappable dimmed area above the sheet; keeps the sheet itself a plain View. */
  sheetBackdropDismiss: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: GasTaColors.creamLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: GasTaColors.forestBorder,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 16,
  },
  sheetSaveBlock: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestBorder,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: GasTaColors.forestGlow,
    marginBottom: spacing.md,
  },
  sheetKicker: {
    ...typography.label,
    color: GasTaColors.forestMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { paddingBottom: spacing.md },
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

  // -------------------------------------- save / log (inside result sheet)
  saveActionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: GasTaColors.forestDark,
    marginBottom: 2,
  },
  saveSecondaryBtn: {
    borderColor: HomeColors.border,
  },
  sheetHistoryNote: {
    marginTop: spacing.sm,
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.forestMuted,
  },
  // Inline field validation (template name). Small red helper text, no card.
  fieldError: {
    fontSize: 12,
    lineHeight: 17,
    color: palette.danger,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },

  error: { color: palette.danger, fontSize: 13, fontWeight: '600' },
});
