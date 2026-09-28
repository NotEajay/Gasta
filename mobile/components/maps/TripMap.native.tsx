import MapViewNative, {
  Marker as MarkerNative,
  Polyline as PolylineNative,
  type MapPressEvent,
  type Region,
} from "react-native-maps";
import type { RefObject } from "react";

export const MapView = MapViewNative;
export const Marker = MarkerNative;
export const Polyline = PolylineNative;
export type { MapPressEvent, Region };

export type MapViewHandle = {
  animateToRegion?: (region: Region, duration?: number) => void;
  fitToCoordinates?: (
    coordinates: Array<{ latitude: number; longitude: number }>,
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

export type MapViewRef = RefObject<MapViewHandle | null>;

/** Native uses expo-location / Edge Function — Maps JS geocoder is web-only. */
export async function reverseGeocodeWithMapsJs(
  _latitude: number,
  _longitude: number,
): Promise<string | null> {
  return null;
}

export async function reverseGeocodeWithNominatim(
  _latitude: number,
  _longitude: number,
): Promise<string | null> {
  return null;
}
