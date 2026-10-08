import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type {
  UserProfile,
  UserProfileLookup,
  SharedVehicle,
  Vehicle,
  VehicleCatalogEntry,
  VehicleShare,
  VehicleShareRole,
} from '@/types';

/**
 * restore_vehicle_share() comes from 20240812000022, which has NOT been pushed
 * to the live project, so the generated Database type does not know it yet. This
 * tiny adapter types just that one call, keeping it fully typed without
 * hand-editing the generated file. Delete once `supabase gen types` is re-run.
 */
interface ShareFunctionsDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      restore_vehicle_share: {
        Args: { p_vehicle_id: string; p_user_id: string; p_role: string };
        Returns: VehicleShare;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const shareDb = supabase as unknown as SupabaseClient<ShareFunctionsDatabase>;

/**
 * vehicle_has_history / archive_vehicle / restore_vehicle arrive with
 * migration 20261009000000, so the generated Database type does not know them
 * yet. Same adapter pattern as ShareFunctionsDatabase above — delete once
 * `supabase gen types` is re-run.
 */
interface ArchiveFunctionsDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      vehicle_has_history: {
        Args: { p_vehicle_id: string };
        Returns: Array<{
          has_history: boolean;
          refill_count: number;
          trip_count: number;
          share_count: number;
          saved_trip_count: number;
        }>;
      };
      archive_vehicle: {
        Args: { p_vehicle_id: string };
        Returns: Vehicle;
      };
      restore_vehicle: {
        Args: { p_vehicle_id: string };
        Returns: Vehicle;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const archiveDb = supabase as unknown as SupabaseClient<ArchiveFunctionsDatabase>;

const shareColumns = '"ShareID", "vehicleID", shared_by, shared_with, role, created_at, revoked';

export async function findUserByEmail(email: string): Promise<UserProfileLookup | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase
    .rpc('find_user_by_email', { lookup_email: normalizedEmail })
    .maybeSingle();

  if (error) throw error;
  return (data as UserProfileLookup | null) ?? null;
}

export async function fetchUserProfileById(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as UserProfile | null) ?? null;
}

/**
 * Owner-management query: every share row for this vehicle, ACTIVE *AND* REVOKED.
 *
 * This must NOT filter on `revoked`. The Share form uses this list to tell three
 * states apart — never shared, currently active, previously revoked — so it can
 * offer "Restore access" and reactivate the existing row instead of inserting a
 * second one. With a `revoked = false` filter a revoked collaborator looks brand
 * new, the form falls through to createVehicleShare(), and the insert dies on
 * unique (vehicleID, shared_with) with 23505.
 *
 * Contrast fetchSharedVehicles(), which is the recipient's view and correctly
 * returns active rows only.
 */
