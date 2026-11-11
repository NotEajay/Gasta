import { supabase } from '@/lib/supabase';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import type { Database, Json } from '@/types/database';

export type EtlWorkflow = 'weekly' | 'pending-retry';
type SavedRun = Database['public']['Tables']['doe_etl_runs']['Row'];

type GitHubRun = {
  id: number;
  run_number: number;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
};

type GitHubJob = {
  id: number;
  name: string;
  conclusion: string | null;
  steps?: { name: string; conclusion: string | null }[];
};

export type EtlWorkflowRun = {
  id: string;
  workflow: EtlWorkflow;
  run_number: number | null;
  run_attempt: number;
  status: string;
  branch: string | null;
  trigger_source: string | null;
  github_run_id: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  regions_ok: number | null;
  regions_failed: number | null;
  regions_skipped: number | null;
  region_results?: Json | null;
  failure_reason: string | null;
  failed_step: string | null;
};

export type PendingRetryEntry = Pick<
  Database['public']['Tables']['doe_pending_downloads']['Row'],
  'region_code' | 'bulletin_date' | 'slug' | 'created_at'
>;

const ISSUE_MESSAGES = {
  not_fetched: 'not fetched.',
  outdated: 'prices are outdated.',
  unreadable: 'PDF could not be read.',
  missing_prices: 'some fuel prices are missing.',
  error: 'prices could not be updated.',
} as const;
type IssueKind = keyof typeof ISSUE_MESSAGES;
type RegionIssue = {
  kind: IssueKind;
  message: string;
  step: string | null;
  week_start: string | null;
  slug: string | null;
  retry_queued: boolean | null;
  retry_checked_at: string | null;
};
type RegionResult = {
  region_code: DoeRegionCode;
  status: 'processed' | 'not_processed' | 'no_work';
  fetch_status: 'fetched' | 'partial' | 'not_fetched' | 'unknown' | 'not_attempted';
  week_start: string | null;
  price_rows: number;
  companies: number | null;
  issues: RegionIssue[];
};
type RegionalNotice = { code: DoeRegionCode; kind: IssueKind; queued: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRegionIssue(value: unknown): value is RegionIssue {
  return isRecord(value)
    && typeof value.kind === 'string' && Object.prototype.hasOwnProperty.call(ISSUE_MESSAGES, value.kind)
    && typeof value.message === 'string'
    && isNullableString(value.step) && isNullableString(value.week_start) && isNullableString(value.slug)
    && (value.retry_queued === null || typeof value.retry_queued === 'boolean')
    && isNullableString(value.retry_checked_at);
}

function isRegionResult(value: unknown): value is RegionResult {
  return isRecord(value)
    && DOE_REGIONS.some((region) => region.code === value.region_code)
    && typeof value.status === 'string' && ['processed', 'not_processed', 'no_work'].includes(value.status)
    && typeof value.fetch_status === 'string'
    && ['fetched', 'partial', 'not_fetched', 'unknown', 'not_attempted'].includes(value.fetch_status)
    && isNullableString(value.week_start) && isCount(value.price_rows)
    && (value.companies === null || isCount(value.companies))
    && Array.isArray(value.issues) && value.issues.every(isRegionIssue);
}

function structuredRegions(value: unknown): RegionResult[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.regions)
    || value.regions.length !== DOE_REGIONS.length || !value.regions.every(isRegionResult)) return null;
  // Duplicate regions are not a reliable snapshot; use the conservative legacy fallback.
  if (new Set(value.regions.map((region) => region.region_code)).size !== value.regions.length) return null;
  return value.regions;
}

function queuedSnapshot(issue: RegionIssue): boolean {
  const week = issue.week_start;
  return issue.retry_queued === true && Boolean(issue.slug?.trim())
    && week !== null && /^\d{4}-\d{2}-\d{2}$/.test(week)
    && Number.isFinite(Date.parse(week)) && new Date(week).toISOString().slice(0, 10) === week
    && issue.retry_checked_at !== null && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(issue.retry_checked_at)
    && Number.isFinite(Date.parse(issue.retry_checked_at));
}

