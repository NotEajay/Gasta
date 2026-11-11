const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');

const screenFile = path.resolve(__dirname, '../app/admin/etl.tsx');
const serviceFile = path.resolve(__dirname, '../lib/services/etlHistory.ts');
const regions = [
  ['NCR', 'NCR'],
  ['NORTH_LUZON', 'North Luzon'],
  ['SOUTH_LUZON', 'South Luzon'],
  ['VISAYAS', 'Visayas'],
  ['MINDANAO', 'Mindanao'],
];

function issue(kind, overrides = {}) {
  return {
    kind, message: 'Technical details: https://github.com/example/run record_etl_run duration_s',
    step: 'PDF parse', week_start: null, slug: null, retry_queued: null, retry_checked_at: null,
    ...overrides,
  };
}

function regionResults(overrides = {}) {
  return { version: 1, regions: regions.map(([region_code]) => ({
    region_code, status: 'processed', fetch_status: 'fetched', week_start: '2026-11-03',
    price_rows: 12, companies: 2, issues: [], ...overrides[region_code],
  })) };
}

function queuedIssue(overrides = {}) {
  return issue('not_fetched', {
    slug: 'mindanao-pdf', week_start: '2026-11-03', retry_queued: true,
    retry_checked_at: '2026-11-06T01:00:30Z', ...overrides,
  });
}

function styleOf(node) {
  return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
}

function collectText(node) {
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  if (typeof node.type === 'function') return collectText(node.type(node.props));
  return collectText(node.props?.children);
}

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}

function githubRun(overrides = {}) {
  return {
    id: 123, run_number: 54, run_attempt: 1, status: 'completed', conclusion: 'success',
    event: 'schedule', head_branch: 'master', created_at: '2026-11-06T01:00:00Z',
    run_started_at: '2026-11-06T01:00:00Z', updated_at: '2026-11-06T01:02:05Z',
    ...overrides,
  };
}

function savedRun(overrides = {}) {
  return {
    id: 'saved-1', workflow: 'weekly', status: 'partial', trigger_source: 'github-actions',
    github_run_id: '123', github_run_attempt: 1, regions_ok: 4, regions_failed: 1,
    regions_skipped: 0, duration_s: 125, started_at: '2026-11-06T01:00:00Z',
    ended_at: '2026-11-06T01:02:05Z', created_at: '2026-11-06T01:02:05Z',
    failure_reason: 'SOUTH_LUZON: stale bulletin 2026-10-13', failed_step: 'freshness check',
    error_summary: null, region_results: null, ...overrides,
  };
}

function queuedPdf(overrides = {}) {
  return {
    id: 7, region_code: 'SOUTH_LUZON', bulletin_date: '2026-10-27', slug: 'bicol',
    created_at: '2026-11-06T01:00:30Z', last_error: 'HTTP Error 403: Forbidden',
    ...overrides,
  };
}

