import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import { resolveVehicleFuel } from '@/lib/services/vehicleFuel';
import { fetchTripVehicles } from '@/lib/services/vehicles';
import { fetchDefaultVehicleId } from '@/lib/services/defaultVehicle';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getSessionVehicleId, resolveDefaultVehicle, subscribeVehicleSelection } from '@/lib/vehicleSelection';
import type { Vehicle } from '@/types';

const FALLBACK: DoeFuelTypeCode = 'RON_91';

/** A vehicle-derived initial filter, with a screen-local manual override. */
export function useFuelPriceDefault(userId: string | null) {
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>(FALLBACK);
  const [vehicleLabel, setVehicleLabel] = useState<string | null>(null);
  const context = useRef<string | null>(null);
  const manualRevision = useRef(0);

  useEffect(() => {
    context.current = null;
    manualRevision.current = 0;
    setFuelType(FALLBACK);
    setVehicleLabel(null);
  }, [userId]);

  useFocusEffect(useCallback(() => {
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    let request = 0;
    let vehicles: Vehicle[] | null = null;
    let defaultId: string | null = null;
    const revisionAtOpen = manualRevision.current;

    const apply = async (revision: number) => {
      if (!vehicles) return;
      const vehicle = resolveDefaultVehicle(vehicles, userId, defaultId, getSessionVehicleId(userId));
      const key = JSON.stringify([userId, vehicle?.id ?? null, vehicle?.fuel_type_id ?? null]);
      const currentRequest = ++request;
      if (context.current === key) return;
      const fuel = await resolveVehicleFuel(vehicle?.fuel_type_id).catch(() => null);
      if (cancelled || currentRequest !== request) return;
      context.current = key;
      // A choice made while the vehicle/fuel lookup was pending wins as well.
      if (manualRevision.current !== revision) return;
      setFuelType(fuel?.code ?? FALLBACK);
      setVehicleLabel(vehicle && fuel
        ? vehicle.nickname?.trim() || `${vehicle.brand} ${vehicle.model}`.trim()
        : null);
    };

    const unsubscribe = subscribeVehicleSelection(() => { void apply(manualRevision.current); });
    void Promise.all([
      fetchTripVehicles(userId), fetchDefaultVehicleId(userId).catch(() => null),
    ]).then(([list, savedDefaultId]) => {
      if (cancelled) return;
      vehicles = list.filter((vehicle) => vehicle.archived_at == null);
      defaultId = savedDefaultId;
      void apply(revisionAtOpen);
    }).catch(() => {
      if (cancelled) return;
      vehicles = [];
      void apply(revisionAtOpen);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [userId]));

  const selectFuelType = useCallback((code: DoeFuelTypeCode) => {
    manualRevision.current += 1;
    setFuelType(code);
    setVehicleLabel(null);
  }, []);

  return { fuelType, selectFuelType, vehicleLabel };
}
