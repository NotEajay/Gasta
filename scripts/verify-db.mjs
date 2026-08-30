#!/usr/bin/env node
/**
 * Print a quick health check of the shared Supabase schema.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='…' node scripts/verify-db.mjs
 */
import pg from 'pg';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'xzslsklecloqiitcirtw';
const password = process.env.SUPABASE_DB_PASSWORD;

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

const checks = [
  ['regions (expect 5)', `select count(*)::int as n from public.regions`],
  ['saved_trips table', `select to_regclass('public.saved_trips') is not null as ok`],
  ['fuel_stations table', `select to_regclass('public.fuel_stations') is not null as ok`],
  ['community RPCs (expect 3)', `
    select count(*)::int as n from information_schema.routines
    where routine_schema = 'public'
      and routine_name in ('create_fuel_station','submit_community_fuel_report','confirm_community_fuel_report')
  `],
  ['NCR sample stations (expect 10)', `
    select count(*)::int as n from public.fuel_stations fs
    join public.regions r on r.id = fs.region_id where r.code = 'NCR'
  `],
  ['fuel_prices by region', `
    select r.code, count(fp.id)::int as rows, max(b.bulletin_date) as latest
    from public.regions r
    left join public.fuel_prices fp on fp.region_id = r.id
    left join public.fuel_price_bulletins b on b.id = fp.bulletin_id
    group by r.code order by r.code
  `],
];

await client.connect();
console.log('GasTa Supabase health check\n');
for (const [label, query] of checks) {
  const { rows } = await client.query(query);
  console.log(`## ${label}`);
  console.table(rows);
  console.log('');
}
await client.end();