function setup({
  weekly = [], retry = [], saved = [], savedError = null, rejectDatabase = false,
  githubStatus = 200, failWeekly = false, failDetails = false, jobs = [], annotations = [],
  pending = [], pendingError = null,
} = {}) {
  const queries = [], requests = [], opened = [];
  const supabase = {
    from(table) {
      const query = { table, filters: [], orders: [], limit: null, excludeCli: false };
      queries.push(query);
      const builder = {
        select() { return this; },
        eq(key, value) { query.filters.push([key, value]); return this; },
        not(key, operator, value) {
          assert.equal(key, 'github_run_id');
          assert.equal(operator, 'is');
          assert.equal(value, null);
          query.excludeCli = true;
          return this;
        },
        order(key, options) { query.orders.push([key, options]); return this; },
        limit(value) { query.limit = value; return this; },
        maybeSingle() { return this; },
        then(resolve, reject) {
          if (table === 'doe_etl_state') return Promise.resolve({ data: {
            id: 1, last_website_fetch_at: '2026-11-06T00:00:00Z', last_trigger: 'github-actions',
          }, error: null }).then(resolve, reject);
          if (table === 'doe_pending_downloads') return Promise.resolve({ data: pending, error: pendingError }).then(resolve, reject);
          if (rejectDatabase) return Promise.reject(new Error('Database offline')).then(resolve, reject);
          let data = saved.filter(row => query.filters.every(([key, value]) => row[key] === value));
          if (query.excludeCli) data = data.filter(row => row.github_run_id != null);
          data.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
          return Promise.resolve({ data: savedError ? null : data.slice(0, query.limit), error: savedError }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const fetchMock = async url => {
    requests.push(url);
    const isWeekly = url.includes('/actions/workflows/doe-etl-weekly.yml/');
    const isRetry = url.includes('/actions/workflows/doe-etl-pending-retry.yml/');
    if (failWeekly && isWeekly) throw new Error('Network offline');
    if (failDetails && !isWeekly && !isRetry) throw new Error('Details unavailable');
    const status = isWeekly || isRetry ? githubStatus : 200;
    const data = isWeekly ? { workflow_runs: weekly } : isRetry ? { workflow_runs: retry }
      : url.includes('/annotations?') ? annotations : { jobs };
    return { ok: status === 200, status, json: async () => data };
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, fetch: fetchMock,
    require: name => {
      if (name === '@/constants/regions') return { DOE_REGIONS: [
        { code: 'NCR', name: 'National Capital Region' },
        { code: 'NORTH_LUZON', name: 'North Luzon' },
        { code: 'SOUTH_LUZON', name: 'South Luzon' },
        { code: 'VISAYAS', name: 'Visayas' },
        { code: 'MINDANAO', name: 'Mindanao' },
      ] };
      assert.equal(name, '@/lib/supabase');
      return { supabase };
    },
  });
  const h = harness(screenFile, {
    '@/components/Themed': { Text: 'Text' },
    '@/components/ui/LoadingState': { default: 'LoadingState' },
    '@/constants/Theme': { GasTaColors: {}, GasTaSpacing: { md: 16, lg: 24 }, radii: { sm: 6, md: 12 } },
    '@/lib/supabase': { supabase },
    '@/lib/services/etlHistory': exports,
    'react-native': { Linking: { openURL: async url => opened.push(url) } },
  });
  async function render() {
    await h.flush({});
    await h.flush();
    await h.flush();
    return collectText(h.tree).replace(/\s+/g, ' ');
  }
  return { h, service: exports, queries, requests, opened, render };
}

test('GitHub determines runs and status; saved details enrich the exact run without showing CLI records', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    saved: [savedRun(), savedRun({ id: 'cli', github_run_id: null, trigger_source: 'cli', failure_reason: 'LOCAL-ONLY ERROR' })],
  });
  const text = await env.render();
  assert(text.includes('Run #54'));
  assert(text.includes('FAILED'));
  assert(!text.includes('PARTIAL'));
  assert(text.includes('Scheduled · master'));
  assert(text.includes('2m 5s'));
  assert(text.includes('4 ok · 1 failed · 0 skipped'));
  assert(text.includes('South Luzon: prices are outdated.'));
  assert(!text.includes('No matching PDF'));
  assert(!text.includes('Step: freshness check'));
  assert(!text.includes('Open GitHub'));
  assert(!text.includes('LOCAL-ONLY ERROR'));
  assert(!env.requests.some(url => url.includes('/jobs?')));
  const historyQueries = env.queries.filter(query => query.table === 'doe_etl_runs');
  assert.equal(historyQueries.length, 2);
  assert(historyQueries.every(query => query.excludeCli && query.limit === 10));
  const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  assert.equal(row.type, 'View');
  assert.equal(row.props.onPress, undefined);
  assert(!find(row, node => node.props?.name === 'open-outline'));
  assert.equal(env.opened.length, 0);
});

test('old failed GitHub runs show the actual failing step and annotation without saved ETL records', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    jobs: [{ id: 987, name: 'Sync latest bulletins', conclusion: 'failure', steps: [
      { name: 'Checkout', conclusion: 'success' }, { name: 'Install dependencies', conclusion: 'failure' },
    ] }],
    annotations: [
      { annotation_level: 'warning', message: 'IGNORE WARNING' },
      { annotation_level: 'failure', message: 'Process completed with exit code 1.' },
    ],
  });
  const text = await env.render();
  assert(text.includes('Required software could not be installed.'));
  assert(!text.includes('Process completed with exit code 1.'));
  assert(!text.includes('IGNORE WARNING'));
  assert(!text.includes('0 ok'));
  const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(runs[0].failed_step, 'Install dependencies');
  assert(runs[0].failure_reason.includes('Process completed with exit code 1.'));
  assert(env.requests.some(url => url.endsWith('/actions/runs/123/attempts/1/jobs?per_page=100')));
});

