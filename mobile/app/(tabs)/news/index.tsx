import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import HideWhenBlurred from '@/components/navigation/HideWhenBlurred';
import FuelNewsCard from '@/components/news/FuelNewsCard';
import EmptyState from '@/components/ui/EmptyState';
import ScreenHeader from '@/components/ui/ScreenHeader';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import { colors, radii, spacing, typeScale } from '@/constants/Theme';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { useResponsive } from '@/hooks/useResponsive';
import { sourceFeedIsStale } from '@/lib/fuelNews';
import {
  fetchFuelNewsPage,
  fetchFuelNewsSourceState,
  type FuelNewsEvent,
  type FuelNewsSourceState,
} from '@/lib/services/fuelNews';
import { isSupabaseConfigured } from '@/lib/supabase';

function friendlyError(error: unknown): string {
  const message = typeof (error as { message?: unknown } | null)?.message === 'string'
    ? String((error as { message: string }).message)
    : '';
  if (/fuel_news|schema cache|does not exist|could not find/i.test(message)) {
    return 'Fuel news is not available yet. Please try again after the news feed is enabled.';
  }
  return 'Couldn’t load fuel news. Check your connection and try again.';
}

export default function FuelNewsFeedScreen() {
  const router = useRouter();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const { contentMaxWidth, horizontalPadding } = useResponsive();
  const [items, setItems] = useState<FuelNewsEvent[]>([]);
  const [sourceStates, setSourceStates] = useState<FuelNewsSourceState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const sourceStatesRef = useRef<FuelNewsSourceState[]>([]);
  const requestRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'more' = 'initial') => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    if (mode === 'more' && (loadingMoreRef.current || !hasMoreRef.current)) return;
    const request = ++requestRef.current;
    const page = mode === 'more' ? pageRef.current + 1 : 0;
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'more') {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else setLoading(true);

    try {
      const [result, states] = await Promise.all([
        fetchFuelNewsPage(page),
        mode === 'more'
          ? Promise.resolve(sourceStatesRef.current)
          : fetchFuelNewsSourceState().catch(() => sourceStatesRef.current),
      ]);
      if (request !== requestRef.current) return;
      setItems((current) => mode === 'more'
        ? [...current, ...result.items.filter((next) => current.every((item) => item.id !== next.id))]
        : result.items);
      sourceStatesRef.current = states;
      setSourceStates(states);
      pageRef.current = page;
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
      setError(null);
    } catch (nextError) {
      if (request !== requestRef.current) return;
      setError(friendlyError(nextError));
    } finally {
      if (request === requestRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load('initial');
    return () => { requestRef.current += 1; };
  }, [load]));

  const stale = sourceFeedIsStale(sourceStates);

  if (!isSupabaseConfigured) {
    return <View style={styles.flex}><SupabaseSetupBanner /></View>;
  }

  return (
    <HideWhenBlurred>
      <View style={styles.flex}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          onScroll={tabBarScrollHandler}
          scrollEventThrottle={16}
          onEndReached={() => { if (hasMore) void load('more'); }}
          onEndReachedThreshold={0.35}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={[
            styles.content,
            {
              maxWidth: contentMaxWidth,
              width: '100%',
              alignSelf: 'center',
              paddingHorizontal: horizontalPadding,
            },
            items.length === 0 && styles.emptyContent,
          ]}
          ListHeaderComponent={
            <View>
              <ScreenHeader
                eyebrow="Fuel watch"
                title="Fuel news"
                subtitle="Publisher-reported price movements and updates, with the original sources attached."
              />
              {stale ? (
                <View accessibilityRole="alert" style={styles.staleNotice}>
                  <Ionicons name="cloud-offline-outline" size={19} color={colors.warning} />
                  <View style={styles.noticeCopy}>
                    <Text style={styles.noticeTitle}>News importer may be stale</Text>
                    <Text style={styles.noticeText}>
                      Every source is overdue for a successful refresh. Reports below may not be the latest.
                    </Text>
                  </View>
                </View>
              ) : null}
              {error ? (
                <View accessibilityRole="alert" style={styles.errorNotice}>
                  <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
                  <View style={styles.noticeCopy}>
                    <Text style={styles.errorTitle}>Unable to refresh</Text>
                    <Text style={styles.noticeText}>{error}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading fuel news"
                    onPress={() => void load('refresh')}
                    style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}
              {loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>Loading fuel news…</Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <FuelNewsCard
              event={item}
              onPress={() => router.push({
                pathname: '/(tabs)/news/[id]',
                params: { id: item.id },
              } as never)}
            />
          )}
          ListEmptyComponent={!loading && !error ? (
            <EmptyState
              icon="newspaper-outline"
              title="No fuel news yet"
              message="Publisher reports will appear here after the importer finds a relevant update. Pull down to check again."
            />
          ) : null}
          ListFooterComponent={loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading more…</Text>
            </View>
          ) : hasMore ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void load('more')}
              style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}>
              <Text style={styles.loadMoreText}>Load more reports</Text>
            </Pressable>
          ) : items.length > 0 ? (
            <Text style={styles.endText}>You’re all caught up.</Text>
          ) : null}
        />
      </View>
    </HideWhenBlurred>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  emptyContent: { flexGrow: 1 },
  staleNotice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.sm,
    backgroundColor: colors.warningSoft,
    marginBottom: spacing.md,
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
    marginBottom: spacing.md,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { ...typeScale.cardTitle, color: colors.warning },
  errorTitle: { ...typeScale.cardTitle, color: colors.danger },
  noticeText: { ...typeScale.caption, color: colors.navy, lineHeight: 19, marginTop: 2 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  retryText: { ...typeScale.bodySmall, color: colors.primary, fontWeight: '700' },
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { ...typeScale.caption, color: colors.muted },
  footerLoading: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  loadMore: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  loadMoreText: { ...typeScale.bodySmall, color: colors.primary, fontWeight: '700' },
  endText: { ...typeScale.caption, color: colors.muted, textAlign: 'center', padding: spacing.lg },
  pressed: { opacity: 0.7 },
});
