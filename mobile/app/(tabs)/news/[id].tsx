import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { FuelNewsBadge } from '@/components/news/FuelNewsCard';
import DetailHeader from '@/components/ui/DetailHeader';
import EmptyState from '@/components/ui/EmptyState';
import { colors, radii, spacing, typeScale } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';
import {
  describeAdjustment,
  effectiveTimeLabel,
  hasUpdatedCoverage,
  manilaTimestampLabel,
  publisherNames,
  safeHttpsUrl,
} from '@/lib/fuelNews';
import { fetchFuelNewsDetail, type FuelNewsEvent } from '@/lib/services/fuelNews';

async function openOriginal(url: string) {
  const safeUrl = safeHttpsUrl(url);
  if (!safeUrl) {
    Alert.alert('Link unavailable', 'This publisher link is not a valid secure HTTPS address.');
    return;
  }
  try {
    const supported = await Linking.canOpenURL(safeUrl);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(safeUrl);
  } catch {
    Alert.alert('Couldn’t open link', 'Please try the publisher link again later.');
  }
}

export default function FuelNewsDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = Array.isArray(id) ? id[0] : id;
  const { contentMaxWidth, horizontalPadding } = useResponsive();
  const [event, setEvent] = useState<FuelNewsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = eventId ? await fetchFuelNewsDetail(eventId) : null;
      if (request === requestRef.current) setEvent(next);
    } catch {
      if (request === requestRef.current) {
        setEvent(null);
        setError('Couldn’t load this fuel news report. Please try again.');
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const lead = event?.articles[0];
  const effective = event ? effectiveTimeLabel(event.effectiveAt, event.effectivePrecision) : null;
  const publishers = event ? publisherNames(event.articles) : [];
  const updated = event ? hasUpdatedCoverage(event.articles) : false;
  const sourceCount = event?.articles.length ?? 0;

  return (
    <ScrollView
      style={styles.flex}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.content,
        {
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
          paddingHorizontal: horizontalPadding,
        },
      ]}>
      <DetailHeader title="Fuel news report" subtitle="Facts and publisher attribution" />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading report…</Text>
        </View>
      ) : error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>Report unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : !event || !lead ? (
        <EmptyState
          icon="newspaper-outline"
          title="Report not found"
          message="This report may no longer be feed-visible. Go back to browse the latest fuel news."
        />
      ) : (
        <>
          <View style={styles.report}>
            <View style={styles.badgeRow}>
              <FuelNewsBadge event={event} />
              {updated || sourceCount > 1 ? (
                <Text style={styles.updated}>
                  {[updated ? 'Updated' : null, sourceCount > 1 ? `${sourceCount} sources` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
            <Text accessibilityRole="header" style={styles.headline}>{lead.headline}</Text>
            {(event.summary || lead.excerpt) ? <Text style={styles.excerpt}>{event.summary || lead.excerpt}</Text> : (
              <Text style={styles.excerptFallback}>No source excerpt was provided.</Text>
            )}
          </View>

          {event.hasDiscrepancy ? (
            <View accessibilityRole="alert" style={styles.warning}>
              <Ionicons name="warning-outline" size={20} color={colors.warning} />
              <View style={styles.warningCopy}>
                <Text style={styles.warningTitle}>Discrepancy found</Text>
                <Text style={styles.body}>
                  The importer found conflicting figures. Do not rely on one amount without checking the original reports.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reported facts</Text>
            {event.adjustments.length > 0 ? (
              <View style={styles.factList}>
                {event.adjustments.map((adjustment) => (
                  <View key={adjustment.fuelType} style={styles.factRow}>
                    <Ionicons
                      name={adjustment.amountCentavos >= 0 ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                      size={20}
                      color={adjustment.amountCentavos >= 0 ? colors.danger : colors.success}
                    />
                    <Text style={styles.factText}>{describeAdjustment(adjustment)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.body}>
                This report has no confidently extracted fuel amounts. Omitted fuels are not treated as zero.
              </Text>
            )}
            <View style={styles.metadata}>
              {effective ? <Text style={styles.meta}>{effective}</Text> : (
                <Text style={styles.meta}>Effective time: not reported</Text>
              )}
              <Text style={styles.meta}>Coverage: {event.coverage || 'Not specified'}</Text>
              <Text style={styles.meta}>Extraction confidence: {event.confidence || 'Not specified'}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {event.articles.length > 1 ? 'Original sources' : 'Original source'}
            </Text>
            <Text style={styles.sourceIntro}>
              Reported by {publishers.join(', ')}. GasTa shows only a short excerpt and extracted facts.
            </Text>
            {event.articles.map((article) => {
              const published = manilaTimestampLabel('Published', article.publishedAt);
              const imported = manilaTimestampLabel('Imported', article.createdAt);
              const checked = manilaTimestampLabel('Last checked', article.fetchedAt);
              return (
                <View key={article.id} style={styles.sourceCard}>
                  <Text style={styles.publisher}>{article.publisher}</Text>
                  <Text style={styles.sourceHeadline}>{article.headline}</Text>
                  {published ? <Text style={styles.meta}>{published}</Text> : null}
                  {imported ? <Text style={styles.meta}>{imported}</Text> : null}
                  {checked ? <Text style={styles.meta}>{checked}</Text> : null}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Read original report from ${article.publisher}`}
                    accessibilityHint="Opens the publisher website"
                    onPress={() => void openOriginal(article.canonicalUrl)}
                    style={({ pressed }) => [styles.originalButton, pressed && styles.pressed]}>
                    <Text style={styles.originalText}>Read original</Text>
                    <Ionicons name="open-outline" size={17} color={colors.onPrimary} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  loading: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  loadingText: { ...typeScale.bodySmall, color: colors.muted, marginTop: spacing.md },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSoft,
  },
  errorCopy: { flex: 1 },
  errorTitle: { ...typeScale.cardTitle, color: colors.danger },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  retryText: { ...typeScale.bodySmall, color: colors.primary, fontWeight: '700' },
  report: {
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  updated: { ...typeScale.caption, color: colors.primaryDark, textAlign: 'right', flexShrink: 1 },
  headline: { ...typeScale.pageTitle, color: colors.navy, lineHeight: 36, marginTop: spacing.md },
  excerpt: { ...typeScale.body, color: colors.muted, lineHeight: 24, marginTop: spacing.md },
  excerptFallback: { ...typeScale.bodySmall, color: colors.muted, fontStyle: 'italic', marginTop: spacing.md },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSoft,
    marginTop: spacing.lg,
  },
  warningCopy: { flex: 1 },
  warningTitle: { ...typeScale.cardTitle, color: colors.warning, marginBottom: 2 },
  section: { marginTop: spacing.xl },
  sectionTitle: { ...typeScale.sectionHeading, color: colors.navy, marginBottom: spacing.md },
  body: { ...typeScale.bodySmall, color: colors.navy, lineHeight: 21 },
  factList: { gap: spacing.sm },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  factText: { ...typeScale.bodySmall, color: colors.navy, flex: 1, fontWeight: '700' },
  metadata: { gap: 4, marginTop: spacing.md },
  meta: { ...typeScale.caption, color: colors.muted, lineHeight: 19 },
  sourceIntro: { ...typeScale.bodySmall, color: colors.muted, lineHeight: 21, marginBottom: spacing.md },
  sourceCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  publisher: { ...typeScale.label, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  sourceHeadline: { ...typeScale.cardTitle, color: colors.navy, lineHeight: 23, marginVertical: spacing.sm },
  originalButton: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  originalText: { ...typeScale.bodySmall, color: colors.onPrimary, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