function formatRegionalNotices(notices: RegionalNotice[]): string {
  // Deduplicate each regional issue, without promising retries for unconfirmed PDFs.
  const groups = DOE_REGIONS.flatMap((region) => (Object.keys(ISSUE_MESSAGES) as IssueKind[]).flatMap((kind) => {
    const matches = notices.filter((notice) => notice.code === region.code && notice.kind === kind);
    return matches.length ? [{
      name: region.code === 'NCR' ? 'NCR' : region.name,
      kind,
      queued: matches.every((notice) => notice.queued),
    }] : [];
  }));
  const notFetched = groups.filter((group) => group.kind === 'not_fetched');
  const lines: string[] = [];
  if (notFetched.length) {
    let summary = notFetched.length === 1
      ? `${notFetched[0].name}: not fetched.`
      : `Not fetched: ${notFetched.map((group) => group.name).join(', ')}.`;
    const queued = notFetched.filter((group) => group.queued);
    if (queued.length === notFetched.length) summary += ' Queued for PDF retry.';
    lines.push(summary);
    if (queued.length && queued.length < notFetched.length) {
      lines.push(`${queued.map((group) => group.name).join(', ')}: Queued for PDF retry.`);
    }
  }
  for (const group of groups.filter((item) => item.kind !== 'not_fetched')) {
    lines.push(`${group.name}: ${ISSUE_MESSAGES[group.kind]}${group.queued ? ' Queued for PDF retry.' : ''}`);
  }
  return lines.join('\n');
}

export function describeEtlFailure(run: EtlWorkflowRun, pending: PendingRetryEntry[] | null): string {
  const regions = structuredRegions(run.region_results);
  if (regions !== null) {
    const notices: RegionalNotice[] = regions.flatMap((region) => {
      const issues = region.issues.map((issue) => ({
        code: region.region_code, kind: issue.kind, queued: queuedSnapshot(issue),
      }));
      if (region.status !== 'no_work' && region.fetch_status === 'not_fetched'
        && !issues.some((issue) => issue.kind === 'not_fetched')) {
        issues.push({ code: region.region_code, kind: 'not_fetched', queued: false });
      }
      return issues;
    });
    const message = formatRegionalNotices(notices);
    if (isFailedWorkflow(run.status)) {
      const reason = run.failure_reason || '';
      if (/doe_etl_runs|run history.*(?:save|persist)/i.test(reason)
        || /record_etl_run/.test(run.failed_step || '')) {
        return [message, 'Database error: run history could not be saved.'].filter(Boolean).join('\n');
      }
      if (run.failed_step === 'latest DOE fetch state') {
        return [message, 'Database error: update status could not be saved.'].filter(Boolean).join('\n');
      }
      if (run.failed_step === 'load pending queue') {
        return [message, 'The PDF retry queue could not be loaded.'].filter(Boolean).join('\n');
      }
      if (run.status === 'cancelled') return [message, 'The update was cancelled.'].filter(Boolean).join('\n');
      if (run.status === 'timed_out') return [message, 'The update took too long and was stopped.'].filter(Boolean).join('\n');
      if (!message) return 'The update failed. The cause was not recorded.';
    }
    return message;
  }

  const reason = run.failure_reason || '';
  if (!reason && !isFailedWorkflow(run.status)) return '';
  const regionPattern = new RegExp(`\\b(${DOE_REGIONS.map((region) => region.code).join('|')})(?:/([^:\\n]+))?:\\s*`, 'g');
  const matches = [...reason.matchAll(regionPattern)];
  if (!matches.length) {
    if (/schema cache|check constraint|doe_etl_runs|database|run history.*(?:save|persist)/i.test(reason)) {
      return 'Database error: run history could not be saved.';
    }
    if (/^Install/i.test(run.failed_step || '')) return 'Required software could not be installed.';
    if (/^(Checkout|Set up)/i.test(run.failed_step || '')) return 'The workflow could not start.';
    if (run.status === 'cancelled') return 'The update was cancelled.';
    if (run.status === 'timed_out') return 'The update took too long and was stopped.';
    return 'The update failed. The cause was not recorded.';
  }

  return formatRegionalNotices(matches.map((match, index) => {
    const code = match[1] as DoeRegionCode;
    const slug = match[2];
    const detail = reason.slice(match.index! + match[0].length, matches[index + 1]?.index).trim();
    const weeks: string[] = detail.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    let kind: IssueKind;
    if (/stale bulletin|outdated|too old/i.test(detail)) {
      kind = 'outdated';
    } else if (/failed to persist pending|pending-download queue/i.test(detail)) {
      kind = 'error';
    } else if (/missing core fuels|fuel gap/i.test(detail)) {
      kind = 'missing_prices';
    } else if (/upstream unavailable|no bulletin data|no usable bulletin|still unavailable|inaccessible|HTTP(?: Error)?\s*(403|404|410)|download.*fail|fail.*download/i.test(detail)) {
      kind = 'not_fetched';
    } else if (/parse|OCR|Tesseract|text layer/i.test(detail) || run.failed_step === 'PDF parse') {
      kind = 'unreadable';
    } else {
      kind = 'error';
    }

    const endedAt = Date.parse(run.ended_at || run.started_at);
    const queued = (kind === 'not_fetched' || kind === 'unreadable') && Boolean(pending?.some((item) => {
      if (item.region_code !== code || !(Date.parse(item.created_at) <= endedAt)) return false;
      if (slug && item.slug !== slug) return false;
      if (weeks.length && !weeks.includes(item.bulletin_date)) return false;
      // A region alone cannot link an older run to a particular queued PDF.
      return Boolean(slug || weeks.length || (item.slug && detail.includes(item.slug)));
    }));
    return { code, kind, queued };
  }));
}

