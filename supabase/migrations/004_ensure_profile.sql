-- Allow the signed-in user to create their own profile, and stop Google
-- signups from being rolled back when a profile insert hits a unique email.

drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can insert own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    ),
    nullif(lower(trim(new.email)), '')
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();

  return new;
exception
  when unique_violation then
    -- Keep the auth user even if a profile with this email already exists.
    return new;
end;
$$;

create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result public.profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (id, full_name, email)
  select
    u.id,
    coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    ),
    nullif(lower(trim(u.email)), '')
  from auth.users u
  where u.id = uid
  on conflict (id) do update
  set
    full_name = case
      when excluded.full_name is not null and excluded.full_name <> '' then excluded.full_name
      else public.profiles.full_name
    end,
    email = coalesce(excluded.email, public.profiles.email),
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;