test('failed rerun cannot inherit a prior attempt error, regional snapshot, or counts', async () => {
  const env = setup({
    weekly: [githubRun({ run_attempt: 2, conclusion: 'failure' })],
    saved: [savedRun({ region_results: regionResults({ NCR: { issues: [issue('unreadable')] } }) })],
    failDetails: true,
  });
  const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(runs[0].run_attempt, 2);
  assert.equal(runs[0].regions_ok, null);
  assert.equal(runs[0].region_results, null);
  assert(!runs[0].failure_reason.includes('SOUTH_LUZON'));
  assert.equal(runs[0].failure_reason, 'The update failed. The cause was not recorded.');
});

test('successful and running GitHub runs do not inherit saved failures or manufacture completion times', async () => {
  const env = setup({ weekly: [githubRun()], saved: [savedRun()] });
  const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].failure_reason, null);
  assert.equal(runs[0].failed_step, null);
  const running = setup({ weekly: [githubRun({ status: 'in_progress', conclusion: null })] });
  const result = await running.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(result.runs[0].status, 'in_progress');
  assert.equal(result.runs[0].ended_at, null);
  assert.equal(result.runs[0].duration_s, null);
});

test('fetches each GitHub workflow separately and displays at most ten newest runs', async () => {
  const weekly = Array.from({ length: 12 }, (_, index) => githubRun({
    id: index + 1, run_number: index + 1, run_started_at: `2026-11-06T01:${String(index).padStart(2, '0')}:00Z`,
  }));
  const env = setup({ weekly });
  const result = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(result.runs.length, 10);
  assert.equal(result.runs[0].run_number, 12);
  assert.equal(result.runs[9].run_number, 3);
  await env.service.fetchEtlWorkflowHistory('pending-retry');
  assert(env.requests.some(url => url.endsWith('/actions/workflows/doe-etl-weekly.yml/runs?per_page=10')));
  assert(env.requests.some(url => url.endsWith('/actions/workflows/doe-etl-pending-retry.yml/runs?per_page=10')));
});

test('database schema errors cannot hide GitHub runs or current state', async () => {
  const env = setup({ weekly: [githubRun()], savedError: { message: 'column doe_etl_runs.workflow does not exist' } });
  const text = await env.render();
  assert(text.includes('Run #54'));
  assert(text.includes('github-actions'));
  assert(!text.includes('database migration'));
  assert(!text.includes('Unknown'));
});

test('GitHub outage falls back only to saved GitHub records with an explicit warning', async () => {
  const env = setup({ githubStatus: 403, saved: [savedRun(), savedRun({ github_run_id: null, failure_reason: 'CLI ERROR' })] });
  const result = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].status, 'failed');
  assert(result.warning.includes('Showing previously saved GitHub runs'));
});

test('one GitHub request failure does not hide the other workflow or claim an empty history', async () => {
  const env = setup({ failWeekly: true, retry: [githubRun({ id: 456, run_number: 38 })] });
  const text = await env.render();
  assert(text.includes('Run #38'));
  assert(text.includes('Could not load GitHub workflow history'));
  assert(!text.includes('No GitHub runs found.'));
});

test('matching region and PDF identify the failed download as already queued for retry', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    saved: [savedRun({ failure_reason: 'SOUTH_LUZON/bicol: Still unavailable: HTTP Error 403: Forbidden', failed_step: 'PDF download' })],
    pending: [queuedPdf()],
  });
  const text = await env.render();
  assert(text.includes('South Luzon: not fetched. Queued for PDF retry.'));
  assert(!text.includes('Open GitHub'));
  const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  assert(row);
  assert(!collectText(row).includes('HTTP Error'));
});

for (const entry of [
  queuedPdf({ region_code: 'VISAYAS' }),
  queuedPdf({ slug: 'different-pdf' }),
  queuedPdf({ created_at: '2026-11-07T00:00:00Z' }),
]) test(`unrelated pending PDF does not claim this run is queued: ${JSON.stringify(entry)}`, () => {
  const { service } = setup();
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: 'SOUTH_LUZON/bicol: Still unavailable: HTTP Error 403: Forbidden' }),
    status: 'failed',
  }, [entry]);
  assert(!text.includes('Queued for PDF retry'));
  assert.equal(text, 'South Luzon: not fetched.');
});

