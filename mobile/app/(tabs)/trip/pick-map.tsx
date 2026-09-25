import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, {
  Marker,
  type MapPressEvent,
  type Region,
} from "react-native-maps";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { Text } from "@/components/Themed";
import Card from "@/components/ui/Card";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SupabaseSetupBanner from "@/components/SupabaseSetupBanner";
import {
  GasTaColors,
  palette,
  radii,
  spacing,
  typography,
} from "@/constants/Theme";
import { REGION_CENTROIDS } from "@/constants/regions";
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

const MAP_PADDING = { top: 80, right: 48, bottom: 220, left: 48 };

export default function PickOnMapScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    origin?: string;
    destination?: string;
  }>();
  const mapRef = useRef<MapView>(null);
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

  const bothPointsSet = origin.point !== null && destination.point !== null;
  const setField = useCallback((field: RouteField, value: FieldState) => {
    if (field === "origin") setOrigin(value);
    else setDestination(value);
  }, []);
  const pointForField = useCallback(
    (field: RouteField) =>
      field === "origin" ? origin.point : destination.point,
    [destination.point, origin.point],
  );
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
      map.animateToRegion(
        {
          latitude: point.latitude,
          longitude: point.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        350,
      );
    }
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
      const point = {
        displayName: "Map location",
        latitude,
        longitude,
        directionsValue: `${latitude},${longitude}`,
      };
      setField(field, { query: point.displayName, point });
      setActiveField(field === "origin" ? "destination" : "origin");
      setLocationError(null);
      setResolvingCoordinate(true);
      try {
        const place = await reverseGeocode(latitude, longitude);
        if (place) {
          const displayName =
            field === "origin"
              ? getReadableAddress(place.formattedAddress)
              : place.formattedAddress;
          setField(field, {
            query: displayName,
            point: {
              displayName,
              latitude,
              longitude,
              directionsValue: `${latitude},${longitude}`,
            },
          });
        }
      } catch (error) {
        if (!(error instanceof GeocodingError && error.code === "timeout")) {
          setLocationError(
            error instanceof GeocodingError
              ? error.userMessage
              : "Could not read that map location.",
          );
        }
      } finally {
        setResolvingCoordinate(false);
      }
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
      const point = {
        displayName: "Getting current location...",
        latitude,
        longitude,
        directionsValue: `${latitude},${longitude}`,
      };
      setField("origin", { query: point.displayName, point });
      setActiveField("destination");
      focusPoint(point);
      try {
        const place = await reverseGeocode(latitude, longitude);
        if (place) {
          const displayName = getReadableAddress(place.formattedAddress);
          setOrigin({
            query: displayName,
            point: {
              displayName,
              latitude,
              longitude,
              directionsValue: `${latitude},${longitude}`,
            },
          });
        } else {
          setOrigin({
            query: "Current location",
            point: {
              displayName: "Current location",
              latitude,
              longitude,
              directionsValue: `${latitude},${longitude}`,
            },
          });
        }
      } catch (error) {
        setOrigin({
          query: "Current location",
          point: {
            displayName: "Current location",
            latitude,
            longitude,
            directionsValue: `${latitude},${longitude}`,
          },
        });
        if (!(error instanceof GeocodingError && error.code === "timeout")) {
          setLocationError(
            error instanceof GeocodingError
              ? error.userMessage
              : "Could not read your current location address.",
          );
        }
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
      map.fitToCoordinates([origin.point, destination.point], {
        edgePadding: MAP_PADDING,
        animated: true,
      });
    }
  }, [destination.point, origin.point]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  const activeLabel =
    activeField === "origin" ? "start point (A)" : "destination (B)";
  const activePoint = pointForField(activeField);
  const placementHint =
    !activePoint && activeField === "destination" && origin.point
      ? "Tap again to place your destination (B)."
      : activePoint
        ? `Tap the map to replace your ${activeLabel}.`
        : `Tap map to place your ${activeLabel}.`;
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
            <ActivityIndicator size="small" color={palette.success} />
            <Text
              style={[styles.searchStatusText, { color: theme.textSecondary }]}
            >
              Finding suggestions…
            </Text>
          </View>
        )}
        {resolving && (
          <View style={styles.searchStatus}>
            <ActivityIndicator size="small" color={palette.success} />
            <Text
              style={[styles.searchStatusText, { color: theme.textSecondary }]}
            >
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
                  { borderColor: GasTaColors.forestGlow },
                  pressed && styles.suggestionPressed,
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backButton}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={GasTaColors.forest}
          />
          <Text style={[styles.backText, { color: GasTaColors.forest }]}>
            Cancel
          </Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.text }]}>Pick on Map</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Choose your start and destination.
          </Text>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.panel}
        contentContainerStyle={styles.panelContent}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.searchCard} elevated>
          <View style={styles.fieldRow}>
            <View
              style={[styles.fieldBadge, { backgroundColor: palette.success }]}
            >
              <Text style={styles.fieldBadgeText}>A</Text>
            </View>
            <View style={styles.inputColumn}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                Search start location
              </Text>
              <TextInput
                value={origin.query}
                onChangeText={(value) => handleQueryChange("origin", value)}
                onFocus={() => setActiveField("origin")}
                placeholder="e.g. Quezon City Hall, Quezon City"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                  },
                ]}
                returnKeyType="search"
                autoCorrect={false}
              />
            </View>
            {origin.query.length > 0 && (
              <Pressable
                onPress={() => {
                  setOrigin({ query: "", point: null });
                  setActiveField("origin");
                  clearSearch();
                }}
                hitSlop={8}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={20}
                  color={theme.textMuted}
                />
              </Pressable>
            )}
          </View>
          {renderFieldSuggestions("origin")}

          <View style={styles.fieldRow}>
            <View
              style={[styles.fieldBadge, { backgroundColor: palette.warning }]}
            >
              <Text style={styles.fieldBadgeText}>B</Text>
            </View>
            <View style={styles.inputColumn}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                Search destination
              </Text>
              <TextInput
                value={destination.query}
                onChangeText={(value) =>
                  handleQueryChange("destination", value)
                }
                onFocus={() => setActiveField("destination")}
                placeholder="e.g. Makati Avenue, Makati"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                  },
                ]}
                returnKeyType="search"
                autoCorrect={false}
              />
            </View>
            {destination.query.length > 0 && (
              <Pressable
                onPress={() => {
                  setDestination({ query: "", point: null });
                  setActiveField("destination");
                  clearSearch();
                }}
                hitSlop={8}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={20}
                  color={theme.textMuted}
                />
              </Pressable>
            )}
          </View>
          {renderFieldSuggestions("destination")}

          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={locating}
            style={({ pressed }) => [
              styles.locateRow,
              {
                borderColor: GasTaColors.forestGlow,
                backgroundColor: theme.overlay,
              },
              pressed && styles.pressed,
              locating && styles.disabled,
            ]}
          >
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={18}
              color={GasTaColors.forest}
            />
            <Text style={[styles.locateText, { color: GasTaColors.forest }]}>
              {locating
                ? "Finding your location…"
                : "Use current location for start"}
            </Text>
          </Pressable>

          {locationError && <Text style={styles.error}>{locationError}</Text>}
        </Card>

        <View style={styles.summary}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            Route points
          </Text>
          <Text style={[styles.summaryText, { color: theme.text }]}>
            {origin.point ? "A · Start set" : "A · Tap or search for start"}
          </Text>
          <Text style={[styles.summaryText, { color: theme.text }]}>
            {destination.point
              ? "B · Destination set"
              : "B · Tap or search for destination"}
          </Text>
        </View>

        <PrimaryButton
          label={
            bothPointsSet
              ? resolvingCoordinate || resolvingPlaceId || locating
                ? "Resolving location…"
                : "Use this route"
              : "Set both points to continue"
          }
          onPress={handleApply}
          disabled={
            !bothPointsSet ||
            resolvingCoordinate ||
            resolvingPlaceId !== null ||
            locating
          }
          style={styles.applyButton}
        />
      </ScrollView>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={DEFAULT_REGION}
          onPress={handleMapPress}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {origin.point && (
            <Marker
              coordinate={origin.point}
              title="A · Start"
              description={origin.point.displayName}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View
                style={[styles.marker, { backgroundColor: palette.success }]}
              >
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
              <View
                style={[styles.marker, { backgroundColor: palette.warning }]}
              >
                <Text style={styles.markerText}>B</Text>
              </View>
            </Marker>
          )}
        </MapView>
        <View style={styles.mapHint} pointerEvents="none">
          <View
            style={[
              styles.hintIcon,
              {
                backgroundColor:
                  activeField === "origin" ? palette.success : palette.warning,
              },
            ]}
          >
            <Text style={styles.hintLetter}>
              {activeField === "origin" ? "A" : "B"}
            </Text>
          </View>
          <Text style={styles.hintText}>{placementHint}</Text>
          {resolvingCoordinate && (
            <ActivityIndicator size="small" color={GasTaColors.forest} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: GasTaColors.white,
    borderBottomWidth: 1,
    borderBottomColor: GasTaColors.glassBorderSubtle,
    zIndex: 3,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginRight: spacing.md,
  },
  backText: { fontSize: 15, fontWeight: "700" },
  headerCopy: { flex: 1 },
  title: { ...typography.title, fontSize: 23 },
  subtitle: { ...typography.caption, marginTop: 2 },
  mapWrap: { flex: 1, minHeight: 240, overflow: "hidden" },
  mapHint: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  hintIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  hintLetter: { color: GasTaColors.white, fontSize: 13, fontWeight: "800" },
  hintText: {
    flex: 1,
    color: GasTaColors.forestDark,
    fontSize: 13,
    fontWeight: "700",
  },
  marker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: GasTaColors.white,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  markerText: { color: GasTaColors.white, fontSize: 14, fontWeight: "800" },
  panel: {
    maxHeight: "58%",
    backgroundColor: GasTaColors.white,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  panelContent: { padding: spacing.md, paddingBottom: spacing.xl },
  searchCard: { padding: spacing.md, marginBottom: spacing.md },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  fieldBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldBadgeText: { color: GasTaColors.white, fontSize: 14, fontWeight: "800" },
  inputColumn: { flex: 1 },
  inputLabel: { ...typography.label, marginBottom: 4 },
  input: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 15,
  },
  locateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
  },
  locateText: { fontSize: 14, fontWeight: "700" },
  suggestions: {
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
    borderRadius: radii.md,
    backgroundColor: GasTaColors.white,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: GasTaColors.forestGlow,
  },
  suggestionPressed: { opacity: 0.7 },
  suggestionText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  searchStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchStatusText: { fontSize: 13 },
  summary: { paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  summaryLabel: { ...typography.label, marginBottom: spacing.xs },
  summaryText: { fontSize: 14, fontWeight: "600", lineHeight: 21 },
  applyButton: { marginTop: spacing.xs },
  error: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  empty: { fontSize: 13, marginTop: spacing.sm },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
