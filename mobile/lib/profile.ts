import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export async function ensureProfile(user: User | null) {
  if (!user) {
    return;
  }

  const fullName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    '';
  const email = user.email?.trim().toLowerCase() || null;

  const { error: rpcError } = await supabase.rpc('ensure_profile');
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
