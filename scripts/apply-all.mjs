#!/usr/bin/env node
/**
 * Apply supabase/apply_all.sql to the remote Supabase Postgres database.
 * Safe to re-run — apply_all.sql uses IF NOT EXISTS / CREATE OR REPLACE where possible.
 *
 * Usage (from repo root):
 *   SUPABASE_DB_PASSWORD='your-db-password' node scripts/apply-all.mjs
 *
 * Find password: Supabase Dashboard → Settings → Database → Database password
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'xzslsklecloqiitcirtw';
const password = process.env.SUPABASE_DB_PASSWORD;

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD.');
  console.error('Supabase Dashboard → Settings → Database → Database password');
  console.error('');
  console.error('Then run:');
  console.error("  SUPABASE_DB_PASSWORD='…' node scripts/apply-all.mjs");
  process.exit(1);
}

const sqlPath = path.join(__dirname, '../supabase/apply_all.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  console.log('Applying supabase/apply_all.sql (idempotent)…');
  await client.connect();
  await client.query(sql);
  console.log('Done — schema, seeds, saved_trips, and community tables ensured.');
} catch (err) {
  console.error('Failed:', err.message);
  if (err.message.includes('already exists')) {
    console.error('');
    console.error('Some objects already exist. Your DB is likely up to date.');
    console.error('Run scripts/verify-db.mjs to check, or sync-all for DOE prices.');
  }
  process.exit(1);
} finally {
  await client.end();
}