test('a region name alone cannot link a historical failure to today’s pending queue', () => {
  const { service } = setup();
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: 'SOUTH_LUZON: Failed: HTTP Error 403: Forbidden' }),
    status: 'failed',
  }, [queuedPdf()]);
  assert(!text.includes('already in DOE Pending PDF Retry'));
});

test('failed queue lookup does not invent retry status or add extra instructions', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })], saved: [savedRun()],
    pendingError: { message: 'Queue unavailable' },
  });
  const text = await env.render();
  assert(text.includes('South Luzon: prices are outdated.'));
  assert(!text.includes('Retry status could not be checked'));
  assert(!text.includes('No matching PDF'));
  assert(!text.includes('Queued for PDF retry'));
});

test('generic GitHub exit errors do not invent a region or promise automatic retry', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    jobs: [{ id: 987, name: 'Sync latest bulletins', conclusion: 'failure', steps: [
      { name: 'Sync latest DOE bulletins to Supabase', conclusion: 'failure' },
    ] }],
    annotations: [{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }],
    pending: [queuedPdf()],
  });
  const text = await env.render();
  assert(text.includes('The update failed. The cause was not recorded.'));
  assert(!text.includes('already in DOE Pending PDF Retry'));
  assert(!text.includes('Process completed'));
});

test('database errors are not described as a failed regional fetch', () => {
  const { service } = setup();
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: "Could not find the duration_s column of doe_etl_runs in the schema cache" }),
    status: 'failed',
  }, []);
  assert.equal(text, 'Database error: run history could not be saved.');
  assert(!text.includes('already in DOE Pending PDF Retry'));
});

for (const reason of [
  "Could not find the 'duration_s' column of 'doe_etl_runs' in the schema cache",
  "Could not find the 'ended_at' column of 'doe_etl_runs' in the schema cache",
  'column doe_etl_runs.workflow does not exist',
  'violates check constraint doe_etl_runs_status_check',
]) test(`database-only fallback is short and hides technical fields: ${reason}`, () => {
  const { service } = setup();
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: reason }), status: 'failed',
  }, [queuedPdf({ region_code: 'NORTH_LUZON' })]);
  assert.equal(text, 'Database error: run history could not be saved.');
  assert(!text.includes('North Luzon'));
  assert(!text.includes('Queued'));
});

for (const [code, name] of regions) {
  for (const workflow of ['weekly', 'pending-retry']) {
    test(`${workflow} identifies ${name} as not fetched, with retry status only when queued`, async () => {
      const slug = `${code.toLowerCase()}-pdf`;
      const env = setup({
        [workflow === 'weekly' ? 'weekly' : 'retry']: [githubRun({ conclusion: 'failure' })],
        saved: [savedRun({
          workflow,
          failure_reason: `${code}/${slug}: Still unavailable: HTTP Error 403: Forbidden`,
          failed_step: 'PDF download',
        })],
      });
      const text = await env.render();
      assert(text.includes(`${name}: not fetched.`));
      assert(!text.includes('Queued for PDF retry'));
      const result = await env.service.fetchEtlWorkflowHistory(workflow);
      assert.equal(env.service.describeEtlFailure(result.runs[0], [queuedPdf({ region_code: code, slug })]),
        `${name}: not fetched. Queued for PDF retry.`);
    });
  }
}

test('lists every region that was not fetched in a multi-region failure', () => {
  const { service } = setup();
  const reason = ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'VISAYAS', 'MINDANAO']
    .map(code => `${code}: Upstream unavailable: DOE page not found`).join('; ');
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: reason }), status: 'failed',
  }, []);
  assert.equal(text, 'Not fetched: NCR, North Luzon, South Luzon, Visayas, Mindanao.');
});

test('multiple affected regions receive separate explanations and retry statuses', () => {
  const { service } = setup();
  const text = service.describeEtlFailure({
    ...savedRun({ failure_reason: 'SOUTH_LUZON/bicol: Still unavailable: HTTP Error 403: Forbidden; VISAYAS: stale bulletin 2026-10-13' }),
    status: 'failed',
  }, [queuedPdf()]);
  assert.equal(text, 'South Luzon: not fetched. Queued for PDF retry.\nVisayas: prices are outdated.');
});

