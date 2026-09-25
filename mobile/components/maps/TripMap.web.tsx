import {
  Children,
  createElement,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { Text } from "@/components/Themed";
import { GasTaColors } from "@/constants/Theme";

export type LatLng = { latitude: number; longitude: number };

export type Region = LatLng & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapPressEvent = {
  nativeEvent: { coordinate: LatLng };
};

export type MapViewHandle = {
  animateToRegion: (region: Region, _duration?: number) => void;
  fitToCoordinates: (
    coordinates: LatLng[],
    options?: {
      edgePadding?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
      };
      animated?: boolean;
    },
  ) => void;
};

type MapPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type MapViewProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region;
  onPress?: (event: MapPressEvent) => void;
  onRegionChangeComplete?: (region: Region) => void;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  showsCompass?: boolean;
  toolbarEnabled?: boolean;
  mapPadding?: MapPadding;
};

type MarkerProps = {
  coordinate: LatLng;
  title?: string;
  description?: string;
  children?: ReactNode;
  anchor?: { x: number; y: number };
};

type PolylineProps = {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  lineCap?: string;
  lineJoin?: string;
};

type GoogleMapsNamespace = {
  maps: {
    Map: new (
      el: HTMLElement,
      opts: Record<string, unknown>,
    ) => GoogleMap;
    Marker: new (opts: Record<string, unknown>) => GoogleMarker;
    Polyline: new (opts: Record<string, unknown>) => GooglePolyline;
    LatLngBounds: new () => GoogleLatLngBounds;
    Geocoder: new () => GoogleGeocoder;
    SymbolPath: { CIRCLE: number; FORWARD_CLOSED_ARROW: number };
    importLibrary?: (name: string) => Promise<Record<string, unknown>>;
    event: {
      addListener: (
        instance: unknown,
        name: string,
        handler: (...args: unknown[]) => void,
      ) => { remove: () => void };
    };
  };
};

type GoogleGeocoder = {
  geocode: (
    request: { location: { lat: number; lng: number } },
    callback?: (
      results: Array<{ formatted_address?: string }> | null,
      status: string,
    ) => void,
  ) => void | Promise<{ results?: Array<{ formatted_address?: string }> }>;
};

type GoogleMap = {
  setCenter: (center: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (
    bounds: GoogleLatLngBounds,
    padding?: number | MapPadding,
  ) => void;
  getCenter: () => { lat: () => number; lng: () => number } | null;
  getZoom: () => number | undefined;
  getDiv: () => HTMLElement;
  setOptions: (opts: Record<string, unknown>) => void;
};

type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (pos: { lat: number; lng: number }) => void;
  setLabel: (label: string | { text: string; color?: string }) => void;
  setTitle: (title: string) => void;
};

type GooglePolyline = {
  setMap: (map: GoogleMap | null) => void;
  setPath: (path: Array<{ lat: number; lng: number }>) => void;
  setOptions: (opts: Record<string, unknown>) => void;
};

type GoogleLatLngBounds = {
  extend: (pos: { lat: number; lng: number }) => void;
  isEmpty: () => boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var google: GoogleMapsNamespace | undefined;
  interface Window {
    google?: GoogleMapsNamespace;
    __gastaGoogleMapsPromise?: Promise<void>;
  }
}

function regionToZoom(latitudeDelta: number): number {
  // Approximate zoom from latitudeDelta.
  const zoom = Math.round(Math.log2(360 / Math.max(latitudeDelta, 0.0001)));
  return Math.min(20, Math.max(3, zoom));
}

function mapsReady(): boolean {
  return typeof window.google?.maps?.Map === "function";
}

function clearBrokenMapsStub() {
  // loading=async can leave google.maps without real constructors.
  if (window.google?.maps && !mapsReady()) {
    try {
      delete (window as { google?: unknown }).google;
    } catch {
      window.google = undefined;
    }
  }
  document
    .querySelectorAll('script[data-gasta-google-maps="1"]')
    .forEach((node) => node.remove());
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requires a browser."));
  }
  if (mapsReady()) {
    return Promise.resolve();
  }
  if (window.__gastaGoogleMapsPromise) {
    return window.__gastaGoogleMapsPromise;
  }

  clearBrokenMapsStub();

  window.__gastaGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.gastaGoogleMaps = "1";
    script.async = true;
    // Classic load (no loading=async) — Map is a real constructor on onload.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => {
      if (mapsReady()) {
        resolve();
        return;
      }
      window.__gastaGoogleMapsPromise = undefined;
      reject(new Error("maps.Map is not a constructor"));
    };
    script.onerror = () => {
      window.__gastaGoogleMapsPromise = undefined;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    window.__gastaGoogleMapsPromise = undefined;
    throw error;
  });

  return window.__gastaGoogleMapsPromise;
}

function collectChildProps(children: ReactNode) {
  const markers: MarkerProps[] = [];
  const polylines: PolylineProps[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as Record<string, unknown>;
    if (Array.isArray(props.coordinates)) {
      polylines.push(props as unknown as PolylineProps);
    } else if (
      props.coordinate &&
      typeof props.coordinate === "object" &&
      props.coordinate !== null
    ) {
      markers.push(props as unknown as MarkerProps);
    }
  });

  return { markers, polylines };
}

