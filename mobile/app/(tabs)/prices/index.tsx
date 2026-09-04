import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import ListRow from '@/components/ui/ListRow';
import LoadingState from '@/components/ui/LoadingState';
import PageHero from '@/components/ui/PageHero';
import PriceCompareRow from '@/components/ui/PriceCompareRow';
import PriceHistoryList from '@/components/ui/PriceHistoryList';
import SectionHeader from '@/components/ui/SectionHeader';
import SegmentedToggle from '@/components/ui/SegmentedToggle';
import SourceBadge from '@/components/ui/SourceBadge';
import StatCard from '@/components/ui/StatCard';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import { palette, spacing } from '@/constants/Theme';
import { formatBulletinWeek, formatCurrency, formatDate, formatLoadedAt, formatShortDate } from '@/lib/format';
import { fetchFreshVerifiedPrices } from '@/lib/services/communityReports';
import {
  bulletinAgeInDays,
  fetchBulletinsForRegion,
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  fetchPriceTrend,
  isBulletinStale,
  type BulletinWeek,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';

type PricesView = 'now' | 'history';

/** One year of DOE weeks — enough for a full seasonal view of the trend. */
const HISTORY_WEEKS = 52;

export default function FuelPricesScreen() {
  const theme = useTheme();
  const [view, setView] = useState<PricesView>('now');
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [trendCompanySlug, setTrendCompanySlug] = useState('petron');
  const [bulletin, setBulletin] = useState<BulletinWeek | null>(null);
  const [pastBulletins, setPastBulletins] = useState<BulletinWeek[]>([]);
  const [selectedPastDate, setSelectedPastDate] = useState<string | null>(null);
  const [prices, setPrices] = useState<FuelPriceRow[]>([]);
  const [pastWeekPrices, setPastWeekPrices] = useState<FuelPriceRow[]>([]);
  const [trend, setTrend] = useState<{ bulletin_date: string; price_per_liter: number }[]>([]);
  const [verifiedCommunity, setVerifiedCommunity] = useState<
    { station_name: string; reported_price: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regionLabel = DOE_REGIONS.find((r) => r.code === region)?.name ?? region;
  const fuelLabel = DOE_FUEL_TYPES.find((f) => f.code === fuelType)?.name ?? fuelType;

  const companyOptions = useMemo(
    () => prices.map((row) => ({ value: row.oil_company.slug, label: row.oil_company.name })),
    [prices]
  );

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [latest, community, weeks] = await Promise.all([
        fetchLatestBulletinForRegion(region),
        fetchFreshVerifiedPrices(region, fuelType).catch(() => []),
        fetchBulletinsForRegion(region, HISTORY_WEEKS).catch(() => []),
      ]);
      setBulletin(latest);
      setPastBulletins(weeks);
      setVerifiedCommunity(
        community.slice(0, 3).map((c) => ({
          station_name: c.station_name,
          reported_price: c.reported_price,
        }))
      );

      if (!latest) {
        setPrices([]);
        setTrend([]);
        setPastWeekPrices([]);
        return;
      }

      const rows = await fetchFuelPricesForBulletin(latest.id, region, fuelType);
      setPrices(rows);

      const slug = rows.some((r) => r.oil_company.slug === trendCompanySlug)
        ? trendCompanySlug
        : (rows[0]?.oil_company.slug ?? 'petron');
      if (slug !== trendCompanySlug) setTrendCompanySlug(slug);

      const points = slug ? await fetchPriceTrend(region, fuelType, slug) : [];
      setTrend(points.slice(-HISTORY_WEEKS));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [region, fuelType, trendCompanySlug]);

  useEffect(() => {
    setLoading(true);
    setSelectedPastDate(null);
    setPastWeekPrices([]);
    load();
  }, [region, fuelType]);

  // Re-read prices whenever the tab regains focus so a bulletin loaded by the weekly
  // ETL shows up without the user having to restart the app. The first focus is
  // already covered by the mount effect above.
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      load();
    }, [load])
  );

  useEffect(() => {
    if (loading || !trendCompanySlug) return;
    void fetchPriceTrend(region, fuelType, trendCompanySlug)
      .then((points) => setTrend(points.slice(-HISTORY_WEEKS)))
      .catch(() => setTrend([]));
  }, [trendCompanySlug, region, fuelType, loading]);

  useEffect(() => {
    if (!selectedPastDate) {
      setPastWeekPrices([]);
      return;
    }
    const selected = pastBulletins.find((b) => b.bulletin_date === selectedPastDate);
    if (!selected) return;
    void fetchFuelPricesForBulletin(selected.id, region, fuelType)
      .then(setPastWeekPrices)
      .catch(() => setPastWeekPrices([]));
  }, [selectedPastDate, pastBulletins, region, fuelType]);

  const lowest = prices[0] ?? null;
  const maxPrice = prices.length ? Math.max(...prices.map((p) => p.price_per_liter)) : 0;
  const minPrice = prices.length ? Math.min(...prices.map((p) => p.price_per_liter)) : 0;

  const historySummary = useMemo(() => {
    if (trend.length < 2) return null;
    const oldest = trend[0];
    const newest = trend[trend.length - 1];
    const delta = newest.price_per_liter - oldest.price_per_liter;
    return { oldest, newest, delta };
  }, [trend]);

  const companyName =
    companyOptions.find((c) => c.value === trendCompanySlug)?.label ?? 'this brand';

  const freshness = useMemo(() => {
    if (!bulletin) return null;
    const ageDays = bulletinAgeInDays(bulletin.bulletin_date);
    const stale = isBulletinStale(bulletin.bulletin_date);
    const loadedLabel = formatLoadedAt(bulletin.last_loaded_at);
    let weekLabel: string;
    if (ageDays < 0) {
      weekLabel = 'Invalid future week — delete this bulletin in Supabase';
    } else if (ageDays === 0) {
      weekLabel = 'DOE week starts today (Tue)';
    } else if (ageDays === 1) {
      weekLabel = 'DOE week started yesterday';
    } else {
      weekLabel = `DOE week of ${formatBulletinWeek(bulletin.bulletin_date)}`;
    }
    return {
      ageDays,
      stale,
      label: loadedLabel ? `${weekLabel} · ${loadedLabel}` : weekLabel,
    };
  }, [bulletin]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (loading) return <LoadingState message="Loading fuel prices…" />;

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={palette.primary}
        />
      }>
      <PageHero
        module="prices"
        title="Fuel Prices"
        subtitle={`${regionLabel} · ${fuelLabel}`}
        navItems={[
          { href: '/(tabs)/prices/community', label: 'Community' },
          { href: '/(tabs)/prices/report', label: 'Report price' },
        ]}
      />

      <SegmentedToggle
        module="prices"
        value={view}
        onChange={setView}
        options={[
          { value: 'now', label: 'This week' },
          { value: 'history', label: 'Past prices' },
        ]}
      />

      <FormSection title="Where and what" subtitle="Change these anytime" module="prices">
        <ChipSelect
          label="Region"
          options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
          value={region}
          onChange={setRegion}
          hideLabel
          module="prices"
        />
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
          value={fuelType}
          onChange={setFuelType}
          hideLabel
          module="prices"
        />
      </FormSection>

      {error ? (
        <Card style={{ borderColor: palette.danger, backgroundColor: palette.dangerSoft }}>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>{error}</Text>
        </Card>
      ) : null}

      {view === 'now' ? (
        <>
          {lowest ? (
            <>
              <StatCard
                variant="primary"
                module="prices"
                label={`Lowest · DOE week of ${bulletin ? formatBulletinWeek(bulletin.bulletin_date) : ''}`}
                value={`${formatCurrency(lowest.price_per_liter)}/L`}
                meta={
                  freshness
                    ? `${lowest.oil_company.name} · ${freshness.label}`
                    : lowest.oil_company.name
                }
              />
              {freshness?.stale ? (
                <Card
                  style={{ borderColor: palette.warning, backgroundColor: palette.warningSoft }}>
                  <Text style={[styles.summaryTitle, { color: theme.text }]}>
                    These prices are {freshness.ageDays} days old
                  </Text>
                  <Text style={[styles.summaryBody, { color: theme.textSecondary }]}>
                    DOE publishes every Tuesday. This is the newest bulletin available for{' '}
                    {regionLabel} — pull down to check for a newer one.
                  </Text>
                </Card>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No prices yet"
              message="No DOE bulletin for this region and fuel. Try another filter or pull to refresh."
            />
          )}

          {prices.length > 0 ? (
            <>
              <SectionHeader
                title="Brands this week"
                subtitle="Lowest price first"
                module="prices"
              />
              <Card elevated compact style={styles.compareCard}>
                {prices.map((row, index) => (
                  <PriceCompareRow
                    key={row.id}
                    rank={index + 1}
                    company={row.oil_company.name}
                    price={row.price_per_liter}
                    maxPrice={maxPrice}
                    minPrice={minPrice}
                    isLowest={index === 0}
                    isLast={index === prices.length - 1}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {verifiedCommunity.length > 0 ? (
            <>
              <SectionHeader
                title="Nearby reports"
                subtitle="Verified by 3 users · last 7 days"
                module="community"
              />
              <Card elevated compact>
                <SourceBadge source="community" />
                {verifiedCommunity.map((item, index) => (
                  <ListRow
                    key={item.station_name}
                    title={item.station_name}
                    value={`${formatCurrency(item.reported_price)}/L`}
                    highlight
                    isLast={index === verifiedCommunity.length - 1}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : (
        <>
          {companyOptions.length > 0 ? (
            <FormSection
              title="Pick a brand"
              subtitle={`Weekly ${fuelLabel} prices for ${companyName}`}
              module="prices">
              <ChipSelect
                label="Company"
                options={companyOptions}
                value={trendCompanySlug}
                onChange={setTrendCompanySlug}
                hideLabel
                module="prices"
              />
            </FormSection>
          ) : null}

          {historySummary ? (
            <Card
              style={{
                backgroundColor:
                  historySummary.delta < 0
                    ? palette.successSoft
                    : historySummary.delta > 0
                      ? palette.dangerSoft
                      : theme.overlay,
                borderColor: theme.border,
              }}>
              <Text style={[styles.summaryTitle, { color: theme.text }]}>
                {historySummary.delta < 0
                  ? `${formatCurrency(Math.abs(historySummary.delta))} cheaper than ${formatShortDate(historySummary.oldest.bulletin_date)}`
                  : historySummary.delta > 0
                    ? `${formatCurrency(historySummary.delta)} higher than ${formatShortDate(historySummary.oldest.bulletin_date)}`
                    : `Unchanged since ${formatShortDate(historySummary.oldest.bulletin_date)}`}
              </Text>
              <Text style={[styles.summaryBody, { color: theme.textSecondary }]}>
                Now {formatCurrency(historySummary.newest.price_per_liter)}/L · then{' '}
                {formatCurrency(historySummary.oldest.price_per_liter)}/L
              </Text>
            </Card>
          ) : null}

          {trend.length > 0 ? (
            <>
              <SectionHeader
                title="Week by week"
                subtitle="Tap a week to see every brand that week"
                module="prices"
              />
              <Card elevated compact>
                <PriceHistoryList
                  points={trend}
                  selectedDate={selectedPastDate ?? undefined}
                  onSelectDate={(date) =>
                    setSelectedPastDate((current) => (current === date ? null : date))
                  }
                />
              </Card>
            </>
          ) : (
            <EmptyState
              title="No past prices yet"
              message="Past weeks appear here after more DOE bulletins are loaded. This week still shows under This week."
            />
          )}

          {selectedPastDate && pastWeekPrices.length > 0 ? (
            <>
              <SectionHeader
                title={`All brands · ${formatDate(selectedPastDate)}`}
                subtitle="Prices from that DOE week"
                module="prices"
              />
              <Card elevated compact style={styles.compareCard}>
                {pastWeekPrices.map((row, index) => (
                  <PriceCompareRow
                    key={row.id}
                    rank={index + 1}
                    company={row.oil_company.name}
                    price={row.price_per_liter}
                    maxPrice={Math.max(...pastWeekPrices.map((p) => p.price_per_liter))}
                    minPrice={Math.min(...pastWeekPrices.map((p) => p.price_per_liter))}
                    isLowest={index === 0}
                    isLast={index === pastWeekPrices.length - 1}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  compareCard: { paddingVertical: spacing.xs },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  summaryBody: {
    fontSize: 14,
    lineHeight: 20,
  },
});
