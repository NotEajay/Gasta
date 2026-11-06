import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, radii, spacing, typeScale } from '@/constants/Theme';
import { buildFuelInsights, monthLabel, type FuelInsight, type InsightMonth } from '@/lib/fuelInsights';
import { formatPeso } from '@/lib/format';
import { fetchFuelInsightHistory } from '@/lib/services/fuelInsights';

type Props = {
  userId: string;
  year: number;
  month: number;
  mode?: 'summary' | 'history';
  compact?: boolean;
  highlight?: boolean;
  refreshKey?: number;
  onViewHistory?: (year: number, month: number) => void;
  onSelectMonth?: (year: number, month: number) => void;
};

const ICONS = {
  spending: 'stats-chart-outline', budget: 'wallet-outline', vehicle: 'car-outline',
} as const;

export default function FuelInsightsPanel({
  userId, year, month, mode = 'summary', compact = false, highlight = false, refreshKey = 0, onViewHistory, onSelectMonth,
}: Props) {
  const ownerKey = `${userId}:${year}:${month}:${mode}:${refreshKey}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; months: InsightMonth[] }>({
    key: '', loading: true, months: [],
  });

  useFocusEffect(useCallback(() => {
    let active = true;
    setState({ key: ownerKey, loading: true, months: [] });
    void fetchFuelInsightHistory(userId, year, month, mode === 'summary' ? 3 : 6)
      .then((months) => { if (active) setState({ key: ownerKey, loading: false, months }); })
      .catch(() => { if (active) setState({ key: ownerKey, loading: false, months: [] }); });
    return () => { active = false; };
  }, [ownerKey, userId, year, month, mode, revision]));

  // Never render a previous account's figures during a user/period change.
  const loading = state.key !== ownerKey || state.loading;
  const months = state.key === ownerKey ? state.months : [];
  const insights = useMemo(() => buildFuelInsights(months), [months]);
  const unavailable = !loading && (months.length === 0 || months.some((entry) => !entry.available || !entry.budgetAvailable));
  const maxSpend = Math.max(1, ...months.filter((entry) => entry.available).map((entry) => entry.actualSpend ?? 0));
  const detailed = mode === 'history';

  function insightRow(item: FuelInsight) {
    const tone = item.tone === 'caution' ? colors.warning : item.tone === 'positive' ? colors.success : colors.primary;
    const content = <>
      <View style={styles.icon}><Ionicons name={ICONS[item.key]} size={20} color={tone} /></View>
      <View style={styles.copy}>
        <Text style={styles.label}>{item.label}</Text>
        <Text style={styles.insightTitle}>{item.title}</Text>
        <Text style={styles.description}>{item.detail}</Text>
        <Text style={styles.period}>{item.period}</Text>
      </View>
      {onViewHistory ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null}
    </>;
    return onViewHistory ? (
      <Pressable key={item.key} accessibilityRole="button"
        accessibilityLabel={`${item.label}: ${item.title}. View history.`}
        onPress={() => onViewHistory(item.year, item.month)}
        style={({ pressed }) => [styles.insight, pressed && styles.pressed]}>{content}</Pressable>
    ) : <View key={item.key} style={styles.insight}>{content}</View>;
  }

  if (compact && !detailed) {
    const candidates = insights.filter((item) => item.key !== 'budget');
    const preview = highlight ? [candidates.find((item) => item.summary) ?? candidates[0]].filter((item): item is FuelInsight => !!item) : candidates;
    const hasHistory = months.some((entry) => entry.available && (entry.refillCount ?? 0) > 0);
    const hasReadableMonth = months.some((entry) => entry.available);
    const comparison = months.filter((entry) => entry.period === 'complete').slice(0, 2)
      .map((entry) => monthLabel(entry.year, entry.month)).join(' / ');
    return (
      <View testID="fuel-insights-summary" style={styles.compactSection}>
        <View style={styles.headingRow}>
          <Text accessibilityRole="header" style={[styles.heading, styles.copy]}>Your fuel insights</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View fuel insight history"
            onPress={() => onViewHistory?.(year, month)} style={styles.textAction}>
            <Text style={styles.link}>View history</Text>
          </Pressable>
        </View>
        {loading ? <View style={styles.compactEmpty}><ActivityIndicator color={colors.primary} />
          <Text style={styles.description}>Loading insights…</Text></View>
          : !hasReadableMonth ? <View style={styles.compactEmpty}>
            <Text style={[styles.description, styles.copy]}>Insights are unavailable right now.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry fuel insights"
              onPress={() => setRevision((value) => value + 1)} style={styles.textAction}><Text style={styles.link}>Retry</Text></Pressable>
          </View> : !hasHistory ? <View style={styles.compactEmpty}>
            <Ionicons name="stats-chart-outline" size={24} color={colors.primary} />
            <View style={styles.copy}><Text style={styles.insightTitle}>Your story starts with a refill</Text>
              <Text style={styles.description}>Log refills to see your spending patterns.</Text></View>
          </View> : <View style={styles.previewGrid}>
            {preview.map((item) => <Pressable key={item.key} accessibilityRole="button"
              accessibilityLabel={`${item.label}: ${item.title}. ${item.detail} ${item.period}. View history.`}
              onPress={() => onViewHistory?.(item.year, item.month)}
              style={({ pressed }) => [styles.previewCard, highlight && styles.highlightCard, pressed && styles.pressed]}>
              <View style={styles.previewTop}>
                <Ionicons name={ICONS[item.key]} size={16} color={item.tone === 'positive' ? colors.success : colors.primary} />
                <Text style={styles.previewLabel}>{item.label}</Text>
              </View>
              <Text style={styles.previewTitle} numberOfLines={2}>{item.title}</Text>
              {item.summary ? <Text style={styles.previewDetail}>{item.summary}</Text> : null}
              <Text style={styles.previewPeriod} numberOfLines={2}>{item.key === 'spending' ? comparison : monthLabel(year, month)}</Text>
            </Pressable>)}
          </View>}
      </View>
    );
  }

  return (
    <View testID={`fuel-insights-${mode}`} style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.heading}>{detailed ? 'Your fuel history' : 'Your fuel insights'}</Text>
          <Text style={styles.description}>{detailed ? 'Six months of recorded refill spending.' : 'A clearer picture of your recorded spending.'}</Text>
        </View>
        {!detailed && onViewHistory ? (
          <Pressable accessibilityRole="button" accessibilityLabel="View fuel insight history"
            onPress={() => onViewHistory(year, month)}
            style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
            <Text style={styles.link}>View history</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loading} accessibilityLabel="Loading fuel insights">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.description}>Loading your fuel history…</Text>
        </View>
      ) : <>
        {unavailable ? (
          <View style={styles.notice}>
            <Text style={[styles.description, styles.copy]}>Some history could not be loaded. Missing figures are shown as unavailable.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry fuel insights"
              onPress={() => setRevision((value) => value + 1)} style={styles.textAction}>
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {insights.length > 0 ? <View style={styles.insights}>{insights.map(insightRow)}</View> : (
          <View style={styles.empty}><Text style={styles.insightTitle}>History unavailable</Text>
            <Text style={styles.description}>Try again to see insights from your recorded refills.</Text></View>
        )}

        {detailed ? <View style={styles.history}>
          <Text accessibilityRole="header" style={styles.heading}>Monthly spending</Text>
          <Text style={styles.description}>Tap a month to open its Budget overview.</Text>
          {[...months].reverse().map((entry) => {
            const label = monthLabel(entry.year, entry.month);
            const known = entry.available && entry.period !== 'future';
            const amount = known ? formatPeso(entry.actualSpend!) : entry.period === 'future' ? 'Future month' : 'Unavailable';
            const count = entry.refillCount ?? 0;
            const budget = entry.budget;
            return (
              <Pressable key={`${entry.year}-${entry.month}`} accessibilityRole="button"
                accessibilityLabel={`View budget for ${label}. ${amount}${entry.period === 'current' ? ', so far' : ''}.`}
                onPress={() => onSelectMonth?.(entry.year, entry.month)}
                style={({ pressed }) => [styles.month, pressed && styles.pressed]}>
                <View style={styles.monthHeading}>
                  <Text style={styles.monthLabel}>{label}{entry.period === 'current' ? ' · so far' : ''}</Text>
                  <Text style={[styles.amount, !known && styles.muted]}>{amount}</Text>
                </View>
                {known ? <>
                  <View style={styles.track} accessibilityRole="progressbar"
                    accessibilityLabel={`${label}: ${formatPeso(entry.actualSpend!)} recorded spending`}
                    accessibilityValue={{ min: 0, max: maxSpend, now: entry.actualSpend! }}>
                    <View style={[styles.bar, { width: `${Math.min(100, entry.actualSpend! / maxSpend * 100)}%`,
                      backgroundColor: entry.period === 'current' ? colors.primary : colors.navy }]} />
                  </View>
                  <Text style={styles.period}>{count === 0 ? 'No refills recorded' : `${count} refill${count === 1 ? '' : 's'} with an accepted share`}
                    {entry.budgetAvailable ? budget ? ` · ${formatPeso(budget.limit_amount)} budget` : ' · No budget set' : ' · Budget unavailable'}</Text>
                </> : null}
              </Pressable>
            );
          })}
        </View> : null}
        <Text style={styles.footnote}>{detailed ? 'Only your accepted shares of non-voided refills count. Months use recorded refill dates (UTC). A month with no recorded refills does not prove no spending occurred.' : 'Based on your accepted refill expenses. Trip cost estimates are separate.'}</Text>
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  compactSection: { marginTop: 0 },
  highlightCard: { minHeight: 0, backgroundColor: colors.navySoft, borderColor: colors.border, padding: 16 },
  previewGrid: { flexDirection: 'row', gap: 10 },
  previewCard: { flex: 1, minWidth: 0, minHeight: 140, padding: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  previewLabel: { flex: 1, fontSize: 11, fontWeight: '600', color: colors.muted },
  previewTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: colors.navy },
  previewDetail: { fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 6 },
  previewPeriod: { fontSize: 10, lineHeight: 15, color: colors.muted, marginTop: 8 },
  compactEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 86, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  section: { marginTop: spacing.lg, marginBottom: spacing.md },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  heading: { ...typeScale.sectionHeading, color: colors.navy },
  description: { ...typeScale.caption, color: colors.muted, lineHeight: 19, marginTop: 4 },
  textAction: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  link: { fontSize: 12, fontWeight: '700', color: colors.primary },
  insights: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, overflow: 'hidden' },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 32, height: 32, backgroundColor: colors.primarySoft, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '600', color: colors.muted },
  insightTitle: { ...typeScale.body, color: colors.navy, fontWeight: '700', marginTop: 4 },
  period: { fontSize: 11, color: colors.muted, lineHeight: 17, marginTop: 6 },
  footnote: { fontSize: 11, color: colors.muted, lineHeight: 17, marginTop: 12 },
  loading: { minHeight: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 12, borderRadius: 12, backgroundColor: colors.navySoft, marginBottom: 12 },
  empty: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  history: { marginTop: spacing.lg },
  month: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: 12 },
  monthHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  monthLabel: { ...typeScale.bodySmall, color: colors.navy, fontWeight: '600' },
  amount: { ...typeScale.bodySmall, color: colors.navy, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted },
  track: { height: 8, backgroundColor: colors.navySoft, borderRadius: radii.pill, overflow: 'hidden', marginTop: 12 },
  bar: { height: '100%', borderRadius: radii.pill },
  pressed: { opacity: 0.7 },
});
