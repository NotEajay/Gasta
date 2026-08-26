import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import ListRow from '@/components/ui/ListRow';
import LoadingState from '@/components/ui/LoadingState';
import MetricTile from '@/components/ui/MetricTile';
import PageHero from '@/components/ui/PageHero';
import PriceCompareRow from '@/components/ui/PriceCompareRow';
import SectionHeader from '@/components/ui/SectionHeader';
import SourceBadge from '@/components/ui/SourceBadge';
import StatCard from '@/components/ui/StatCard';
import TrendBars from '@/components/ui/TrendBars';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import { palette, spacing } from '@/constants/theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { fetchFreshVerifiedPrices } from '@/lib/services/communityReports';
import {
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  fetchPriceTrend,
  fetchRegionBulletinWeeks,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { FuelPriceBulletin } from '@/types';

export default function FuelPricesScreen() {
  const theme = useTheme();
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_95');
  const [trendCompanySlug, setTrendCompanySlug] = useState<string>('petron');
  const [bulletin, setBulletin] = useState<FuelPriceBulletin | null>(null);
  const [prices, setPrices] = useState<FuelPriceRow[]>([]);
  const [trend, setTrend] = useState<{ bulletin_date: string; price_per_liter: number }[]>([]);
  const [regionWeeks, setRegionWeeks] = useState<string[]>([]);
  const [verifiedCommunity, setVerifiedCommunity] = useState<
    { station_name: string; reported_price: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regionLabel = DOE_REGIONS.find((r) => r.code === region)?.name ?? region;
  const fuelLabel = DOE_FUEL_TYPES.find((f) => f.code === fuelType)?.name ?? fuelType;

  const companyOptions = useMemo(
    () =>
      prices.map((row) => ({
        value: row.oil_company.slug,
        label: row.oil_company.name,
      })),
    [prices]
  );

  const loadTrend = useCallback(
    async (slug: string) => {
      try {
        const points = await fetchPriceTrend(region, fuelType, slug);
        setTrend(points);
      } catch {
        setTrend([]);
      }
    },
    [region, fuelType]
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
        fetchRegionBulletinWeeks(region).catch(() => []),
      ]);
      setBulletin(latest);
      setRegionWeeks(weeks);
      setVerifiedCommunity(
        community.slice(0, 3).map((c) => ({
          station_name: c.station_name,
          reported_price: c.reported_price,
        }))
      );

      if (!latest) {
        setPrices([]);
        setTrend([]);
        setRegionWeeks([]);
        return;
      }

      const rows = await fetchFuelPricesForBulletin(latest.id, region, fuelType);
      setPrices(rows);

      const slug = rows.some((r) => r.oil_company.slug === trendCompanySlug)
        ? trendCompanySlug
        : (rows[0]?.oil_company.slug ?? 'petron');
      setTrendCompanySlug(slug);
      if (slug) await loadTrend(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [region, fuelType, trendCompanySlug, loadTrend]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [region, fuelType]);

  useEffect(() => {
    if (!loading && trendCompanySlug) loadTrend(trendCompanySlug);
  }, [trendCompanySlug, loadTrend, loading]);

  const lowest = prices[0] ?? null;
  const highest = prices.length ? prices[prices.length - 1] : null;
  const maxPrice = prices.length ? Math.max(...prices.map((p) => p.price_per_liter)) : 0;
  const minPrice = prices.length ? Math.min(...prices.map((p) => p.price_per_liter)) : 0;
  const spread = maxPrice - minPrice;

  const regionWeekLabel = useMemo(() => {
    if (regionWeeks.length === 0) return null;
    if (regionWeeks.length === 1) {
      return `Latest DOE week for ${regionLabel}: ${formatDate(regionWeeks[0])}`;
    }
    return `${regionWeeks.length} DOE weeks for ${regionLabel}: ${formatDate(regionWeeks[0])} → ${formatDate(regionWeeks[regionWeeks.length - 1])}`;
  }, [regionWeeks, regionLabel]);

  const trendSummary = useMemo(() => {
    if (trend.length < 2) return null;
    const first = trend[0].price_per_liter;
    const last = trend[trend.length - 1].price_per_liter;
    const delta = last - first;
    return {
      delta,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : ('flat' as const),
      fromDate: trend[0].bulletin_date,
      toDate: trend[trend.length - 1].bulletin_date,
    };
  }, [trend]);

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
        subtitle={
          bulletin
            ? `${regionLabel} · ${fuelLabel} · week of ${formatDate(bulletin.bulletin_date)}`
            : `${regionLabel} · ${fuelLabel}`
        }
        navItems={[
          { href: '/(tabs)/prices/community', label: 'Community' },
          { href: '/(tabs)/prices/report', label: 'Report price' },
        ]}
      />

      <FormSection
        title="Filters"
        subtitle={regionWeekLabel ?? 'Region and fuel type'}
        module="prices"
      >
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

      {lowest ? (
        <>
          <StatCard
            variant="primary"
            module="prices"
            label={`Lowest · ${bulletin ? formatDate(bulletin.bulletin_date) : 'this week'}`}
            value={`${formatCurrency(lowest.price_per_liter)}/L`}
            meta={lowest.oil_company.name}
          />
          {spread > 0 && highest ? (
            <View style={styles.quickStats}>
              <MetricTile label="Spread" value={`${formatCurrency(spread)}/L`} tone="success" />
              <MetricTile label="Highest" value={`${formatCurrency(highest.price_per_liter)}/L`} tone="warning" />
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No prices yet"
          message="No DOE bulletin data for this region and fuel type. Try another region or pull to refresh."
        />
      )}

      {verifiedCommunity.length > 0 ? (
        <>
          <SectionHeader
            title="Community prices"
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

      {companyOptions.length > 0 ? (
        <>
          <SectionHeader
            title="Price trend"
            subtitle={
              regionWeeks.length < 2
                ? `1 bulletin week for ${regionLabel}`
                : `${regionWeeks.length} weeks for ${regionLabel}`
            }
            module="prices"
          />
          <Card elevated>
            <ChipSelect
              label="Company"
              options={companyOptions}
              value={trendCompanySlug}
              onChange={setTrendCompanySlug}
              module="prices"
            />
            {trendSummary ? (
              <View
                style={[
                  styles.deltaPill,
                  {
                    backgroundColor:
                      trendSummary.direction === 'up'
                        ? palette.dangerSoft
                        : trendSummary.direction === 'down'
                          ? palette.successSoft
                          : theme.overlay,
                  },
                ]}>
                <Text
                  style={{
                    fontWeight: '700',
                    color:
                      trendSummary.direction === 'up'
                        ? palette.danger
                        : trendSummary.direction === 'down'
                          ? palette.success
                          : theme.textSecondary,
                  }}>
                  {trendSummary.direction === 'up' && '▲ '}
                  {trendSummary.direction === 'down' && '▼ '}
                  {trendSummary.direction === 'flat' && '→ '}
                  {formatCurrency(Math.abs(trendSummary.delta))} change ·{' '}
                  {formatDate(trendSummary.fromDate)} → {formatDate(trendSummary.toDate)}
                </Text>
              </View>
            ) : trend.length === 1 ? (
              <View style={[styles.singleWeekNote, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.singleWeekText, { color: theme.textSecondary }]}>
                  Current bulletin: {formatDate(trend[0].bulletin_date)} ·{' '}
                  {formatCurrency(trend[0].price_per_liter)}/L for this company
                </Text>
              </View>
            ) : null}
            {trend.length >= 2 ? <TrendBars points={trend} /> : null}
          </Card>
        </>
      ) : null}

      {prices.length > 0 ? (
        <>
          <SectionHeader
            title="All companies"
            subtitle={`${prices.length} brands · lowest first`}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  quickStats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  deltaPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    marginBottom: spacing.md,
  },
  singleWeekNote: {
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
  },
  singleWeekText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  compareCard: { paddingVertical: spacing.xs },
});