export async function fetchVehicleShares(
  vehicleId: string,
  ownerId: string,
): Promise<VehicleShare[]> {
  const { data, error } = await supabase
    .from('vehicle_shares')
    .select(shareColumns)
    .eq('vehicleID', vehicleId)
    .eq('shared_by', ownerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as VehicleShare[];
}

export async function fetchSharedVehicles(userId: string): Promise<SharedVehicle[]> {
  const { data: shareData, error: shareError } = await supabase
    .from('vehicle_shares')
    .select('"vehicleID", role')
    .eq('shared_with', userId)
    .eq('revoked', false)
    .order('created_at', { ascending: false });

  if (shareError) throw shareError;

  const shares = (shareData ?? []) as unknown as Array<Pick<VehicleShare, 'vehicleID' | 'role'>>;
  if (shares.length === 0) return [];

  const vehicleIds = [...new Set(shares.map((share) => share.vehicleID))];
  // Active use only: archived owner vehicles are hidden from collaborators
  // here. History screens resolve the vehicle identity directly, so shared
  // history still displays after an archive.
  let vehicleData: Array<{ id: string; brand: string; model: string; fuel_type_id: string | null }> | null = null;
  const activeQuery = await supabase
    .from('vehicles')
    // fuel_type_id is included so a Member/Driver/Operator can log a refill for a
    // shared vehicle with the correct fuel type. vehicles_select_shared already
    // grants the whole row to active share recipients, so this needs no policy
    // change and exposes nothing new.
    .select('id, brand, model, fuel_type_id, archived_at')
    .in('id', vehicleIds)
    .is('archived_at', null);

  if (!activeQuery.error) {
    vehicleData = activeQuery.data ?? [];
  } else if (activeQuery.error.code === '42703' || /archived_at/i.test(activeQuery.error.message)) {
    // Pre-migration fallback: no archived_at column yet, so nothing can be archived.
    const retry = await supabase
      .from('vehicles')
      .select('id, brand, model, fuel_type_id')
      .in('id', vehicleIds);
    if (retry.error) throw retry.error;
    vehicleData = retry.data ?? [];
  } else {
    throw activeQuery.error;
  }

  const vehiclesById = new Map((vehicleData ?? []).map((vehicle) => [vehicle.id, vehicle]));

  return shares.flatMap((share) => {
    const vehicle = vehiclesById.get(share.vehicleID);
    if (!vehicle) return [];

    return [
      {
        vehicleId: share.vehicleID,
        brand: vehicle.brand,
        model: vehicle.model,
        fuelTypeId: vehicle.fuel_type_id,
        role: share.role,
      },
    ];
  });
}

export interface CreateVehicleShareInput {
  vehicleId: string;
  sharedBy: string;
  sharedWith: string;
  role: VehicleShareRole;
}

export async function createVehicleShare(input: CreateVehicleShareInput): Promise<VehicleShare> {
  const { data, error } = await supabase
    .from('vehicle_shares')
    .insert({
      vehicleID: input.vehicleId,
      shared_by: input.sharedBy,
      shared_with: input.sharedWith,
      role: input.role,
    })
    .select(shareColumns)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('This vehicle is already shared with that user.');
    }
    throw error;
  }

  if (!data) {
    throw new Error('Unable to create the vehicle share.');
  }

  return data as unknown as VehicleShare;
}

export async function revokeVehicleShare(
  shareId: string,
  vehicleId: string,
  ownerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('vehicle_shares')
    .update({ revoked: true })
    .eq('ShareID', shareId)
    .eq('vehicleID', vehicleId)
    .eq('shared_by', ownerId)
    .eq('revoked', false);

  if (error) throw error;
}

/**
 * Re-grant access to a previously revoked collaborator, on the SAME vehicle_shares
 * row (unique on vehicleID + shared_with, so a second INSERT is impossible).
 * Ownership and the role vocabulary are re-verified server-side.
 */
export async function restoreVehicleShare(
  vehicleId: string,
  userId: string,
  role: VehicleShareRole,
): Promise<VehicleShare> {
  const { data, error } = await shareDb
    .rpc('restore_vehicle_share', {
      p_vehicle_id: vehicleId,
      p_user_id: userId,
      p_role: role,
    })
    .single();

  if (error) {
    // 42883 = undefined_function. The RPC ships in migration
    // 20240812000022; if it has not been applied to the project yet, PostgREST
    // fails here. Say so plainly instead of surfacing a raw driver error.
    if (error.code === '42883' || /restore_vehicle_share/i.test(error.message)) {
      throw new Error(
        'Restore access is unavailable: the restore_vehicle_share function is not deployed. Apply migration 20240812000022.',
      );
    }
    throw error;
  }
  return data as unknown as VehicleShare;
}

export async function fetchVehicles(userId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', userId)
    // Active vehicles only. Archived rows stay in the table so refill, trip,
    // expense and shared history keep resolving; they are fetched separately
    // via fetchArchivedVehicles() and never appear in current-use selectors.
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (!error) return (data ?? []).map(withArchivedAt);
  // Pre-migration project: archived_at does not exist yet (42703). Fall back
  // to the unfiltered query so the app keeps working before the migration
  // is applied.
  if (error.code !== '42703' && !/archived_at/i.test(error.message)) throw error;
  const retry = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (retry.error) throw retry.error;
  return (retry.data ?? []).map(withArchivedAt);
}

