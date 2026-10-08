import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Text } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { GasTaColors, GasTaSpacing, radii } from '@/constants/Theme';
import { formatDate } from '@/lib/format';
import { Ionicons } from '@expo/vector-icons';
import LoadingState from '@/components/ui/LoadingState';

type WorkflowRun = {
  id: string | number;
  run_at: string;
  workflow: 'weekly' | 'pending-retry' | string;
  status: 'success' | 'partial' | 'failed' | 'in_progress' | 'queued';
  trigger_source: string;
  github_run_id?: string;
  html_url?: string;
  run_number?: number;
  duration_str?: string;
  regions_ok?: number;
  regions_failed?: number;
  regions_skipped?: number;
  error_summary?: string;
};

const GITHUB_REPO = 'NotEajay/Gasta';

function formatDuration(startStr?: string, endStr?: string): string | undefined {
  if (!startStr || !endStr) return undefined;
  const s = new Date(startStr).getTime();
  const e = new Date(endStr).getTime();
  const diffSec = Math.round((e - s) / 1000);
  if (isNaN(diffSec) || diffSec < 0) return undefined;
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  const rem = diffSec % 60;
  return `${m}m ${rem}s`;
}

function StatusBadge({ status }: { status: string }) {
  const isOk = status === 'success';
  const isWarn = status === 'partial' || status === 'in_progress';
  const bg = isOk ? '#DCFCE7' : isWarn ? '#FEF3C7' : '#FEE2E2';
  const color = isOk ? '#15803D' : isWarn ? '#B45309' : '#DC2626';
  const icon = isOk ? 'checkmark-circle' : isWarn ? 'time-outline' : 'close-circle';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={12} color={color} />
      <Text style={[styles.badgeText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export default function EtlStatusScreen() {
  const [loading, setLoading] = useState(true);
  const [etlState, setEtlState] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setErrorMsg(null);

      try {
        const [etlRes, pendingRes, dbRunsRes, ghRes] = await Promise.all([
          supabase.from('doe_etl_state').select('*').single(),
          supabase.from('doe_pending_downloads').select('*').order('bulletin_date', { ascending: false }),
          (supabase as any).from('doe_etl_runs').select('*').order('run_at', { ascending: false }).limit(20),
          fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=30`).catch(() => null),
        ]);

        if (etlRes.data) setEtlState(etlRes.data);
        if (pendingRes.data) setPending(pendingRes.data);

        let combinedRuns: WorkflowRun[] = [];

        // 1. Process GitHub Actions API runs (real live history)
        if (ghRes && ghRes.ok) {
          const ghJson = await ghRes.json();
          if (ghJson.workflow_runs && Array.isArray(ghJson.workflow_runs)) {
            const ghRuns: WorkflowRun[] = ghJson.workflow_runs.map((r: any) => {
              const isWeekly = r.name?.toLowerCase().includes('weekly');
              const isRetry = r.name?.toLowerCase().includes('pending') || r.name?.toLowerCase().includes('retry');
              const workflow = isWeekly ? 'weekly' : isRetry ? 'pending-retry' : r.name;
              
              let status: WorkflowRun['status'] = 'failed';
              if (r.conclusion === 'success') status = 'success';
              else if (r.status === 'in_progress' || r.status === 'queued') status = 'in_progress';
              else if (r.conclusion === 'failure') status = 'failed';
              else if (r.conclusion) status = r.conclusion;

              return {
                id: r.id,
                run_at: r.run_started_at || r.created_at,
                workflow,
                status,
                trigger_source: r.event === 'schedule' ? 'Schedule (cron)' : r.event === 'workflow_dispatch' ? 'Manual trigger' : r.event,
                github_run_id: String(r.id),
                html_url: r.html_url,
                run_number: r.run_number,
                duration_str: formatDuration(r.run_started_at || r.created_at, r.updated_at),
              };
            });
            combinedRuns = [...ghRuns];
          }
        }

        // 2. If GitHub API is rate-limited or db has runs, merge db runs
        if (dbRunsRes.data && (dbRunsRes.data as any[]).length > 0) {
          const existingIds = new Set(combinedRuns.map(r => r.github_run_id));
          for (const dbRun of (dbRunsRes.data as any[])) {
            if (!dbRun.github_run_id || !existingIds.has(dbRun.github_run_id)) {
              combinedRuns.push({
                id: dbRun.id,
                run_at: dbRun.run_at,
                workflow: dbRun.workflow,
                status: dbRun.status,
                trigger_source: dbRun.trigger_source || 'cli',
                github_run_id: dbRun.github_run_id,
                html_url: dbRun.github_run_id ? `https://github.com/${GITHUB_REPO}/actions/runs/${dbRun.github_run_id}` : undefined,
                duration_str: dbRun.duration_s != null ? `${dbRun.duration_s}s` : undefined,
                regions_ok: dbRun.regions_ok,
                regions_failed: dbRun.regions_failed,
                regions_skipped: dbRun.regions_skipped,
                error_summary: dbRun.error_summary,
              });
            }
          }
        }

        // Sort latest first
        combinedRuns.sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
        setRuns(combinedRuns);

      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load ETL history');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) return <LoadingState message="Loading ETL Status & History..." />;

  const weeklyRuns = runs.filter(r => r.workflow === 'weekly');
  const retryRuns  = runs.filter(r => r.workflow === 'pending-retry');

  const openRun = (url?: string) => {
    if (url) Linking.openURL(url);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>ETL Workflows</Text>

      {errorMsg && (
        <Text style={{ color: GasTaColors.error, marginBottom: 16 }}>Error: {errorMsg}</Text>
      )}

      {/* ── Current state card ─────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="pulse-outline" size={20} color={GasTaColors.forest} />
          <Text style={styles.cardTitle}>Current State</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Last Successful Fetch</Text>
          <Text style={styles.statusValue}>
            {etlState?.last_website_fetch_at ? formatDate(etlState.last_website_fetch_at) : 'Unknown'}
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

        {pending.length > 0 && (
          <View style={styles.pendingList}>
            {pending.map(p => (
              <View key={p.id} style={styles.pendingItem}>
                <Text style={styles.pendingRegion}>{p.region_code} — {p.bulletin_date}</Text>
                {p.last_error && <Text style={styles.pendingError}>{p.last_error}</Text>}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Weekly ETL history ─────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="calendar-outline" size={20} color={GasTaColors.forest} />
          <Text style={styles.cardTitle}>DOE Weekly ETL</Text>
        </View>
        <Text style={styles.cardText}>
          Runs every Tuesday at 19:00 PH (11:00 UTC). Fetches price bulletins for all regions.
        </Text>

        {weeklyRuns.length === 0 ? (
          <Text style={styles.emptyText}>No run history found.</Text>
        ) : (
          weeklyRuns.map(r => (
            <TouchableOpacity
              key={r.id}
              style={styles.runRow}
              onPress={() => openRun(r.html_url)}
              activeOpacity={r.html_url ? 0.6 : 1}
            >
              <View style={styles.runLeft}>
                <StatusBadge status={r.status} />
                <View style={{ flex: 1 }}>
                  <View style={styles.runTitleRow}>
                    <Text style={styles.runDate}>
                      {r.run_number ? `#${r.run_number} · ` : ''}{formatDate(r.run_at)}
                    </Text>
                  </View>
                  <Text style={styles.runMeta}>
                    {r.trigger_source}
                    {r.duration_str ? ` · ${r.duration_str}` : ''}
                    {r.regions_ok !== undefined ? ` · ${r.regions_ok} ok` : ''}
                    {r.regions_failed ? ` · ${r.regions_failed} failed` : ''}
                  </Text>
                  {r.error_summary && <Text style={styles.runError}>{r.error_summary}</Text>}
                </View>
              </View>
              {r.html_url && (
                <Ionicons name="open-outline" size={16} color={GasTaColors.forest} style={{ marginTop: 2 }} />
              )}
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* ── Pending retry history ─────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="refresh-outline" size={20} color={GasTaColors.forest} />
          <Text style={styles.cardTitle}>DOE Pending PDF Retry</Text>
        </View>
        <Text style={styles.cardText}>
          Runs daily at 06:00 PH (22:00 UTC). Retries PDFs unavailable during the weekly run.
        </Text>

        {retryRuns.length === 0 ? (
          <Text style={styles.emptyText}>No retry history found.</Text>
        ) : (
          retryRuns.map(r => (
            <TouchableOpacity
              key={r.id}
              style={styles.runRow}
              onPress={() => openRun(r.html_url)}
              activeOpacity={r.html_url ? 0.6 : 1}
            >
              <View style={styles.runLeft}>
                <StatusBadge status={r.status} />
                <View style={{ flex: 1 }}>
                  <View style={styles.runTitleRow}>
                    <Text style={styles.runDate}>
                      {r.run_number ? `#${r.run_number} · ` : ''}{formatDate(r.run_at)}
                    </Text>
                  </View>
                  <Text style={styles.runMeta}>
                    {r.trigger_source}
                    {r.duration_str ? ` · ${r.duration_str}` : ''}
                    {r.regions_ok !== undefined ? ` · ${r.regions_ok} recovered` : ''}
                    {r.regions_failed ? ` · ${r.regions_failed} errors` : ''}
                  </Text>
                  {r.error_summary && <Text style={styles.runError}>{r.error_summary}</Text>}
                </View>
              </View>
              {r.html_url && (
                <Ionicons name="open-outline" size={16} color={GasTaColors.forest} style={{ marginTop: 2 }} />
              )}
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GasTaColors.creamLight },
  content: { padding: GasTaSpacing.lg },
  headerTitle: { fontSize: 24, fontWeight: '800', color: GasTaColors.forestDark, marginBottom: GasTaSpacing.lg },

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

  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  statusLabel: { fontSize: 14, color: GasTaColors.textPrimary },
  statusValue: { fontSize: 14, fontWeight: '600', color: GasTaColors.forestDark },
  warning: { color: GasTaColors.error },
  ok: { color: GasTaColors.forest },

  pendingList: { marginTop: 10, borderTopWidth: 1, borderTopColor: GasTaColors.forestGlow, paddingTop: 10 },
  pendingItem: { marginBottom: 6 },
  pendingRegion: { fontSize: 13, fontWeight: '700', color: GasTaColors.textPrimary },
  pendingError: { fontSize: 11, color: GasTaColors.error, marginTop: 2 },

  emptyText: { fontSize: 13, color: GasTaColors.textSoft, fontStyle: 'italic' },

  // Run history row
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: GasTaColors.forestGlow,
    gap: 8,
  },
  runLeft: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  runTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  runDate: { fontSize: 13, fontWeight: '700', color: GasTaColors.textPrimary },
  runMeta: { fontSize: 12, color: GasTaColors.textSoft, marginTop: 2 },
  runError: { fontSize: 11, color: GasTaColors.error, marginTop: 3, flexShrink: 1 },

  // Status badge
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
