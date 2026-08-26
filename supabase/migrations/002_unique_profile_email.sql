-- Prevent duplicate accounts from sharing the same email address.
-- Run this in the Supabase SQL editor or via Supabase CLI.

update public.profiles
set email = lower(trim(email))
where email is not null;

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email))
  where email is not null and length(trim(email)) > 0;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and exists (
    select 1
    from public.profiles
    where lower(email) = lower(new.email)
      and id <> new.id
  ) then
    raise exception 'An account with this email already exists';
  end if;

  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    lower(trim(new.email))
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;
