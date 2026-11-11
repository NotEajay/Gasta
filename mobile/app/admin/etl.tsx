import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import LoadingState from '@/components/ui/LoadingState';
import { GasTaColors, GasTaSpacing, radii } from '@/constants/Theme';
import { supabase } from '@/lib/supabase';
import { describeEtlFailure, fetchEtlWorkflowHistory, isFailedWorkflow } from '@/lib/services/etlHistory';
import type { EtlWorkflow, EtlWorkflowRun } from '@/lib/services/etlHistory';
import type { Database } from '@/types/database';

type EtlRun = EtlWorkflowRun;
type EtlState = Database['public']['Tables']['doe_etl_state']['Row'];
type PendingDownload = Database['public']['Tables']['doe_pending_downloads']['Row'];
type Workflow = EtlWorkflow;

function loadErrorMessage(error: unknown, history = false): string | null {
  if (!error) return null;
  const message = typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'Please try again.';
  if (history && /column .*does not exist|schema cache|relation .*does not exist/i.test(message)) {
    return 'Run history is unavailable: the ETL history database migration has not been applied.';
  }
  return `${history ? 'Could not load run history' : 'Could not load current state'}: ${message}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${minutes}m ${wholeSeconds % 60}s`;
}

function triggerLabel(trigger: string | null): string {
  if (!trigger) return 'GitHub Actions';
  if (trigger === 'schedule') return 'Scheduled';
  if (trigger === 'workflow_dispatch') return 'Manual trigger';
  if (trigger === 'github-actions' || trigger === 'pending-retry' || trigger === 'github-log-recovery') return 'GitHub Actions';
  return trigger;
}

function StatusBadge({ status }: { status: EtlRun['status'] }) {
  const isOk = status === 'success';
  const isFailed = isFailedWorkflow(status);
  const isRunning = ['in_progress', 'queued', 'waiting', 'requested', 'pending'].includes(status);
  const backgroundColor = isOk ? '#DCFCE7' : isRunning ? '#FEF3C7' : isFailed ? '#FEE2E2' : '#F3F4F6';
  const color = isOk ? '#15803D' : isRunning ? '#B45309' : isFailed ? '#DC2626' : '#4B5563';
  const icon = isOk ? 'checkmark-circle' : isRunning ? 'time-outline' : isFailed ? 'close-circle' : 'remove-circle-outline';

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Ionicons name={icon as any} size={12} color={color} />
      <Text style={[styles.badgeText, { color }]}>{status.replace(/_/g, ' ').toUpperCase()}</Text>
    </View>
  );
}

function runCounts(run: EtlRun, workflow: Workflow): string | null {
  if (run.regions_ok == null || run.regions_failed == null || run.regions_skipped == null) return null;
  if (workflow === 'pending-retry') {
    return `${run.regions_ok} recovered · ${run.regions_failed} errors · ${run.regions_skipped} still pending`;
  }
  return `${run.regions_ok} ok · ${run.regions_failed} failed · ${run.regions_skipped} skipped`;
}

