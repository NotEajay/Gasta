-- PDFs that weekly sync could not download (403/404). A separate daily workflow
-- probes only these rows; when a file becomes available it is loaded and the row
-- is deleted so daily retries stop.

create table if not exists public.doe_pending_downloads (
  id bigint generated always as identity primary key,
  region_code text not null,
  bulletin_date date not null,
  slug text not null,
  source_url text not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (region_code, bulletin_date, slug)
);

comment on table public.doe_pending_downloads is
  'DOE media PDFs skipped during weekly sync; daily retry clears a row when the file loads';

alter table public.doe_pending_downloads enable row level security;

-- Service role (ETL) bypasses RLS. No public read/write needed.
drop policy if exists "doe_pending_downloads_no_public" on public.doe_pending_downloads;
create policy "doe_pending_downloads_no_public"
  on public.doe_pending_downloads for select
  using (false);
