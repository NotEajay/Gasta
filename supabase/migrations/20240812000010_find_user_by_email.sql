-- Allow authenticated vehicle owners to resolve a GasTa user for sharing
-- without exposing the profiles table or any additional profile fields.

create function public.find_user_by_email(lookup_email text)
returns table (
  id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles as p
  where lower(trim(p.email)) = lower(trim(lookup_email))
  limit 1;
$$;

revoke execute on function public.find_user_by_email(text) from public;
revoke execute on function public.find_user_by_email(text) from anon;
grant execute on function public.find_user_by_email(text) to authenticated;
