import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/Themed";
import {
  MapView,
  Marker,
  Polyline,
  reverseGeocodeWithMapsJs,
  reverseGeocodeWithNominatim,
  type MapPressEvent,
  type MapViewHandle,
  type Region,
} from "@/components/maps/TripMap";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SupabaseSetupBanner from "@/components/SupabaseSetupBanner";
import {
  BrandColors,
  GasTaColors,
  palette,
  radii,
  spacing,
} from "@/constants/Theme";
import { REGION_CENTROIDS } from "@/constants/regions";
import { useResponsive } from "@/hooks/useResponsive";
import {
  GeocodingError,
  getReadableAddress,
  reverseGeocode,
} from "@/lib/services/googleGeocoding";
import {
  PlacesAutocompleteError,
  resolvePlaceSuggestion,
  searchPlaceSuggestions,
  type PlaceSuggestion,
  type ResolvedPlaceSuggestion,
} from "@/lib/services/googlePlacesAutocomplete";
import {
  publishRouteSelection,
  type PickedRoutePoint,
} from "@/lib/services/routeSelection";
import {
  DirectionsError,
  getDrivingRoute,
  type DirectionsRoute,
} from "@/lib/services/googleMaps";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";

type RouteField = "origin" | "destination";

type FieldState = {
  query: string;
  point: PickedRoutePoint | null;
};

type SearchState = {
  field: RouteField;
  query: string;
  loading: boolean;
  suggestions: PlaceSuggestion[];
  error: string | null;
};

const DEFAULT_REGION: Region = {
  ...REGION_CENTROIDS.NCR,
  latitudeDelta: 0.22,
  longitudeDelta: 0.22,
};

const MARKER_A = palette.success;
const MARKER_B = BrandColors.skyBlue;

