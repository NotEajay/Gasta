-- Find or create an oil company from a typed station brand.

create or replace function public.ensure_oil_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_name text := trim(p_name);
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Station type is required';
  end if;

  select id into v_id
  from public.oil_companies
  where lower(name) = lower(v_name)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'brand-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  insert into public.oil_companies (name, slug)
  values (v_name, v_slug)
  on conflict (slug) do update
    set name = excluded.name
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.oil_companies where slug = v_slug;
  end if;

  return v_id;
end;
$$;

grant execute on function public.ensure_oil_company(text) to authenticated;
