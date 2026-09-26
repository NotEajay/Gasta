import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type {
  PendingRefillAllocation,
  RefillAllocation,
  RefillAllocationSummary,
} from '@/types';

/**
 * refill_allocations and its functions come from migrations
 * 20240812000024-25, which have NOT been applied to the live project yet, so
 * the generated Database type does not know them yet. This small standalone
 * schema types exactly what this service touches, keeping every call fully
 * typed without hand-editing the generated file. Delete this adapter once
 * `supabase gen types` has been re-run.
 */
interface AllocationDatabase {
  public: {
    Tables: {
      refill_allocations: {
        Row: RefillAllocation;
        Insert: Partial<RefillAllocation> & { refill_id: string; user_id: string };
        Update: Partial<RefillAllocation>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_refill_split: {
        Args: { p_refill_id: string; p_allocations: unknown };
        Returns: RefillAllocation[];
      };
      respond_to_refill_allocation: {
        Args: { p_allocation_id: string; p_accept: boolean; p_note: string | null };
        Returns: RefillAllocation;
      };
      cancel_refill_allocation: {
        Args: { p_allocation_id: string };
        Returns: RefillAllocation;
      };
      refill_allocation_totals: {
        Args: { p_refill_id: string };
        Returns: AllocationTotalsRow[];
      };
      my_pending_refill_allocations: {
        Args: {};
        Returns: PendingRefillAllocation[];
      };
      my_accepted_refill_total: {
        Args: { p_year: number; p_month: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Raw snake_case shape returned by refill_allocation_totals(). */
type AllocationTotalsRow = {
  reserved: number;
  accepted_total: number;
  pending_total: number;
  unassigned: number;
};

const db = supabase as unknown as SupabaseClient<AllocationDatabase>;

/** PostgREST 40401/42883 = the object is not deployed to the project yet. */
function isMissingObject(error: { code?: string; message: string }, name: string): boolean {
  return (
    error.code === '42883' ||
    error.code === '40401' ||
    new RegExp(name, 'i').test(error.message)
  );
}

const MISSING = (label: string) =>
  new Error(
    `${label} is unavailable: the Phase 2 refill-split database objects are not deployed yet. Apply migrations 20240812000024 and 20240812000025, then retry.`,
  );

export interface SplitAllocationInput {
  userId: string;
  amount: number;
}

/** Every allocation row for one refill, whatever its status. */
export async function fetchRefillAllocations(refillId: string): Promise<RefillAllocation[]> {
  const { data, error } = await db
    .from('refill_allocations')
    .select('*')
    .eq('refill_id', refillId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingObject(error, 'refill_allocations')) throw MISSING('Allocations');
    throw error;
  }
  return data ?? [];
}

/** Server-computed reserved / accepted / pending / unassigned for one refill. */
export async function fetchRefillAllocationSummary(
  refillId: string,
): Promise<RefillAllocationSummary> {
  const { data, error } = await db.rpc('refill_allocation_totals', { p_refill_id: refillId });
  if (error) {
    if (isMissingObject(error, 'refill_allocation_totals')) throw MISSING('Split totals');
    throw error;
  }

  const row = data?.[0];
  return {
    reserved: Number(row?.reserved ?? 0),
    acceptedTotal: Number(row?.accepted_total ?? 0),
    pendingTotal: Number(row?.pending_total ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
  };
}

/**
 * Persist a whole split. The server re-derives eligibility and the total cap,
 * so this is a proposal, not a command.
 */
export async function saveRefillSplit(
  refillId: string,
  allocations: SplitAllocationInput[],
): Promise<RefillAllocation[]> {
  const payload = allocations.map((a) => ({ user_id: a.userId, amount: a.amount }));

  const { data, error } = await db.rpc('save_refill_split', {
    p_refill_id: refillId,
    p_allocations: payload,
  });

  if (error) {
    if (isMissingObject(error, 'save_refill_split')) throw MISSING('Splitting');
    throw error;
  }
  return data ?? [];
}

/** Only the recipient may call this, and only for their own allocation. */
export async function respondToRefillAllocation(
  allocationId: string,
  accept: boolean,
  note?: string | null,
): Promise<RefillAllocation> {
  const { data, error } = await db.rpc('respond_to_refill_allocation', {
    p_allocation_id: allocationId,
    p_accept: accept,
    p_note: note ?? null,
  });

  if (error) {
    if (isMissingObject(error, 'respond_to_refill_allocation')) {
      throw MISSING('Responding to an allocation');
    }
    throw error;
  }
  return data as unknown as RefillAllocation;
}

/** Withdraw a request that has not been answered yet. */
export async function cancelRefillAllocation(allocationId: string): Promise<RefillAllocation> {
  const { data, error } = await db.rpc('cancel_refill_allocation', {
    p_allocation_id: allocationId,
  });
  if (error) {
    if (isMissingObject(error, 'cancel_refill_allocation')) throw MISSING('Cancelling');
    throw error;
  }
  return data as unknown as RefillAllocation;
}

/** Everything the signed-in user is currently being asked to approve. */
export async function fetchMyPendingAllocations(): Promise<PendingRefillAllocation[]> {
  const { data, error } = await db.rpc('my_pending_refill_allocations');
  if (error) {
    if (isMissingObject(error, 'my_pending_refill_allocations')) {
      throw MISSING('Pending requests');
    }
    throw error;
  }
  return data ?? [];
}

/**
 * ACTUAL refill spending for the signed-in user this month, in pesos.
 *
 * Deliberately kept apart from the existing estimated trip fuel cost: the two
 * are separate financial sources and are never summed here, so nothing double
 * counts. The month comes from the refill's occurred_at, not from when the
 * recipient happened to accept it.
 */
export async function fetchMyAcceptedRefillTotal(year: number, month: number): Promise<number> {
  const { data, error } = await db.rpc('my_accepted_refill_total', {
    p_year: year,
    p_month: month,
  });
  if (error) {
    if (isMissingObject(error, 'my_accepted_refill_total')) throw MISSING('Refill spending');
    throw error;
  }
  return Number(data ?? 0);
}

