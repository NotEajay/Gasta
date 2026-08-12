#!/usr/bin/env node
/**
 * Apply supabase/apply_all.sql to a remote Supabase project.
 * Requires database password (NOT the anon key).
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD='your-db-password' node scripts/apply-remote-db.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'xzslsklecloqiitcirtw';
const password = process.env.SUPABASE_DB_PASSWORD;

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD.');
  console.error('Get it from: Supabase Dashboard → Settings → Database → Database password');
  process.exit(1);
}

const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
const sql = fs.readFileSync(path.join(__dirname, '../supabase/apply_all.sql'), 'utf8');

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  console.log('Connecting to Supabase Postgres…');
  await client.connect();
  console.log('Running apply_all.sql…');
  await client.query(sql);
  console.log('Done — schema + seed data applied.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
