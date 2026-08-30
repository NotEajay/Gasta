#!/usr/bin/env node
/**
 * Apply a single Supabase migration file to the remote Postgres database.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='your-db-password' node scripts/apply-migration.mjs vehicle_last_refill
 *
 * Migration name matches files in supabase/migrations/ (partial match).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'xzslsklecloqiitcirtw';
const password = process.env.SUPABASE_DB_PASSWORD;
const nameFilter = process.argv[2] ?? 'vehicle_last_refill';

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD.');
  console.error('Supabase Dashboard → Settings → Database → Database password');
  process.exit(1);
}

const migrationsDir = path.join(__dirname, '../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(nameFilter));
if (files.length === 0) {
  console.error(`No migration matching "${nameFilter}" in supabase/migrations/`);
  process.exit(1);
}

const migrationFile = files.sort().at(-1);
const sql = fs.readFileSync(path.join(migrationsDir, migrationFile), 'utf8');
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  console.log(`Applying ${migrationFile}…`);
  await client.connect();
  await client.query(sql);
  console.log('Done.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