/**
 * Archived vehicles for the owner's management section. Historical queries
 * (refills, trips, budget analytics) intentionally do NOT use this — they
 * resolve the vehicle row directly so archived history keeps displaying.
 */
export async function fetchArchivedVehicles(userId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', userId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });

  if (error) {
    // Pre-migration project: archived_at does not exist yet (42703). Treat
    // as "nothing archived" instead of failing the whole Vehicles screen.
    if (error.code === '42703' || /archived_at/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []).map(withArchivedAt);
}

/**
 * Rows read before the archive migration carry no archived_at key. Normalise
 * to null so `v.archived_at != null` checks never see undefined.
 */
function withArchivedAt(row: Vehicle): Vehicle {
  if (row.archived_at !== undefined) return row;
  return { ...row, archived_at: null };
}

export async function fetchVehicleCatalog(): Promise<VehicleCatalogEntry[]> {
  const { data, error } = await supabase
    .from('vehicle_catalog')
    .select('*, fuel_type:fuel_types ( code, name )')
    .order('brand')
    .order('model');

  if (error) throw error;
  return (data ?? []) as unknown as VehicleCatalogEntry[];
}

export async function fetchFuelTypeIdByCode(code: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Friendly, non-technical message shown whenever an active vehicle nickname
 * collides with another active vehicle owned by the same user. Enforced both
 * by the client pre-check and by the DB partial unique index
 * `vehicles_user_active_nickname_unique`, which raises 23505 on violation.
 * Raw Postgres text is never surfaced to the user.
 */
export const DUPLICATE_VEHICLE_NAME_MESSAGE =
  'You already have a vehicle with this name. Please use a different name.';

/**
 * Maps a Postgres unique-violation (23505) — raised by
 * `vehicles_user_active_nickname_unique` on an active per-owner nickname
 * collision — to {@link DUPLICATE_VEHICLE_NAME_MESSAGE}. Any other error is
 * re-thrown unchanged, so unrelated failures keep their original shape and no
 * raw SQL is ever exposed.
 */
function rethrowAsFriendlyDuplicate(error: { code?: string; message: string }): never {
  if (error.code === '23505') {
    throw new Error(DUPLICATE_VEHICLE_NAME_MESSAGE);
  }
  throw error;
}

export interface CreateVehicleInput {
  userId: string;
  catalogId?: string | null;
  brand: string;
  model: string;
  year: number;
  fuelTypeId: string;
  fuelEfficiencyKmPerLiter: number;
  nickname?: string;
  lastRefillPrice?: number;
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  const hasLastRefill = input.lastRefillPrice != null && input.lastRefillPrice > 0;

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      user_id: input.userId,
      catalog_id: input.catalogId ?? null,
      brand: input.brand,
      model: input.model,
      year: input.year,
      fuel_type_id: input.fuelTypeId,
      fuel_efficiency_km_per_liter: input.fuelEfficiencyKmPerLiter,
      nickname: input.nickname ?? null,
      last_refill_price: hasLastRefill ? input.lastRefillPrice : null,
      last_refill_at: hasLastRefill ? new Date().toISOString() : null,
    })
    .select('*')
    .single();

  if (error) rethrowAsFriendlyDuplicate(error);
  return data;
}

