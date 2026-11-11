import type { Vehicle } from '@/types';

/** Only pass the active, readable list returned by the existing vehicle services. */
export function resolveDefaultVehicle(
  vehicles: Vehicle[], userId: string, defaultId: string | null, selectedId: string | null = null,
): Vehicle | null {
  const active = vehicles.filter((vehicle) => vehicle.archived_at == null);
  return active.find((vehicle) => vehicle.id === defaultId && vehicle.user_id === userId)
    ?? active.find((vehicle) => vehicle.id === selectedId)
    ?? active.find((vehicle) => vehicle.user_id === userId)
    ?? null;
}

// Current Trip selection only, in memory. The account default lives in profiles.
let selection: { userId: string | null; vehicleId: string | null } = {
  userId: null, vehicleId: null,
};
const listeners = new Set<() => void>();

export function resetVehicleSelectionForUser(userId: string | null) {
  if (selection.userId === userId) return;
  selection = { userId, vehicleId: null };
  listeners.forEach((listener) => listener());
}

export function getSessionVehicleId(userId: string): string | null {
  return selection.userId === userId ? selection.vehicleId : null;
}

export function selectSessionVehicle(userId: string, vehicleId: string) {
  if (selection.userId === userId && selection.vehicleId === vehicleId) return;
  selection = { userId, vehicleId };
  listeners.forEach((listener) => listener());
}

export function subscribeVehicleSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
