export interface RouteLocation {
  /** Human-readable label for display; never used as the Directions payload. */
  displayName: string;
  latitude: number;
  longitude: number;
}

export interface PickedRoutePoint extends RouteLocation {
  /** Exact Google Maps location string used by the existing Directions call. */
  directionsValue: string;
}

export interface PickedRouteSelection {
  origin: PickedRoutePoint;
  destination: PickedRoutePoint;
}

let pendingSelection: PickedRouteSelection | null = null;

/** Stage a picker result for the Trip screen to consume when it regains focus. */
export function publishRouteSelection(selection: PickedRouteSelection): void {
  pendingSelection = selection;
}

/** Consume a staged selection exactly once so repeated focus events are harmless. */
export function consumeRouteSelection(): PickedRouteSelection | null {
  const selection = pendingSelection;
  pendingSelection = null;
  return selection;
}
