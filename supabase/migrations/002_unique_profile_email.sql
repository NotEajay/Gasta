-- GasTa! enforce one profile per email address (case-insensitive)
-- Run this in the Supabase SQL editor or via Supabase CLI.

update public.profiles
set email = lower(email)
where email is not null and email <> lower(email);

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email))
  where email is not null;

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
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    lower(new.email)
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();

  return new;
exception
  when unique_violation then
    raise exception 'An account with this email already exists.'
      using errcode = '23505';
end;
$$;