test('recovered GitHub error shows the actual problem without invented processing counts or links', async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    saved: [savedRun({
      trigger_source: 'github-log-recovery',
      regions_ok: 0, regions_failed: 0, regions_skipped: 0,
      failure_reason: "Could not find the duration_s column of doe_etl_runs in the schema cache",
      failed_step: 'record_etl_run',
    })],
  });
  const text = await env.render();
  assert(text.includes('Database error: run history could not be saved.'));
  assert(!text.includes('The cause was not recorded'));
  assert(!text.includes('0 ok'));
  assert(!text.includes('Open GitHub'));
  const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  assert.equal(row.type, 'View');
  assert.equal(row.props.onPress, undefined);
});

test('empty states mean GitHub has no runs, not that only local tests exist', async () => {
  const env = setup({ saved: [savedRun({ github_run_id: null })] });
  const text = await env.render();
  assert.equal((text.match(/No GitHub runs found\./g) ?? []).length, 2);
  assert(!text.includes('SOUTH_LUZON'));
});

for (const [code, name] of regions) {
  for (const workflow of ['weekly', 'pending-retry']) {
    test(`${workflow} uses the structured not-fetched result for ${name}, not legacy text`, async () => {
      const snapshot = regionResults({ [code]: {
        status: 'not_processed', fetch_status: 'not_fetched', price_rows: 0, companies: null,
        issues: [issue('not_fetched')],
      } });
      const env = setup({
        [workflow === 'weekly' ? 'weekly' : 'retry']: [githubRun({ conclusion: 'failure' })],
        saved: [savedRun({ workflow, region_results: snapshot })],
      });
      await env.render();
      const { runs } = await env.service.fetchEtlWorkflowHistory(workflow);
      assert.equal(runs[0].region_results, snapshot);
      assert.equal(env.service.describeEtlFailure(runs[0], null), `${name}: not fetched.`);
      const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
      assert(collectText(row).includes(`${name}: not fetched.`));
      assert(!collectText(row).includes('outdated'));
      assert(!collectText(row).includes('Queued'));
      assert(!/https?:|duration_s|record_etl_run|PDF parse/.test(collectText(row)));
      assert(!find(row, node => node.props?.onPress || node.props?.href || node.props?.accessibilityRole === 'link'));
    });
  }
}

test('groups not-fetched regions and lists genuine mixed issues separately, without raw details', () => {
  const { service } = setup();
  const text = service.describeEtlFailure(savedRun({ region_results: regionResults({
    NCR: { issues: [issue('missing_prices'), issue('error')] },
    NORTH_LUZON: { status: 'not_processed', fetch_status: 'not_fetched', issues: [issue('not_fetched'), issue('unreadable')] },
    SOUTH_LUZON: { issues: [issue('outdated')] },
    VISAYAS: { fetch_status: 'partial', issues: [issue('not_fetched'), issue('not_fetched')] },
    MINDANAO: { issues: [issue('error')] },
  }) }), []);
  assert.equal(text, [
    'Not fetched: North Luzon, Visayas.',
    'NCR: some fuel prices are missing.',
    'NCR: prices could not be updated.',
    'North Luzon: PDF could not be read.',
    'South Luzon: prices are outdated.',
    'Mindanao: prices could not be updated.',
  ].join('\n'));
  assert(!/https?:|github|duration_s|record_etl_run|PDF parse|2026-/i.test(text));
});

test('structured not-fetched grouping covers all five regions once', () => {
  const { service } = setup();
  const snapshot = regionResults(Object.fromEntries(regions.map(([code]) => [code, {
    fetch_status: 'not_fetched', status: 'not_processed', issues: [issue('not_fetched')],
  }])));
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), []),
    'Not fetched: NCR, North Luzon, South Luzon, Visayas, Mindanao.');
});