function markerLabel(title?: string): string {
  if (!title) return "•";
  const match = title.match(/^([A-Z])/);
  return match?.[1] ?? "•";
}

function markerFillColor(title?: string): string {
  const label = markerLabel(title);
  if (label === "A") return "#2E7D32";
  if (label === "B") return "#C62828";
  return "#1565C0";
}

/** Browser Geocoding via the already-loaded Maps JS API (Expo Location geocoder is gone on web). */
export async function reverseGeocodeWithMapsJs(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const maps = typeof window !== "undefined" ? window.google?.maps : undefined;
  if (typeof maps?.Geocoder !== "function") {
    return null;
  }

  try {
    const geocoder = new maps.Geocoder();
    // Prefer the Promise API (Maps JS v3.55+); fall back to callback.
    const maybePromise = geocoder.geocode({
      location: { lat: latitude, lng: longitude },
    }) as unknown;

    if (
      maybePromise &&
      typeof maybePromise === "object" &&
      "then" in (maybePromise as object)
    ) {
      const response = (await maybePromise) as {
        results?: Array<{ formatted_address?: string }>;
      };
      const address = response.results?.[0]?.formatted_address;
      return address?.trim() ? address : null;
    }

    return await new Promise<string | null>((resolve) => {
      geocoder.geocode(
        { location: { lat: latitude, lng: longitude } },
        (results, status) => {
          if (status === "OK" && results?.[0]?.formatted_address) {
            resolve(results[0].formatted_address);
            return;
          }
          resolve(null);
        },
      );
    });
  } catch {
    return null;
  }
}

/** OpenStreetMap / BigDataCloud fallback when Google geocoding is unavailable on web. */
export async function reverseGeocodeWithNominatim(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  // BigDataCloud is CORS-friendly and needs no key for client reverse geocode.
  try {
    const bdcUrl =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(String(latitude))}` +
      `&longitude=${encodeURIComponent(String(longitude))}` +
      `&localityLanguage=en`;
    const bdcResponse = await fetch(bdcUrl);
    if (bdcResponse.ok) {
      const data = (await bdcResponse.json()) as {
        locality?: string;
        city?: string;
        principalSubdivision?: string;
        countryName?: string;
        localityInfo?: {
          informative?: Array<{ name?: string }>;
        };
      };
      const informative = data.localityInfo?.informative
        ?.map((item) => item.name?.trim())
        .filter(Boolean)
        .slice(0, 2);
      const parts = [
        ...(informative ?? []),
        data.locality,
        data.city,
        data.principalSubdivision,
        data.countryName,
      ].filter((part, index, list): part is string => {
        if (!part?.trim()) return false;
        const normalized = part.trim().toLowerCase();
        return (
          list.findIndex(
            (other) => other?.trim().toLowerCase() === normalized,
          ) === index
        );
      });
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  } catch {
    // try Nominatim next
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(String(latitude))}` +
      `&lon=${encodeURIComponent(String(longitude))}` +
      `&zoom=18&addressdetails=0`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { display_name?: string };
    const name = data.display_name?.trim();
    return name || null;
  } catch {
    return null;
  }
}

export const Marker = Object.assign(
  function Marker(_props: MarkerProps) {
    return null;
  },
  { displayName: "Marker" },
);

export const Polyline = Object.assign(
  function Polyline(_props: PolylineProps) {
    return null;
  },
  { displayName: "Polyline" },
);