export const ETL_GITHUB_REPO = 'NotEajay/Gasta';
const API = `https://api.github.com/repos/${ETL_GITHUB_REPO}`;
const WORKFLOW_FILES: Record<EtlWorkflow, string> = {
  weekly: 'doe-etl-weekly.yml',
  'pending-retry': 'doe-etl-pending-retry.yml',
};
const FAILURE_STATUSES = new Set(['failure', 'failed', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);
const failureCache = new Map<string, { reason: string; step: string | null }>();

export function isFailedWorkflow(status: string): boolean {
  return FAILURE_STATUSES.has(status);
}

async function githubJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error('GitHub is temporarily unavailable or rate-limited. Try Refresh later.');
    }
    throw new Error(`Could not load GitHub workflow history (HTTP ${response.status}).`);
  }
  return response.json();
}

function fallbackReason(status: string): string {
  if (status === 'cancelled') return 'The workflow was cancelled on GitHub.';
  if (status === 'timed_out') return 'The workflow exceeded its GitHub Actions time limit.';
  return 'The update failed. The cause was not recorded.';
}

async function githubFailure(run: GitHubRun): Promise<{ reason: string; step: string | null }> {
  const key = `${run.id}:${run.run_attempt || 1}:${run.conclusion}`;
  const cached = failureCache.get(key);
  if (cached) return cached;
  try {
    const { jobs } = await githubJson<{ jobs: GitHubJob[] }>(
      `/actions/runs/${run.id}/attempts/${run.run_attempt || 1}/jobs?per_page=100`
    );
    const job = jobs.find((item) => isFailedWorkflow(item.conclusion || ''));
    const step = job?.steps?.find((item) => isFailedWorkflow(item.conclusion || ''))?.name ?? null;
    let reason = step ? `The GitHub step “${step}” failed.` : fallbackReason(run.conclusion || 'failed');
    if (run.conclusion === 'cancelled' || run.conclusion === 'timed_out') {
      reason = fallbackReason(run.conclusion);
    }
    if (job) {
      try {
        const annotations = await githubJson<{ annotation_level: string; message: string }[]>(
          `/check-runs/${job.id}/annotations?per_page=100`
        );
        const messages = annotations
          .filter((item) => item.annotation_level === 'failure' && item.message?.trim())
          .map((item) => item.message.trim());
        if (messages.length) reason += ` ${[...new Set(messages)].join(' ')}`;
      } catch {
        // Public GitHub access can expose job steps but not check annotations.
      }
    }
    const result = { reason, step };
    if (failureCache.size >= 20) failureCache.delete(failureCache.keys().next().value!);
    failureCache.set(key, result);
    return result;
  } catch {
    return { reason: fallbackReason(run.conclusion || 'failed'), step: null };
  }
}