export async function updateVehicleLastRefill(
  vehicleId: string,
  lastRefillPrice: number,
): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .update({
      last_refill_price: lastRefillPrice,
      last_refill_at: new Date().toISOString(),
    })
    .eq('id', vehicleId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateVehicleInput {
  vehicleId: string;
  brand: string;
  model: string;
  year: number;
  fuelTypeId: string;
  fuelEfficiencyKmPerLiter: number;
  nickname: string;
  lastRefillPrice?: number;
}

export async function updateVehicle(input: UpdateVehicleInput): Promise<Vehicle> {
  const hasLastRefill = input.lastRefillPrice != null && input.lastRefillPrice > 0;

  const { data, error } = await supabase
    .from('vehicles')
    .update({
      brand: input.brand,
      model: input.model,
      year: input.year,
      fuel_type_id: input.fuelTypeId,
      fuel_efficiency_km_per_liter: input.fuelEfficiencyKmPerLiter,
      nickname: input.nickname,
      last_refill_price: hasLastRefill ? input.lastRefillPrice : null,
      last_refill_at: hasLastRefill ? new Date().toISOString() : null,
    })
    .eq('id', input.vehicleId)
    .select('*')
    .single();

  if (error) rethrowAsFriendlyDuplicate(error);
  return data;
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
  if (error) throw error;
}

export type VehicleHistoryState =
  | 'idle'
  | 'loading'
  | 'has-history'
  | 'no-history'
  | 'unknown';

export interface VehicleHistoryStatus {
  state: VehicleHistoryState;
  refillCount: number;
  tripCount: number;
  shareCount: number;
  savedTripCount: number;
  /** True when the vehicle_has_history RPC is not deployed yet. */
  fromFallback: boolean;
}

/** Shown when archived_at does not exist yet — never leak raw 42703. */
export const ARCHIVE_MIGRATION_REQUIRED_MESSAGE =
  'Vehicle archiving is not available until the latest database migration is applied.';

function isMigrationMissingError(error: { code?: string; message: string }): boolean {
  return error.code === '42703' || /archived_at/i.test(error.message);
}

function isMissingRpcError(error: { code?: string; message: string }, name: string): boolean {
  return (
    error.code === '42883' ||
    error.code === '40401' ||
    new RegExp(name, 'i').test(error.message)
  );
}

/**
 * Decides whether the destructive action for a vehicle is delete or archive.
 *
 * SAFETY CONTRACT (conservative direction — archiving a clean vehicle is
 * always preferable to deleting one that has history):
 *   - RPC success: has_history drives has-history / no-history.
 *   - RPC missing (undeployed migration): the owner-visible fallback counts
 *     CANNOT see collaborator-logged trips (their user_id rows are hidden by
 *     RLS), so ANY uncertainty — an error on any count query, or a zero
 *     result that may be RLS-truncated — resolves to `unknown`, which the UI
 *     treats exactly like has-history (Archive only, never Delete).
 *   - RPC hard failure (non-404): `unknown`, never Delete.
 * Only an explicit, complete, all-zero RPC answer yields `no-history`.
 */
export async function getVehicleHistoryStatus(
  vehicleId: string,
): Promise<VehicleHistoryStatus> {
  const { data, error } = await archiveDb.rpc('vehicle_has_history', {
    p_vehicle_id: vehicleId,
  });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as {
      has_history?: boolean;
      refill_count?: number | string;
      trip_count?: number | string;
      share_count?: number | string;
      saved_trip_count?: number | string;
    } | null;
    if (row == null || typeof row.has_history !== 'boolean') {
      return {
        state: 'unknown',
        refillCount: 0,
        tripCount: 0,
        shareCount: 0,
        savedTripCount: 0,
        fromFallback: false,
      };
    }
    return {
      state: row.has_history ? 'has-history' : 'no-history',
      refillCount: Number(row.refill_count ?? 0),
      tripCount: Number(row.trip_count ?? 0),
      shareCount: Number(row.share_count ?? 0),
      savedTripCount: Number(row.saved_trip_count ?? 0),
      fromFallback: false,
    };
  }

  if (!isMissingRpcError(error, 'vehicle_has_history')) {
    // Genuine failure (RLS denial, network, etc.): unknown → Archive only.
    return {
      state: 'unknown',
      refillCount: 0,
      tripCount: 0,
      shareCount: 0,
      savedTripCount: 0,
      fromFallback: false,
    };
  }

  // ---- Fallback: owner-visible counts only (no cross-user trip rows). ----
  // vehicle_refills/trip_records/saved_trips are unknown to the generated
  // Database type (same reason RefillDatabase exists in vehicleRefills.ts),
  // so the fallback queries go through a minimally-typed client.
  interface FallbackDatabase {
    public: {
      Tables: {
        vehicle_refills: { Row: { id: string } };
        trip_records: { Row: { id: string } };
        saved_trips: { Row: { id: string } };
      };
      Views: Record<string, never>;
      Functions: Record<string, never>;
      Enums: Record<string, never>;
      CompositeTypes: Record<string, never>;
    };
  }
  const fallbackDb = supabase as unknown as SupabaseClient<FallbackDatabase>;
  const [refills, trips, shares, saved] = await Promise.all([
    fallbackDb.from('vehicle_refills').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
    fallbackDb.from('trip_records').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
    supabase.from('vehicle_shares').select('ShareID', { count: 'exact', head: true }).eq('vehicleID', vehicleId),
    fallbackDb.from('saved_trips').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId),
  ]);
  // If ANY count query errored, its result is unreliable — unknown, not
  // "no history". A zero total is likewise RLS-truncated (collaborator trips
  // are invisible to the owner), so it also resolves to unknown. Only a
  // positive hit is actionable, and it means has-history.
  const anyError = refills.error ?? trips.error ?? shares.error ?? saved.error;
  if (anyError) {
    return {
      state: 'unknown',
      refillCount: 0,
      tripCount: 0,
      shareCount: 0,
      savedTripCount: 0,
      fromFallback: true,
    };
  }
  const refillCount = refills.count ?? 0;
  const tripCount = trips.count ?? 0;
  const shareCount = shares.count ?? 0;
  const savedTripCount = saved.count ?? 0;
  const total = refillCount + tripCount + shareCount + savedTripCount;
  return {
    state: total > 0 ? 'has-history' : 'unknown',
    refillCount,
    tripCount,
    shareCount,
    savedTripCount,
    fromFallback: true,
  };
}