for (const workflow of ['weekly', 'pending-retry']) {
  test(`${workflow} successful GitHub status retains skipped/unavailable region warnings`, async () => {
    const snapshot = regionResults({ VISAYAS: {
      status: 'not_processed', fetch_status: 'not_fetched', price_rows: 0, issues: [issue('not_fetched')],
    } });
    const env = setup({
      [workflow === 'weekly' ? 'weekly' : 'retry']: [githubRun()],
      saved: [savedRun({ workflow, region_results: snapshot, regions_failed: 0, regions_skipped: 1 })],
    });
    await env.render();
    const { runs } = await env.service.fetchEtlWorkflowHistory(workflow);
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].failure_reason, null);
    assert.equal(runs[0].region_results, snapshot);
    const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
    assert(collectText(row).includes('SUCCESS'));
    assert(!collectText(row).includes('FAILED'));
    const message = find(row, node => node.props?.testID === 'etl-message-123:1');
    assert.equal(collectText(message), 'Visayas: not fetched.');
    assert.equal(styleOf(message).backgroundColor, '#FFFBEB');
    assert.equal(styleOf(find(message, node => node.type === 'Text')).color, '#B45309');
    assert(find(row, node => node.props?.name === 'checkmark-circle' && node.props?.color === '#15803D'));
    assert(!env.requests.some(url => url.includes('/jobs?')));
  });
}

for (const status of ['success', 'failure']) {
  test(`structured all-success/no-work results do not display a regional failure for GitHub ${status}`, async () => {
    const snapshot = regionResults({
      NORTH_LUZON: { status: 'no_work', fetch_status: 'not_attempted', price_rows: 0, companies: null, week_start: null },
      VISAYAS: { status: 'no_work', fetch_status: 'unknown', price_rows: 0, companies: null, week_start: null },
    });
    const env = setup({ weekly: [githubRun({ conclusion: status })], saved: [savedRun({ region_results: snapshot })] });
    await env.render();
    const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
    const messageText = env.service.describeEtlFailure(runs[0], [queuedPdf()]);
    assert.equal(messageText, status === 'success' ? '' : 'The update failed. The cause was not recorded.');
    const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
    assert.equal(Boolean(find(row, node => node.props?.testID === 'etl-message-123:1')), status === 'failure');
    assert(collectText(row).includes(status === 'success' ? 'SUCCESS' : 'FAILED'));
    assert(!collectText(row).includes('outdated'));
  });
}

test('structured unavailable status is evidence even when issue details were omitted', () => {
  const { service } = setup();
  const snapshot = regionResults({
    NCR: { status: 'not_processed', fetch_status: 'not_fetched', issues: [] },
    MINDANAO: { status: 'not_processed', fetch_status: 'unknown', issues: [] },
  });
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), [queuedPdf({ region_code: 'NCR' })]),
    'NCR: not fetched.');
});

test('unprocessed regions are not falsely labelled as failed fetches', () => {
  const { service } = setup();
  const snapshot = regionResults(Object.fromEntries(regions.map(([code]) => [code, {
    status: 'not_processed', fetch_status: 'not_attempted', week_start: null,
    price_rows: 0, companies: null, issues: [],
  }])));
  assert.equal(service.describeEtlFailure(savedRun({
    status: 'failed', region_results: snapshot,
    failure_reason: 'RuntimeError: queue unavailable', failed_step: 'load pending queue',
  }), []), 'The PDF retry queue could not be loaded.');
});

test('a shared database failure remains visible when all regional fetches succeeded', () => {
  const { service } = setup();
  const run = savedRun({
    status: 'failed', region_results: regionResults(),
    failure_reason: 'RuntimeError: database state failed', failed_step: 'latest DOE fetch state',
  });
  assert.equal(service.describeEtlFailure(run, []), 'Database error: update status could not be saved.');
  run.failed_step = 'record_etl_run';
  run.failure_reason = 'doe_etl_runs could not be saved';
  assert.equal(service.describeEtlFailure(run, []), 'Database error: run history could not be saved.');
});

test('confirmed retry snapshot survives later removal and failed lookup of the current queue', async () => {
  const snapshot = regionResults({ MINDANAO: {
    status: 'not_processed', fetch_status: 'not_fetched', issues: [queuedIssue()],
  } });
  const pending = [queuedPdf({ region_code: 'MINDANAO', slug: 'mindanao-pdf', bulletin_date: '2026-11-03' })];
  const env = setup({ weekly: [githubRun({ conclusion: 'failure' })], saved: [savedRun({ region_results: snapshot })], pending });
  await env.render();
  let row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  assert(collectText(row).includes('Mindanao: not fetched. Queued for PDF retry.'));
  pending.splice(0);
  const refresh = find(env.h.tree, node => node.props?.accessibilityLabel === 'Refresh ETL history');
  refresh.props.onPress();
  await env.render();
  row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  assert.equal(collectText(find(row, node => node.props?.testID === 'etl-message-123:1')),
    'Mindanao: not fetched. Queued for PDF retry.');
  assert(!/recovered|resolved/i.test(collectText(row)));
  const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(env.service.describeEtlFailure(runs[0], null), 'Mindanao: not fetched. Queued for PDF retry.');
  const unavailable = setup({
    weekly: [githubRun()], saved: [savedRun({ region_results: snapshot })], pendingError: { message: 'Queue unavailable' },
  });
  assert((await unavailable.render()).includes('Mindanao: not fetched. Queued for PDF retry.'));
});