function savedGitHubRun(run: SavedRun): EtlWorkflowRun {
  return {
    ...run,
    id: `${run.github_run_id}:${run.github_run_attempt}`,
    github_run_id: run.github_run_id!,
    run_number: null,
    run_attempt: run.github_run_attempt,
    branch: null,
    status: run.status === 'partial' ? 'failed' : run.status,
    regions_ok: run.trigger_source === 'github-log-recovery' ? null : run.regions_ok,
    regions_failed: run.trigger_source === 'github-log-recovery' ? null : run.regions_failed,
    regions_skipped: run.trigger_source === 'github-log-recovery' ? null : run.regions_skipped,
    region_results: run.region_results ?? null,
    failure_reason: run.failure_reason || run.error_summary,
  };
}

export async function fetchEtlWorkflowHistory(workflow: EtlWorkflow): Promise<{
  runs: EtlWorkflowRun[];
  warning: string | null;
}> {
  const [githubResult, savedResult] = await Promise.allSettled([
    githubJson<{ workflow_runs: GitHubRun[] }>(`/actions/workflows/${WORKFLOW_FILES[workflow]}/runs?per_page=10`),
    supabase.from('doe_etl_runs').select('*')
      .eq('workflow', workflow)
      .not('github_run_id', 'is', null)
      .order('started_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(10),
  ]);
  const saved = savedResult.status === 'fulfilled' && !savedResult.value.error
    ? (savedResult.value.data ?? []).filter((row) => row.github_run_id && row.workflow === workflow)
    : [];

  if (githubResult.status === 'rejected') {
    const message = githubResult.reason instanceof Error
      ? githubResult.reason.message
      : 'Could not load GitHub workflow history.';
    return {
      runs: saved.slice(0, 10).map(savedGitHubRun),
      warning: saved.length ? `${message} Showing previously saved GitHub runs.` : message,
    };
  }
  const githubRuns = githubResult.value.workflow_runs;
  if (!Array.isArray(githubRuns)) throw new Error('GitHub returned an invalid workflow history response.');
  const details = new Map(saved.map((row) => [`${row.github_run_id}:${row.github_run_attempt || 1}`, row]));
  const runs = await Promise.all(githubRuns
    .slice()
    .sort((a, b) => Date.parse(b.run_started_at || b.created_at) - Date.parse(a.run_started_at || a.created_at))
    .slice(0, 10)
    .map(async (run): Promise<EtlWorkflowRun> => {
      const attempt = run.run_attempt || 1;
      const detail = details.get(`${run.id}:${attempt}`);
      const counts = detail?.trigger_source === 'github-log-recovery' ? null : detail;
      const completed = run.status === 'completed';
      const status = completed
        ? (run.conclusion === 'failure' ? 'failed' : run.conclusion || 'failed')
        : run.status;
      const startedAt = run.run_started_at || run.created_at;
      const elapsed = completed ? (Date.parse(run.updated_at) - Date.parse(startedAt)) / 1000 : null;
      let failureReason: string | null = null;
      let failedStep: string | null = null;
      if (completed && isFailedWorkflow(status)) {
        failureReason = detail?.failure_reason || detail?.error_summary || null;
        failedStep = detail?.failed_step || null;
        if (!failureReason) {
          const failure = await githubFailure(run);
          failureReason = failure.reason;
          failedStep = failedStep || failure.step;
        }
      }
      return {
        id: `${run.id}:${attempt}`,
        workflow,
        github_run_id: String(run.id),
        run_number: run.run_number,
        run_attempt: attempt,
        status,
        branch: run.head_branch,
        trigger_source: run.event,
        started_at: startedAt,
        ended_at: completed ? run.updated_at : null,
        duration_s: elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
        regions_ok: counts?.regions_ok ?? null,
        regions_failed: counts?.regions_failed ?? null,
        regions_skipped: counts?.regions_skipped ?? null,
        region_results: detail?.region_results ?? null,
        failure_reason: failureReason,
        failed_step: failedStep,
      };
    }));
  return { runs, warning: null };
}