function RunHistory({
  title,
  description,
  icon,
  workflow,
  runs,
  error,
  pending,
}: {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  workflow: Workflow;
  runs: EtlRun[];
  error: string | null;
  pending: PendingDownload[] | null;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={20} color={GasTaColors.forest} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardText}>{description}</Text>
      <Text style={styles.cardText}>Latest 10 GitHub runs · newest first · times shown in your local time</Text>

      {error ? <Text style={styles.loadError}>{error}</Text> : null}
      {runs.length === 0 ? (
        error ? null : <Text style={styles.emptyText}>No GitHub runs found.</Text>
      ) : (
        runs.map((run) => {
          const message = describeEtlFailure(run, pending);
          const failed = isFailedWorkflow(run.status);
          return (
            <View key={run.id} testID={`etl-run-${run.id}`} style={styles.runRow}>
              <View style={styles.runMain}>
                <StatusBadge status={run.status} />
                <View style={styles.runDetails}>
                  {run.run_number != null ? (
                    <Text style={styles.runDate}>
                      {`Run #${run.run_number}${run.run_attempt > 1 ? ` · Attempt ${run.run_attempt}` : ''}`}
                    </Text>
                  ) : null}
                  <Text style={styles.runMeta}>Started {formatTimestamp(run.started_at)}</Text>
                  <Text style={styles.runMeta}>
                    {run.ended_at ? `Ended ${formatTimestamp(run.ended_at)}` : 'Not completed yet'}
                  </Text>
                  <Text style={styles.runMeta}>
                    {triggerLabel(run.trigger_source)}{run.branch ? ` · ${run.branch}` : ''}
                    {run.duration_s != null ? ` · ${formatDuration(run.duration_s)}` : ''}
                  </Text>
                  {runCounts(run, workflow) ? (
                    <Text style={styles.runCounts}>{runCounts(run, workflow)}</Text>
                  ) : null}
                  {message ? (
                    <View testID={`etl-message-${run.id}`} style={[styles.failureBlock, !failed && styles.warningBlock]}>
                      <Text style={[styles.runError, !failed && styles.runWarning]}>{message}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

export default function EtlStatusScreen() {
  const [loading, setLoading] = useState(true);
  const [etlState, setEtlState] = useState<EtlState | null>(null);
  const [pending, setPending] = useState<PendingDownload[]>([]);
  const [pendingAvailable, setPendingAvailable] = useState(false);
  const [weeklyRuns, setWeeklyRuns] = useState<EtlRun[]>([]);
  const [retryRuns, setRetryRuns] = useState<EtlRun[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;

    async function loadData() {
      const [etlResult, pendingResult, weeklyResult, retryResult] = await Promise.allSettled([
        supabase.from('doe_etl_state').select('*').maybeSingle(),
        supabase
          .from('doe_pending_downloads')
          .select('*')
          .order('bulletin_date', { ascending: false }),
        fetchEtlWorkflowHistory('weekly'),
        fetchEtlWorkflowHistory('pending-retry'),
      ]);
      if (!active) return;

      const etlError = etlResult.status === 'fulfilled' ? etlResult.value.error : etlResult.reason;
      const pendingError = pendingResult.status === 'fulfilled' ? pendingResult.value.error : pendingResult.reason;
      setErrorMsg([loadErrorMessage(etlError), loadErrorMessage(pendingError)].filter(Boolean).join('\n') || null);
      if (etlResult.status === 'fulfilled' && !etlResult.value.error) {
        setEtlState(etlResult.value.data);
      }
      setPendingAvailable(pendingResult.status === 'fulfilled' && !pendingResult.value.error);
      if (pendingResult.status === 'fulfilled' && !pendingResult.value.error) {
        setPending(pendingResult.value.data ?? []);
      }
      if (weeklyResult.status === 'fulfilled') {
        setWeeklyRuns(weeklyResult.value.runs);
        setWeeklyError(weeklyResult.value.warning);
      } else {
        setWeeklyError(loadErrorMessage(weeklyResult.reason, true));
      }
      if (retryResult.status === 'fulfilled') {
        setRetryRuns(retryResult.value.runs);
        setRetryError(retryResult.value.warning);
      } else {
        setRetryError(loadErrorMessage(retryResult.reason, true));
      }
      setLoading(false);
      setRefreshing(false);
    }

    loadData();
    return () => {
      active = false;
    };
  }, [refreshKey]));

  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((key) => key + 1);
  };

  if (loading) return <LoadingState message="Loading ETL status and history..." />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.headerTitle}>ETL Workflows</Text>
        <TouchableOpacity onPress={refresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Refresh ETL history">
          <Text style={styles.refreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>

      {errorMsg ? <Text style={styles.loadError}>Error: {errorMsg}</Text> : null}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="pulse-outline" size={20} color={GasTaColors.forest} />
          <Text style={styles.cardTitle}>Current State</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Last Successful Fetch</Text>
          <Text style={styles.statusValue}>
            {etlState?.last_website_fetch_at
              ? formatTimestamp(etlState.last_website_fetch_at)
              : 'Unknown'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Triggered By</Text>
          <Text style={styles.statusValue}>{etlState?.last_trigger || 'N/A'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Pending PDFs</Text>
          <Text style={[styles.statusValue, pending.length > 0 ? styles.warning : styles.ok]}>
            {pending.length}
          </Text>
        </View>

        {pending.length > 0 ? (
          <View style={styles.pendingList}>
            {pending.map((item) => (
              <View key={item.id} style={styles.pendingItem}>
                <Text style={styles.pendingRegion}>
                  {item.region_code} — {item.bulletin_date}
                </Text>
                {item.last_error ? (
                  <Text style={styles.pendingError}>{item.last_error}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <RunHistory
        title="DOE Weekly ETL"
        description="Runs every Tuesday at 19:00 PH (11:00 UTC). Fetches price bulletins for all regions."
        icon="calendar-outline"
        workflow="weekly"
        runs={weeklyRuns}
        error={weeklyError}
        pending={pendingAvailable ? pending : null}
      />

      <RunHistory
        title="DOE Pending PDF Retry"
        description="Runs daily at 06:00 PH (22:00 UTC). Retries PDFs unavailable during the weekly run."
        icon="refresh-outline"
        workflow="pending-retry"
        runs={retryRuns}
        error={retryError}
        pending={pendingAvailable ? pending : null}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GasTaColors.creamLight },
  content: { padding: GasTaSpacing.lg },
  pageHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  refreshText: { fontSize: 14, fontWeight: '600', color: GasTaColors.forest },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.lg,
  },
  loadError: { color: GasTaColors.error, marginBottom: GasTaSpacing.md },
  card: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    padding: GasTaSpacing.md,
    marginBottom: GasTaSpacing.md,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: GasTaColors.textPrimary },
  cardText: { fontSize: 13, color: GasTaColors.textSoft, marginBottom: 12 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 6,
  },
  statusLabel: { fontSize: 14, color: GasTaColors.textPrimary },
  statusValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  warning: { color: GasTaColors.error },
  ok: { color: GasTaColors.forest },
  pendingList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: GasTaColors.forestGlow,
    paddingTop: 10,
  },
  pendingItem: { marginBottom: 6 },
  pendingRegion: { fontSize: 13, fontWeight: '700', color: GasTaColors.textPrimary },
  pendingError: { fontSize: 11, color: GasTaColors.error, marginTop: 2 },
  emptyText: { fontSize: 13, color: GasTaColors.textSoft, fontStyle: 'italic' },
  runRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: GasTaColors.forestGlow,
    gap: 8,
  },
  runMain: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  runDetails: { flex: 1 },
  runDate: { fontSize: 13, fontWeight: '700', color: GasTaColors.textPrimary },
  runMeta: { fontSize: 12, color: GasTaColors.textSoft, marginTop: 2 },
  runCounts: { fontSize: 12, color: GasTaColors.textPrimary, marginTop: 4 },
  failureBlock: {
    marginTop: 6,
    padding: 8,
    borderRadius: radii.sm,
    backgroundColor: '#FEF2F2',
  },
  warningBlock: { backgroundColor: '#FFFBEB' },
  runWarning: { color: '#B45309' },
  runError: { fontSize: 11, color: GasTaColors.error, flexShrink: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