/** Turn a map tap into a human place name (Google first, then platform fallbacks). */
async function resolveTappedPlaceName(
  latitude: number,
  longitude: number,
): Promise<{ displayName: string; error: string | null }> {
  let lastError: string | null = null;

  // 1) Authenticated Edge Function (server key — most reliable when signed in).
  try {
    const place = await reverseGeocode(latitude, longitude);
    if (place?.formattedAddress) {
      return {
        displayName: getReadableAddress(place.formattedAddress),
        error: null,
      };
    }
  } catch (error) {
    lastError =
      error instanceof GeocodingError ? error.userMessage : lastError;
  }

  // 2) Web: Maps JS Geocoder (needs Geocoding API on the browser key).
  if (Platform.OS === "web") {
    const mapsAddress = await reverseGeocodeWithMapsJs(latitude, longitude);
    if (mapsAddress) {
      return {
        displayName: getReadableAddress(mapsAddress),
        error: null,
      };
    }

    // 3) Web: OpenStreetMap when Google geocoding is blocked/unavailable.
    const osmAddress = await reverseGeocodeWithNominatim(latitude, longitude);
    if (osmAddress) {
      return {
        displayName: getReadableAddress(osmAddress),
        error: null,
      };
    }

    return {
      displayName: `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
      error: lastError,
    };
  }

  // Native: device reverse geocoder.
  try {
    const entries = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    const entry = entries[0];
    if (entry) {
      const parts = [
        entry.name,
        entry.streetNumber && entry.street
          ? `${entry.streetNumber} ${entry.street}`
          : entry.street,
        entry.district,
        entry.city,
        entry.subregion,
        entry.region,
      ].filter((part, index, list) => {
        if (!part) return false;
        const normalized = part.trim().toLowerCase();
        return (
          normalized.length > 0 &&
          list.findIndex(
            (other) => other?.trim().toLowerCase() === normalized,
          ) === index
        );
      });
      if (parts.length > 0) {
        return { displayName: parts.join(", "), error: null };
      }
    }
  } catch {
    // fall through
  }

  return {
    displayName: `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
    error: lastError,
  };
}

export default function PickOnMapScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, isLandscape, scale, horizontalPadding } =
    useResponsive();
  const params = useLocalSearchParams<{
    origin?: string;
    destination?: string;
  }>();
  const mapRef = useRef<MapViewHandle | null>(null);
  const regionRef = useRef<Region>(DEFAULT_REGION);
  const searchRequestId = useRef(0);
  const placeRequestId = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortController = useRef<AbortController | null>(null);
  const [origin, setOrigin] = useState<FieldState>({
    query: params.origin ?? "",
    point: null,
  });
  const [destination, setDestination] = useState<FieldState>({
    query: params.destination ?? "",
    point: null,
  });
  const [activeField, setActiveField] = useState<RouteField>("origin");
  const [search, setSearch] = useState<SearchState>({
    field: "origin",
    query: "",
    loading: false,
    suggestions: [],
    error: null,
  });
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const [resolvingCoordinate, setResolvingCoordinate] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [route, setRoute] = useState<DirectionsRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routeRequestId = useRef(0);

  const bothPointsSet = origin.point !== null && destination.point !== null;
  // Wide screens: floating panel constrained; phones: full-width overlays.
  const isWide = width >= 768;

  const mapPadding = useMemo(
    () => ({
      top: isWide ? 48 : scale(120),
      right: isWide ? (isLandscape ? width * 0.42 : 56) : 48,
      bottom: isWide ? 48 : scale(220),
      left: isWide ? (isLandscape ? 56 : width * 0.38) : 48,
    }),
    [isLandscape, isWide, scale, width],
  );

  const setField = useCallback((field: RouteField, value: FieldState) => {
    if (field === "origin") setOrigin(value);
    else setDestination(value);
  }, []);
  const queryForField = useCallback(
    (field: RouteField) =>
      field === "origin" ? origin.query : destination.query,
    [destination.query, origin.query],
  );
  const clearSearch = useCallback(() => {
    searchRequestId.current += 1;
    placeRequestId.current += 1;
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    setResolvingPlaceId(null);
    setSearch((current) => ({
      ...current,
      query: "",
      loading: false,
      suggestions: [],
      error: null,
    }));
  }, []);
  const focusPoint = useCallback((point: PickedRoutePoint) => {
    const map = mapRef.current;
    if (map && typeof map.animateToRegion === "function") {
      const next = {
        latitude: point.latitude,
        longitude: point.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      regionRef.current = next;
      map.animateToRegion(next, 350);
    }
  }, []);
  const zoomBy = useCallback((factor: number) => {
    const map = mapRef.current;
    const current = regionRef.current;
    if (!map || typeof map.animateToRegion !== "function") return;
    const next = {
      ...current,
      latitudeDelta: Math.min(80, Math.max(0.002, current.latitudeDelta * factor)),
      longitudeDelta: Math.min(80, Math.max(0.002, current.longitudeDelta * factor)),
    };
    regionRef.current = next;
    map.animateToRegion(next, 200);
  }, []);
  const setPointFromPlace = useCallback(
    (field: RouteField, place: ResolvedPlaceSuggestion) => {
      const displayName =
        field === "origin"
          ? getReadableAddress(place.description)
          : place.description;
      const point = {
        displayName,
        latitude: place.latitude,
        longitude: place.longitude,
        directionsValue: `${place.latitude},${place.longitude}`,
      };
      setField(field, { query: displayName, point });
      setActiveField(field === "origin" ? "destination" : "origin");
      clearSearch();
      focusPoint(point);
    },
    [clearSearch, focusPoint, setField],
  );

  const handleSuggestionPress = useCallback(
    async (field: RouteField, suggestion: PlaceSuggestion) => {
      clearSearch();
      const requestId = placeRequestId.current;
      setField(field, { query: suggestion.description, point: null });
      setSearch({
        field,
        query: suggestion.description,
        loading: false,
        suggestions: [],
        error: null,
      });
      setResolvingPlaceId(suggestion.placeId);
      setLocationError(null);
      try {
        const place = await resolvePlaceSuggestion(suggestion.placeId);
        if (requestId !== placeRequestId.current) return;
        setPointFromPlace(field, place);
      } catch (error) {
        if (requestId !== placeRequestId.current) return;
        setSearch({
          field,
          query: suggestion.description,
          loading: false,
          suggestions: [],
          error:
            error instanceof PlacesAutocompleteError
              ? error.userMessage
              : "Could not load that place's exact location.",
        });
        setResolvingPlaceId(null);
      }
    },
    [clearSearch, setField, setPointFromPlace],
  );

  const handleMapPress = useCallback(
    async (event: MapPressEvent) => {
      clearSearch();
      const { latitude, longitude } = event.nativeEvent.coordinate;
      const field = activeField;
      setLocationError(null);
      setResolvingCoordinate(true);
      setField(field, {
        query: "Looking up address…",
        point: {
          displayName: "Looking up address…",
          latitude,
          longitude,
          directionsValue: `${latitude},${longitude}`,
        },
      });

      const { displayName, error } = await resolveTappedPlaceName(
        latitude,
        longitude,
      );
      setField(field, {
        query: displayName,
        point: {
          displayName,
          latitude,
          longitude,
          directionsValue: `${latitude},${longitude}`,
        },
      });
      setActiveField(field === "origin" ? "destination" : "origin");
      if (error) {
        setLocationError(error);
      }
      setResolvingCoordinate(false);
    },
    [activeField, clearSearch, setField],
  );

  const handleUseCurrentLocation = useCallback(async () => {
    if (locating) return;
    const previousOrigin = origin;
    clearSearch();
    setField("origin", { query: "Getting current location...", point: null });
    setLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setField("origin", previousOrigin);
        setLocationError(
          "Location permission was not granted. You can still tap the map.",
        );
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = current.coords;
      focusPoint({
        displayName: "Current location",
        latitude,
        longitude,
        directionsValue: `${latitude},${longitude}`,
      });
      setActiveField("destination");
      const { displayName, error } = await resolveTappedPlaceName(
        latitude,
        longitude,
      );
      setOrigin({
        query: displayName.startsWith("Pinned location")
          ? "Current location"
          : displayName,
        point: {
          displayName: displayName.startsWith("Pinned location")
            ? "Current location"
            : displayName,
          latitude,
          longitude,
          directionsValue: `${latitude},${longitude}`,
        },
      });
      if (error) {
        setLocationError(error);
      }
    } catch {
      setField("origin", previousOrigin);
      setLocationError(
        "Could not get your current location. Check location settings and try again.",
      );
    } finally {
      setLocating(false);
    }
  }, [clearSearch, focusPoint, locating, origin, setField]);

  const handleQueryChange = useCallback(
    (field: RouteField, query: string) => {
      const current = field === "origin" ? origin : destination;
      setField(field, {
        query,
        point: query === current.point?.displayName ? current.point : null,
      });
      setActiveField(field);
      clearSearch();
      const trimmedQuery = query.trim();
      if (trimmedQuery.length < 2) return;
      const requestId = ++searchRequestId.current;
      const abortController = new AbortController();
      searchAbortController.current = abortController;
      const biasPoint =
        field === "destination" ? origin.point : destination.point;
      const bias = biasPoint
        ? { latitude: biasPoint.latitude, longitude: biasPoint.longitude }
        : undefined;
      searchTimer.current = setTimeout(async () => {
        setSearch({
          field,
          query: trimmedQuery,
          loading: true,
          suggestions: [],
          error: null,
        });
        try {
          const suggestions = await searchPlaceSuggestions(
            trimmedQuery,
            bias,
            abortController.signal,
          );
          if (requestId !== searchRequestId.current) return;
          setSearch({
            field,
            query: trimmedQuery,
            loading: false,
            suggestions,
            error: null,
          });
        } catch (error) {
          if (
            requestId !== searchRequestId.current ||
            abortController.signal.aborted
          ) {
            return;
          }
          setSearch({
            field,
            query: trimmedQuery,
            loading: false,
            suggestions: [],
            error:
              error instanceof PlacesAutocompleteError
                ? error.userMessage
                : "Could not search for that location.",
          });
        } finally {
          if (searchAbortController.current === abortController) {
            searchAbortController.current = null;
          }
        }
      }, 300);
    },
    [clearSearch, destination, origin, setField],
  );

  const handleApply = useCallback(() => {
    if (!origin.point || !destination.point) return;
    publishRouteSelection({
      origin: origin.point,
      destination: destination.point,
    });
    router.back();
  }, [destination.point, origin.point, router]);

  useEffect(() => {
    return () => {
      searchRequestId.current += 1;
      placeRequestId.current += 1;
      searchAbortController.current?.abort();
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (
      origin.point &&
      destination.point &&
      map &&
      typeof map.fitToCoordinates === "function"
    ) {
      const path =
        route?.coordinates && route.coordinates.length >= 2
          ? route.coordinates
          : [origin.point, destination.point];
      map.fitToCoordinates(path, {
        edgePadding: mapPadding,
        animated: true,
      });
    }
  }, [destination.point, mapPadding, origin.point, route?.coordinates]);

  // Fetch the Google driving route whenever both map points are set.
  useEffect(() => {
    if (!origin.point || !destination.point) {
      setRoute(null);
      setRouteError(null);
      setRouteLoading(false);
      return;
    }

    const requestId = ++routeRequestId.current;
    const controller = new AbortController();
    setRouteLoading(true);
    setRouteError(null);

    void (async () => {
      try {
        const result = await getDrivingRoute(
          origin.point!.directionsValue,
          destination.point!.directionsValue,
          controller.signal,
        );
        if (requestId !== routeRequestId.current) return;
        setRoute(result);
        setRouteLoading(false);
      } catch (error) {
        if (requestId !== routeRequestId.current || controller.signal.aborted) {
          return;
        }
        setRoute(null);
        setRouteLoading(false);
        setRouteError(
          error instanceof DirectionsError
            ? error.userMessage
            : "Couldn't load a driving route for those points.",
        );
      }
    })();

    return () => {
      controller.abort();
    };
  }, [destination.point, origin.point]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  const overlayPad = Math.max(horizontalPadding * 0.55, spacing.md);
  const panelMaxWidth = isWide ? Math.min(420, width * 0.42) : undefined;
  const bottomSheetMaxWidth = isWide ? Math.min(440, width * 0.44) : undefined;

  const renderFieldSuggestions = (field: RouteField) => {
    const fieldQuery = queryForField(field).trim();
    const visible =
      activeField === field &&
      search.field === field &&
      search.query === fieldQuery &&
      fieldQuery.length >= 2;
    if (!visible) return null;
    const resolving = resolvingPlaceId !== null;
    return (
      <View style={styles.suggestions}>
        {search.loading && (
          <View style={styles.searchStatus}>
            <ActivityIndicator size="small" color={MARKER_A} />
            <Text style={[styles.searchStatusText, { color: theme.textSecondary }]}>
              Finding suggestions…
            </Text>
          </View>
        )}
        {resolving && (
          <View style={styles.searchStatus}>
            <ActivityIndicator size="small" color={MARKER_A} />
            <Text style={[styles.searchStatusText, { color: theme.textSecondary }]}>
              Loading exact location…
            </Text>
          </View>
        )}
        {!search.loading && !resolving && search.error && (
          <Text style={styles.error}>{search.error}</Text>
        )}
        {!search.loading &&
          !resolving &&
          !search.error &&
          search.suggestions.length === 0 && (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              No suggestions found. Try a more specific place name.
            </Text>
          )}
        {!search.loading && !resolving && search.suggestions.length > 0 && (
          <>
            {search.suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.placeId}
                onPress={() => void handleSuggestionPress(field, suggestion)}
                disabled={resolving}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={18}
                  color={GasTaColors.forest}
                />
                <Text
                  style={[styles.suggestionText, { color: theme.text }]}
                  numberOfLines={2}
                >
                  {suggestion.description}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </View>
    );
  };

  const searchCard = (
    <View style={[styles.searchCard, panelMaxWidth ? { maxWidth: panelMaxWidth, width: "100%" } : null]}>
      <View style={styles.fieldRow}>
        <View style={[styles.fieldBadge, { backgroundColor: MARKER_A }]}>
          <Text style={styles.fieldBadgeText}>A</Text>
        </View>
        <TextInput
          value={origin.query}
          onChangeText={(value) => handleQueryChange("origin", value)}
          onFocus={() => setActiveField("origin")}
          placeholder="Search start location..."
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {origin.query.length > 0 && (
          <Pressable
            onPress={() => {
              setOrigin({ query: "", point: null });
              setActiveField("origin");
              clearSearch();
            }}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        )}
      </View>
      {renderFieldSuggestions("origin")}

      <View style={styles.fieldDivider} />

      <View style={styles.fieldRow}>
        <View style={[styles.fieldBadge, { backgroundColor: MARKER_B }]}>
          <Text style={styles.fieldBadgeText}>B</Text>
        </View>
        <TextInput
          value={destination.query}
          onChangeText={(value) => handleQueryChange("destination", value)}
          onFocus={() => setActiveField("destination")}
          placeholder="Search destination..."
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {destination.query.length > 0 && (
          <Pressable
            onPress={() => {
              setDestination({ query: "", point: null });
              setActiveField("destination");
              clearSearch();
            }}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        )}
      </View>
      {renderFieldSuggestions("destination")}
      {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
    </View>
  );

  const bottomSheet = (
    <View
      style={[
        styles.bottomSheet,
        {
          paddingBottom: Math.max(insets.bottom, spacing.md),
          maxWidth: bottomSheetMaxWidth,
          width: isWide ? bottomSheetMaxWidth : "100%",
          alignSelf: isWide ? "flex-start" : "stretch",
        },
      ]}
    >
      <Pressable onPress={() => setActiveField("origin")} style={styles.stepRow}>
        <View
          style={[
            styles.stepBadge,
            {
              backgroundColor: origin.point
                ? MARKER_A
                : activeField === "origin"
                  ? MARKER_A
                  : BrandColors.border,
            },
          ]}
        >
          <Text style={styles.fieldBadgeText}>A</Text>
        </View>
        <Text
          style={[
            styles.stepText,
            {
              color:
                origin.point || activeField === "origin"
                  ? GasTaColors.textPrimary
                  : theme.textMuted,
              fontWeight: activeField === "origin" ? "700" : "600",
            },
          ]}
          numberOfLines={2}
        >
          {origin.point
            ? `Start · ${origin.point.displayName}`
            : "Tap map to place your start point"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setActiveField("destination")}
        style={styles.stepRow}
      >
        <View
          style={[
            styles.stepBadge,
            {
              backgroundColor: destination.point
                ? MARKER_B
                : activeField === "destination"
                  ? MARKER_B
                  : BrandColors.border,
            },
          ]}
        >
          <Text style={styles.fieldBadgeText}>B</Text>
        </View>
        <Text
          style={[
            styles.stepText,
            {
              color:
                destination.point || activeField === "destination"
                  ? GasTaColors.textPrimary
                  : theme.textMuted,
              fontWeight: activeField === "destination" ? "700" : "600",
            },
          ]}
          numberOfLines={2}
        >
          {destination.point
            ? `Destination · ${destination.point.displayName}`
            : "Tap again to place your destination"}
        </Text>
        {resolvingCoordinate || routeLoading ? (
          <ActivityIndicator size="small" color={GasTaColors.forest} />
        ) : null}
      </Pressable>

      {bothPointsSet && route && !routeLoading ? (
        <Text style={[styles.routeMeta, { color: theme.textSecondary }]}>
          Road route · {route.distanceKm.toFixed(1)} km ·{" "}
          {Math.round(route.durationMinutes)} min
        </Text>
      ) : null}
      {routeError ? <Text style={styles.error}>{routeError}</Text> : null}

      {bothPointsSet ? (
        <PrimaryButton
          label={
            resolvingCoordinate || resolvingPlaceId || locating || routeLoading
              ? "Finding road route…"
              : "Use this route"
          }
          onPress={handleApply}
          disabled={
            resolvingCoordinate ||
            resolvingPlaceId !== null ||
            locating ||
            routeLoading
          }
          style={styles.applyButton}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        onPress={handleMapPress}
        onRegionChangeComplete={(region) => {
          regionRef.current = region;
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        mapPadding={mapPadding}
      >
        {route?.coordinates && route.coordinates.length >= 2 ? (
          <Polyline
            coordinates={route.coordinates}
            strokeColor={BrandColors.skyBlue}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
        {origin.point && (
          <Marker
            coordinate={origin.point}
            title="A · Start"
            description={origin.point.displayName}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={[styles.marker, { backgroundColor: MARKER_A }]}>
              <Text style={styles.markerText}>A</Text>
            </View>
          </Marker>
        )}
        {destination.point && (
          <Marker
            coordinate={destination.point}
            title="B · Destination"
            description={destination.point.displayName}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={[styles.marker, { backgroundColor: MARKER_B }]}>
              <Text style={styles.markerText}>B</Text>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Top: back + search */}
      <View
        pointerEvents="box-none"
        style={[
          styles.topOverlay,
          {
            paddingTop: insets.top + spacing.sm,
            paddingHorizontal: overlayPad,
          },
        ]}
      >
        <View
          pointerEvents="box-none"
          style={[styles.topBar, isWide && styles.topBarWide, { gap: spacing.sm }]}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.backFab, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={GasTaColors.forest}
            />
          </Pressable>
          {searchCard}
        </View>
      </View>

      {/* Right: zoom */}
      <View
        pointerEvents="box-none"
        style={[
          styles.zoomOverlay,
          { top: insets.top + scale(100), right: overlayPad },
        ]}
      >
        <View style={styles.zoomCard}>
          <Pressable
            onPress={() => zoomBy(0.55)}
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="plus" size={20} color={GasTaColors.forest} />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable
            onPress={() => zoomBy(1.8)}
            style={({ pressed }) => [styles.zoomBtn, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="minus" size={20} color={GasTaColors.forest} />
          </Pressable>
        </View>
      </View>

      {/* Bottom: locate + sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={[
          styles.bottomOverlay,
          {
            paddingHorizontal: overlayPad,
            paddingBottom: spacing.sm,
          },
        ]}
      >
        <View
          pointerEvents="box-none"
          style={[styles.bottomStack, isWide && styles.bottomStackWide]}
        >
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={locating}
            style={({ pressed }) => [
              styles.locateBar,
              pressed && styles.pressed,
              locating && styles.disabled,
              isWide ? { alignSelf: "flex-start", width: 52 } : null,
            ]}
          >
            {locating ? (
              <ActivityIndicator size="small" color={GasTaColors.forest} />
            ) : (
              <MaterialCommunityIcons
                name="navigation-variant"
                size={22}
                color={GasTaColors.forest}
              />
            )}
          </Pressable>
          {bottomSheet}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: GasTaColors.cream },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  topBarWide: {
    maxWidth: 520,
  },
  backFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GasTaColors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  searchCard: {
    flex: 1,
    backgroundColor: GasTaColors.white,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BrandColors.border,
    marginVertical: spacing.xs,
    marginLeft: 38,
  },
  fieldBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldBadgeText: { color: GasTaColors.white, fontSize: 13, fontWeight: "800" },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
  },
  zoomOverlay: {
    position: "absolute",
    zIndex: 5,
  },
  zoomCard: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  zoomBtn: {
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BrandColors.border,
  },
  bottomOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  bottomStack: {
    gap: spacing.sm,
  },
  bottomStackWide: {
    alignItems: "flex-start",
  },
  locateBar: {
    alignSelf: "center",
    width: 52,
    height: 44,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GasTaColors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomSheet: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 32,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  routeMeta: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  applyButton: { marginTop: spacing.xs },
  marker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: GasTaColors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  markerText: { color: GasTaColors.white, fontSize: 14, fontWeight: "800" },
  suggestions: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: GasTaColors.creamLight,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.border,
  },
  suggestionText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  searchStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchStatusText: { fontSize: 13 },
  error: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  empty: {
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
