const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261106000000_doe_etl_run_history_retention.sql'),
  'utf8'
);
const regionMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261106000001_doe_etl_region_results.sql'),
  'utf8'
);
const regionResults = {
  version: 1,
  regions: ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'VISAYAS', 'MINDANAO'].map((code, index) => ({
    region_code: code,
    status: index < 2 ? 'processed' : index === 2 ? 'not_processed' : 'no_work',
    fetch_status: index < 2 ? 'fetched' : index === 2 ? 'partial' : 'not_attempted',
    week_start: index < 3 ? '2026-11-03' : null,
    price_rows: index < 2 ? 24 : 0,
    companies: index < 2 ? 4 : null,
    issues: index === 2 ? [{
      kind: 'not_fetched', message: 'Bicol PDF unavailable', step: 'PDF download',
      week_start: '2026-11-03', slug: 'bicol', retry_queued: true,
      retry_checked_at: '2026-11-06T01:02:08+00:00',
    }] : [],
  })),
};

for (const shape of ['live-legacy', 'migration-021']) {
  test(`${shape}: region snapshots, legacy calls, retention, reruns and permissions`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.is_developer_or_admin() returns boolean
          language sql as $$ select current_setting('test.admin', true) = 'true' $$;
      `);
      if (shape === 'live-legacy') {
        await db.exec(`
          create table public.doe_etl_runs (
            id uuid primary key default gen_random_uuid(),
            run_at timestamptz not null default now(),
            status text not null constraint doe_etl_runs_status_check
              check (status in ('success', 'failed')),
            trigger_source text, files_processed integer default 0, error_log text,
            created_at timestamptz not null default now()
          );
          insert into public.doe_etl_runs (status, trigger_source, files_processed, error_log)
            values ('failed', 'pending-retry', 3, 'original error');
        `);
      } else {
        await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/021_etl_run_history.sql'), 'utf8'));
        await db.exec(`insert into public.doe_etl_runs (workflow, status, regions_ok)
          values ('weekly', 'success', 5)`);
      }
      await db.exec(migration);
      await db.exec(migration);
      const legacyRows = (await db.query('select * from public.doe_etl_runs')).rows;
      await db.exec(regionMigration);
      await db.exec(regionMigration);
      const upgradedRows = (await db.query('select * from public.doe_etl_runs')).rows;
      assert(upgradedRows.every(row => row.region_results === null));
      assert.deepEqual(upgradedRows.map(({ region_results, ...row }) => row), legacyRows);
      if (shape === 'live-legacy') {
        const row = upgradedRows[0];
        assert.equal(row.workflow, 'pending-retry');
        assert.equal(row.failure_reason, 'original error');
        assert.equal(row.files_processed, 3);
      }
      const signatures = (await db.query(`
        select pronargs::int, pronargdefaults::int
        from pg_proc join pg_namespace on pg_namespace.oid = pronamespace
        where proname = 'save_doe_etl_run' and nspname = 'public'
      `)).rows;
      assert.deepEqual(signatures, [{ pronargs: 14, pronargdefaults: 1 }]);
      const definition = (await db.query(`
        select pg_get_functiondef(oid) as definition from pg_proc
        where proname = 'save_doe_etl_run' and pronamespace = 'public'::regnamespace
      `)).rows[0].definition;
      assert.match(definition, /pg_advisory_xact_lock/);
      assert.match(definition, /offset 10/);

      async function save(workflow, index, attempt = 1, snapshot = undefined, status = index % 2 ? 'failed' : 'success') {
        const params = [workflow, status,
          `2026-11-06T00:${String(index).padStart(2, '0')}:00Z`,
          `2026-11-06T00:${String(index).padStart(2, '0')}:10Z`,
          `${workflow}-${index}`, attempt, status === 'success' ? null : 'Expected failure'];
        if (snapshot !== undefined) params.push(snapshot === null ? null : JSON.stringify(snapshot));
        return db.query(`select (public.save_doe_etl_run(
          $1,$2,$3::timestamptz,$4::timestamptz,'test',$5,$6,2,1,2,10,$7,'PDF parse'
          ${snapshot === undefined ? '' : ',$8::jsonb'}
        )).id`, params);
      }
      // Exercise the actual service-role grants, not just the database owner.
      await db.exec('set role service_role');
      for (const workflow of ['weekly', 'pending-retry']) {
        for (let index = 0; index < 12; index++) await save(workflow, index);
      }
      const counts = (await db.query('select workflow,count(*)::int n from public.doe_etl_runs group by workflow')).rows;
      assert.equal(counts.length, 2);
      assert(counts.every(row => row.n === 10));
      assert.equal((await db.query("select count(*)::int n from public.doe_etl_runs where github_run_id in ('weekly-0','weekly-1')")).rows[0].n, 0);
      const before = (await db.query("select id from public.doe_etl_runs where github_run_id='weekly-11'")).rows[0].id;
      await save('weekly', 11);
      assert.equal((await db.query("select id from public.doe_etl_runs where github_run_id='weekly-11'")).rows[0].id, before);
      await save('weekly', 11, 1, regionResults, 'partial');
      let detailed = (await db.query('select * from public.doe_etl_runs where id=$1', [before])).rows[0];
      assert.equal(detailed.status, 'partial');
      assert.deepEqual(detailed.region_results, regionResults);
      assert.equal(detailed.region_results.regions.length, 5);
      assert.equal(detailed.region_results.regions[4].status, 'no_work');
      // Older finalizers omit the argument; explicit SQL/JSON null must also preserve it.
      await save('weekly', 11);
      await save('weekly', 11, 1, null);
      await db.query(`select public.save_doe_etl_run(
        'weekly','partial','2026-11-06T00:11:00Z','2026-11-06T00:11:10Z',
        'test','weekly-11',1,2,1,2,10,'Expected failure','PDF parse','null'::jsonb
      )`);
      detailed = (await db.query('select * from public.doe_etl_runs where id=$1', [before])).rows[0];
      assert.deepEqual(detailed.region_results, regionResults);
      const refreshedResults = structuredClone(regionResults);
      refreshedResults.regions[2].issues[0].retry_checked_at = '2026-11-06T01:03:00+00:00';
      await save('weekly', 11, 1, refreshedResults, 'partial');
      await save('weekly', 11, 2);
      const attempts = (await db.query(`select github_run_attempt, region_results
        from public.doe_etl_runs where github_run_id='weekly-11' order by github_run_attempt`)).rows;
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[0].region_results, refreshedResults);
      assert.equal(attempts[1].region_results, null);
      await assert.rejects(save('weekly', 12, 1, regionResults, 'invalid'), /Unsupported DOE ETL status/);
      assert.equal((await db.query('select count(*)::int n from public.doe_etl_runs')).rows[0].n, 20);

      // Reapplying this migration must not rewrite snapshots or historical columns.
      await db.exec('reset role');
      const beforeReapply = (await db.query('select * from public.doe_etl_runs order by id')).rows;
      await db.exec(regionMigration);
      assert.deepEqual((await db.query('select * from public.doe_etl_runs order by id')).rows, beforeReapply);
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from public.doe_etl_runs'), /permission denied/);
      await assert.rejects(save('weekly', 12), /permission denied/);
      await assert.rejects(save('weekly', 12, 1, regionResults), /permission denied/);
      await db.exec("reset role; set role authenticated; set test.admin = 'false';");
      assert.equal((await db.query('select count(*)::int n from public.doe_etl_runs')).rows[0].n, 0);
      await db.exec("set test.admin = 'true';");
      assert.equal((await db.query('select count(*)::int n from public.doe_etl_runs')).rows[0].n, 20);
      assert.deepEqual((await db.query('select region_results from public.doe_etl_runs where id=$1', [before])).rows[0].region_results, refreshedResults);
      await assert.rejects(save('weekly', 12), /permission denied/);
      await assert.rejects(save('weekly', 12, 1, regionResults), /permission denied/);
    } finally {
      await db.close();
    }
  });
}