export const MapView = forwardRef<MapViewHandle, MapViewProps>(
  function MapView(
    {
      children,
      style,
      initialRegion,
      onPress,
      onRegionChangeComplete,
      mapPadding,
      showsUserLocation,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<GoogleMap | null>(null);
    const markersRef = useRef<GoogleMarker[]>([]);
    const polylinesRef = useRef<GooglePolyline[]>([]);
    const onPressRef = useRef(onPress);
    const onRegionChangeCompleteRef = useRef(onRegionChangeComplete);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    );
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";

    onPressRef.current = onPress;
    onRegionChangeCompleteRef.current = onRegionChangeComplete;

    useImperativeHandle(
      ref,
      () => ({
        animateToRegion(region) {
          const map = mapRef.current;
          if (!map) return;
          map.setCenter({ lat: region.latitude, lng: region.longitude });
          map.setZoom(regionToZoom(region.latitudeDelta));
        },
        fitToCoordinates(coordinates, options) {
          const map = mapRef.current;
          const maps = window.google?.maps;
          if (!map || !maps || coordinates.length === 0) return;
          const bounds = new maps.LatLngBounds();
          coordinates.forEach((point) => {
            bounds.extend({ lat: point.latitude, lng: point.longitude });
          });
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, options?.edgePadding ?? 48);
          }
        },
      }),
      [],
    );

    useEffect(() => {
      if (!apiKey) {
        setStatus("error");
        setErrorMessage(
          "Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to mobile/.env (Maps JavaScript API enabled).",
        );
        return;
      }

      let cancelled = false;
      let clickListener: { remove: () => void } | null = null;
      let idleListener: { remove: () => void } | null = null;

      void (async () => {
        try {
          await loadGoogleMaps(apiKey);
          if (cancelled || !containerRef.current || !window.google?.maps) {
            return;
          }

          const maps = window.google.maps;
          const center = initialRegion
            ? { lat: initialRegion.latitude, lng: initialRegion.longitude }
            : { lat: 14.5995, lng: 120.9842 };
          const zoom = initialRegion
            ? regionToZoom(initialRegion.latitudeDelta)
            : 11;

          const map = new maps.Map(containerRef.current, {
            center,
            zoom,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: "greedy",
          });
          mapRef.current = map;

          if (mapPadding) {
            map.setOptions({
              padding: {
                top: mapPadding.top ?? 0,
                right: mapPadding.right ?? 0,
                bottom: mapPadding.bottom ?? 0,
                left: mapPadding.left ?? 0,
              },
            });
          }

          clickListener = maps.event.addListener(map, "click", (event: unknown) => {
            const latLng = (event as { latLng?: { lat: () => number; lng: () => number } })
              .latLng;
            if (!latLng || !onPressRef.current) return;
            onPressRef.current({
              nativeEvent: {
                coordinate: {
                  latitude: latLng.lat(),
                  longitude: latLng.lng(),
                },
              },
            });
          });

          idleListener = maps.event.addListener(map, "idle", () => {
            if (!onRegionChangeCompleteRef.current) return;
            const c = map.getCenter();
            const z = map.getZoom() ?? 11;
            if (!c) return;
            const latitudeDelta = 360 / 2 ** z;
            onRegionChangeCompleteRef.current({
              latitude: c.lat(),
              longitude: c.lng(),
              latitudeDelta,
              longitudeDelta: latitudeDelta,
            });
          });

          if (showsUserLocation && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                new maps.Marker({
                  map,
                  position: {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                  },
                  title: "You",
                });
              },
              () => undefined,
              { enableHighAccuracy: false, timeout: 8000 },
            );
          }

          setStatus("ready");
        } catch (error) {
          if (cancelled) return;
          setStatus("error");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not load Google Maps on web.",
          );
        }
      })();

      return () => {
        cancelled = true;
        clickListener?.remove();
        idleListener?.remove();
        markersRef.current.forEach((marker) => marker.setMap(null));
        polylinesRef.current.forEach((line) => line.setMap(null));
        markersRef.current = [];
        polylinesRef.current = [];
        mapRef.current = null;
      };
      // Intentionally mount-once for the Google Map instance.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey]);

    useEffect(() => {
      const map = mapRef.current;
      const maps = typeof window !== "undefined" ? window.google?.maps : undefined;
      if (!map || !maps || status !== "ready") return;

      const { markers, polylines } = collectChildProps(children);

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = markers.map((markerProps) => {
        const label = markerLabel(markerProps.title);
        const fillColor = markerFillColor(markerProps.title);
        return new maps.Marker({
          map,
          position: {
            lat: markerProps.coordinate.latitude,
            lng: markerProps.coordinate.longitude,
          },
          title: markerProps.title ?? "",
          label: {
            text: label,
            color: "#ffffff",
            fontWeight: "700",
          },
          // Explicit Symbol path avoids InvalidValueError from undefined icon/url.
          icon: {
            path: maps.SymbolPath.CIRCLE,
            fillColor,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            scale: 14,
          },
        });
      });

      polylinesRef.current.forEach((line) => line.setMap(null));
      polylinesRef.current = polylines.map((lineProps) => {
        return new maps.Polyline({
          map,
          path: lineProps.coordinates.map((point) => ({
            lat: point.latitude,
            lng: point.longitude,
          })),
          strokeColor: lineProps.strokeColor ?? "#4A90D9",
          strokeOpacity: 0.95,
          strokeWeight: lineProps.strokeWidth ?? 5,
        });
      });
    }, [children, status]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapPadding || status !== "ready") return;
      map.setOptions({
        padding: {
          top: mapPadding.top ?? 0,
          right: mapPadding.right ?? 0,
          bottom: mapPadding.bottom ?? 0,
          left: mapPadding.left ?? 0,
        },
      });
    }, [mapPadding, status]);

    return (
      <View style={[styles.wrap, style]}>
        {createElement("div", {
          ref: containerRef,
          style: {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          },
        })}
        {status === "loading" ? (
          <View style={styles.banner} pointerEvents="none">
            <ActivityIndicator color={GasTaColors.forest} />
            <Text style={styles.bannerText}>Loading map…</Text>
          </View>
        ) : null}
        {status === "error" ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Map unavailable on web</Text>
            <Text style={styles.bannerText}>
              {errorMessage ??
                "Enable Maps JavaScript API for your Google key."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  },
);

MapView.displayName = "MapView";

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: GasTaColors.cream,
  },
  banner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
    backgroundColor: "rgba(248, 240, 229, 0.92)",
  },
  bannerTitle: {
    color: GasTaColors.forest,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  bannerText: {
    color: GasTaColors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 360,
  },
});
