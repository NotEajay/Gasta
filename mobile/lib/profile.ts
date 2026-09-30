import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Narrow client that types the one RPC the generated `Database` does not know.
 *
 * `ensure_profile()` is defined in migration 004_ensure_profile.sql (no
 * parameters, returns public.profiles) and has been called from here all along,
 * but `types/database.ts` was generated before that function existed, so the
 * generated `Functions` union does not include it and `supabase.rpc` rejects the
 * name at compile time.
 *
 * This is the same adapter pattern already used in refillAllocations.ts and
 * vehicleRefills.ts for the other not-yet-generated Phase 2 objects: a small
 * standalone schema typed for exactly what is called, rather than a cast at the
 * call site or any change to the generated file or the database. Delete once
 * `supabase gen types` has been re-run.
 */
interface ProfileDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      ensure_profile: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const db = supabase as unknown as SupabaseClient<ProfileDatabase>;

export async function ensureProfile(user: User | null) {
  if (!user) {
    return;
  }

  const fullName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    '';
  const email = user.email?.trim().toLowerCase() || null;

  // Called through the narrow client above: identical RPC, identical
  // parameters (none), identical error handling. The `data` result is unused
  // here exactly as before, so the fallback path below is unchanged.
  const { error: rpcError } = await db.rpc('ensure_profile');
  if (!rpcError) {
    return;
  }

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      full_name: fullName,
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (__DEV__ && error) {
    console.warn('[profile] Failed to save profile', rpcError.message, error.message);
  }
}
