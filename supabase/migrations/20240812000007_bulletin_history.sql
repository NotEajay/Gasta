-- Support the full DOE bulletin archive as browsable price history.
--
-- Three changes:
--   1. Per-region provenance. `bulletin_date` is unique across all regions, so one
--      bulletin row is shared by up to five regional PDFs. A single `source_pdf_url`
--      column meant each region overwrote the previous region's source, so the ETL now
--      records one source URL per region code.
--   2. A view listing the distinct bulletin weeks that have prices for a region, so the
--      app can render its history list without pulling every price row.
--   3. Removal of the dev sample prices, which sat on invented bulletin dates and would
--      otherwise appear alongside (or ahead of) real DOE weeks.

alter table public.fuel_price_bulletins
  add column if not exists source_urls jsonb not null default '{}'::jsonb;

comment on column public.fuel_price_bulletins.source_urls is
  'DOE source PDF URL per region code, e.g. {"NCR": "https://prod-cms.doe.gov.ph/..."}';

-- Distinct bulletin weeks per region, newest first.
create or replace view public.region_bulletin_weeks as
select
  fp.region_id,
  r.code as region_code,
  b.id as bulletin_id,
  b.bulletin_date,
  b.data_freshness_days,
  b.last_loaded_at,
  count(*) as price_count
from public.fuel_prices fp
join public.fuel_price_bulletins b on b.id = fp.bulletin_id
join public.regions r on r.id = fp.region_id
group by fp.region_id, r.code, b.id, b.bulletin_date, b.data_freshness_days, b.last_loaded_at;

comment on view public.region_bulletin_weeks is
  'One row per (region, DOE bulletin week) that actually has prices loaded.';

grant select on public.region_bulletin_weeks to anon, authenticated;

-- Drop the dev sample fuel prices seeded by 20240812000002_seed_dev_fuel_data.sql.
-- Those two bulletin dates were placeholders, not real DOE publication weeks; the
-- delete cascades to their fuel_prices rows. Oil companies and the vehicle catalog
-- from that migration are kept, since the ETL reuses the company rows.
delete from public.fuel_price_bulletins
where notes in ('Dev sample — current week', 'Dev sample — prior week for trend');

-- Also drop any bulletin dated in the future. DOE weeks never start after today, so a
-- future date (e.g. 2026-12-30 from an old seed) would sort above every real week and
-- appear as "this week" in the app.
delete from public.fuel_price_bulletins
where bulletin_date > current_date;