/**
 * Archive: owner-only soft delete via RPC. Never deletes the row, so refill,
 * trip, expense and shared history stay intact. Only the owner may call this
 * — collaborators never receive an archive affordance in the UI.
 *
 * If the migration is missing (42703 on archived_at, or missing RPC), this
 * throws ARCHIVE_MIGRATION_REQUIRED_MESSAGE instead of pretending success
 * and instead of leaking raw SQL. The caller surfaces that message directly.
 */
export async function archiveVehicle(vehicleId: string): Promise<Vehicle> {
  const { data, error } = await archiveDb
    .rpc('archive_vehicle', { p_vehicle_id: vehicleId })
    .single();

  if (!error) return data;

  if (isMigrationMissingError(error) || isMissingRpcError(error, 'archive_vehicle')) {
    throw new Error(ARCHIVE_MIGRATION_REQUIRED_MESSAGE);
  }
  throw error;
}

/**
 * Restore: owner-only un-archive. Same migration-missing contract as
 * archiveVehicle(): controlled message, never raw SQL.
 */
export async function restoreVehicle(vehicleId: string): Promise<Vehicle> {
  const { data, error } = await archiveDb
    .rpc('restore_vehicle', { p_vehicle_id: vehicleId })
    .single();

  if (!error) return data;

  // Restoring clears archived_at, which can collide with an ACTIVE vehicle
  // that already owns the same normalized nickname — the partial unique index
  // raises 23505. Surface the friendly duplicate-name message, never raw SQL.
  if (error.code === '23505') {
    throw new Error(DUPLICATE_VEHICLE_NAME_MESSAGE);
  }

  if (isMigrationMissingError(error) || isMissingRpcError(error, 'restore_vehicle')) {
    throw new Error(ARCHIVE_MIGRATION_REQUIRED_MESSAGE);
  }
  throw error;
}