for (const [label, overrides] of [
  ['unknown boolean', { retry_queued: null }],
  ['false boolean', { retry_queued: false }],
  ['missing slug', { slug: null }],
  ['empty slug', { slug: ' ' }],
  ['missing date', { week_start: null }],
  ['invalid date', { week_start: '2026-02-30' }],
  ['missing observation', { retry_checked_at: null }],
  ['invalid observation', { retry_checked_at: 'not-a-date' }],
  ['date-only observation', { retry_checked_at: '2026-11-06' }],
]) test(`structured ${label} does not promise a retry, even when a current queue row matches`, () => {
  const { service } = setup();
  const snapshot = regionResults({ MINDANAO: { issues: [queuedIssue(overrides)] } });
  const pending = [queuedPdf({ region_code: 'MINDANAO', slug: 'mindanao-pdf', bulletin_date: '2026-11-03' })];
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), pending), 'Mindanao: not fetched.');
});

test('mixed retry evidence groups not-fetched regions without promising every PDF a retry', () => {
  const { service } = setup();
  const snapshot = regionResults({
    NORTH_LUZON: { issues: [queuedIssue({ slug: 'north-pdf' })] },
    VISAYAS: { issues: [issue('not_fetched')] },
  });
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), []),
    'Not fetched: North Luzon, Visayas.\nNorth Luzon: Queued for PDF retry.');
  snapshot.regions.find(region => region.region_code === 'VISAYAS').issues = [queuedIssue({ slug: 'visayas-pdf' })];
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), []),
    'Not fetched: North Luzon, Visayas. Queued for PDF retry.');
  snapshot.regions.find(region => region.region_code === 'NORTH_LUZON').issues.push(issue('not_fetched'));
  assert.equal(service.describeEtlFailure(savedRun({ region_results: snapshot }), []),
    'Not fetched: North Luzon, Visayas.\nVisayas: Queued for PDF retry.');
});

for (const [label, snapshot] of [
  ['null', null], ['absent', undefined], ['string', 'NCR: not fetched'], ['number', 1], ['boolean', true],
  ['array', []], ['legacy map', { NCR: { status: 'failed' } }],
  ['future version', { version: 2, regions: regionResults().regions }],
  ['wrong version type', { version: '1', regions: [] }],
  ['missing regions', { version: 1 }], ['empty regions', { version: 1, regions: [] }],
  ['incomplete region list', { version: 1, regions: [regionResults().regions[0]] }],
  ['invalid regions', { version: 1, regions: {} }],
  ['null region', { version: 1, regions: [null] }],
  ['incomplete region', { version: 1, regions: [{ region_code: 'NCR', issues: null }] }],
  ['unknown region', { version: 1, regions: [{ ...regionResults().regions[0], region_code: 'OTHER' }] }],
  ['unknown status', regionResults({ NCR: { status: 'failed' } })],
  ['unknown fetch status', regionResults({ NCR: { fetch_status: 'missing' } })],
  ['invalid count', regionResults({ NCR: { price_rows: '12' } })],
  ['negative count', regionResults({ NCR: { companies: -1 } })],
  ['invalid issues', regionResults({ NCR: { issues: {} } })],
  ['null issue', regionResults({ NCR: { issues: [null] } })],
  ['unknown issue kind', regionResults({ NCR: { issues: [issue('future_kind')] } })],
  ['prototype issue kind', regionResults({ NCR: { issues: [issue('toString')] } })],
  ['nonstring message', regionResults({ NCR: { issues: [issue('error', { message: {} })] } })],
  ['wrong retry boolean', regionResults({ NCR: { issues: [queuedIssue({ retry_queued: 'true' })] } })],
  ['duplicate regions', { version: 1, regions: [regionResults().regions[0], regionResults().regions[0]] }],
]) test(`invalid/legacy structured JSON falls back safely: ${label}`, async () => {
  const env = setup({
    weekly: [githubRun({ conclusion: 'failure' })],
    saved: [savedRun({ region_results: snapshot, failure_reason: 'Could not find duration_s in doe_etl_runs schema cache' })],
    pending: [queuedPdf({ region_code: 'NCR' })],
  });
  await env.render();
  const row = find(expand(env.h.tree), node => node.props?.testID === 'etl-run-123:1');
  const message = find(row, node => node.props?.testID === 'etl-message-123:1');
  assert.equal(collectText(message), 'Database error: run history could not be saved.');
  assert(!/Queued|NCR|duration_s|https?:|Step:/.test(collectText(row)));
});

