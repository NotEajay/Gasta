-- Add role to profiles
alter table public.profiles add column if not exists role text not null default 'user' check (role in ('user', 'developer', 'admin'));

-- Function to check if current user is admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Function to check if current user is developer or admin
create or replace function public.is_developer_or_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('developer', 'admin')
  );
$$;

-- Update RLS for profiles so admins can see all profiles
create policy "Admins can view all profiles"
  on public.profiles
  for select
  using (public.is_admin());

-- Also need admins to be able to see all vehicles and their users.
-- Assuming there are tables for vehicles. Let's create admin policies for them later if needed.
