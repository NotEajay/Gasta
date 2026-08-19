-- GasTa! pre-signup email availability check
-- Lets the app warn about an existing account before calling auth.signUp,
-- so Supabase never sends a confirmation email for a duplicate address.
-- Run this in the Supabase SQL editor or via Supabase CLI.

create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(trim(p_email))
      and deleted_at is null
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