test('invalid structured JSON still permits conservative regional legacy fallback', () => {
  const { service } = setup();
  const run = savedRun({ region_results: { version: 2, regions: [] }, failure_reason: 'NORTH_LUZON: OCR failed' });
  assert.equal(service.describeEtlFailure(run, []), 'North Luzon: PDF could not be read.');
  assert.equal(service.describeEtlFailure(savedRun({ failure_reason: null, status: 'failed' }), []),
    'The update failed. The cause was not recorded.');
});

test('structured data is preserved in saved GitHub fallback without including CLI records', async () => {
  const snapshot = regionResults({ MINDANAO: { issues: [queuedIssue()] } });
  const env = setup({ githubStatus: 403, saved: [
    savedRun({ region_results: snapshot }),
    savedRun({ id: 'cli', github_run_id: null, region_results: regionResults({ NCR: { issues: [issue('unreadable')] } }) }),
  ] });
  const result = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].region_results, snapshot);
  assert.equal(env.service.describeEtlFailure(result.runs[0], []), 'Mindanao: not fetched. Queued for PDF retry.');
  assert(result.warning.includes('Showing previously saved GitHub runs'));
});

test('regional snapshots match GitHub run ID, attempt and workflow, excluding CLI and prior attempts', async () => {
  const snapshot = regionResults({ NORTH_LUZON: { issues: [issue('unreadable')] } });
  const unrelated = regionResults({ SOUTH_LUZON: { issues: [issue('not_fetched')] } });
  const env = setup({
    weekly: [githubRun({ run_attempt: 2, conclusion: 'failure' })],
    saved: [
      savedRun({ region_results: unrelated }),
      savedRun({ id: 'other-run', github_run_id: '456', github_run_attempt: 2, region_results: unrelated }),
      savedRun({ id: 'other-workflow', workflow: 'pending-retry', github_run_attempt: 2, region_results: unrelated }),
      savedRun({ id: 'cli', github_run_id: null, github_run_attempt: 2, region_results: unrelated }),
      savedRun({ id: 'matched', github_run_attempt: 2, region_results: snapshot }),
    ],
  });
  const { runs } = await env.service.fetchEtlWorkflowHistory('weekly');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, '123:2');
  assert.equal(runs[0].run_number, 54);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].region_results, snapshot);
  assert.equal(env.service.describeEtlFailure(runs[0], []), 'North Luzon: PDF could not be read.');
});

test('old runs 51–54 with database-only evidence never acquire regional failures from current queue', async () => {
  const weekly = [51, 52, 53, 54].map(run_number => githubRun({ id: run_number, run_number, conclusion: 'failure' }));
  const saved = weekly.map(run => savedRun({
    id: `recovered-${run.id}`, github_run_id: String(run.id), trigger_source: 'github-log-recovery',
    failure_reason: 'Could not find duration_s in doe_etl_runs schema cache', failed_step: 'record_etl_run',
  }));
  const env = setup({ weekly, saved, pending: regions.map(([region_code]) => queuedPdf({ id: region_code, region_code })) });
  await env.render();
  for (const run of weekly) {
    const row = find(expand(env.h.tree), node => node.props?.testID === `etl-run-${run.id}:1`);
    assert(collectText(row).includes(`Run #${run.run_number}`));
    const message = find(row, node => node.props?.testID === `etl-message-${run.id}:1`);
    assert.equal(collectText(message), 'Database error: run history could not be saved.');
    assert(!/not fetched|Queued|duration_s|record_etl_run|https?:|\d ok/.test(collectText(row)));
  }
});
