// TypeScript / fallback entry. Metro prefers TripMap.web.tsx or TripMap.native.tsx.
// Re-export the web module so this file never pulls in react-native-maps during SSR.
export {
  MapView,
  Marker,
  Polyline,
  reverseGeocodeWithMapsJs,
  reverseGeocodeWithNominatim,
  type MapPressEvent,
  type MapViewHandle,
  type Region,
} from "./TripMap.web";
