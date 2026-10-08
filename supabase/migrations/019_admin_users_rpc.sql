create or replace function public.get_admin_users_and_vehicles()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz,
  vehicle_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.email,
    p.full_name,
    p.role,
    p.created_at,
    (select count(*) from vehicles v where v.user_id = p.id) as vehicle_count
  from profiles p
  order by p.created_at desc;
$$;
