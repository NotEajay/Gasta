import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import LoadingState from '@/components/ui/LoadingState';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  fetchFuelPricesForBulletin,
  fetchLatestBulletin,
  fetchPriceTrend,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { FuelPriceBulletin } from '@/types';

export default function FuelPricesScreen() {
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_95');
  const [bulletin, setBulletin] = useState<FuelPriceBulletin | null>(null);
  const [prices, setPrices] = useState<FuelPriceRow[]>([]);
  const [trend, setTrend] = useState<{ bulletin_date: string; price_per_liter: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const latest = await fetchLatestBulletin();
      setBulletin(latest);
      if (!latest) {
        setPrices([]);
        setTrend([]);
        return;
      }
      const rows = await fetchFuelPricesForBulletin(latest.id, region, fuelType);
      setPrices(rows);
      if (rows[0]) {
        const trendRows = await fetchPriceTrend(region, fuelType, rows[0].oil_company.slug);
        setTrend(trendRows);
      } else {
        setTrend([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [region, fuelType]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const lowest = prices[0] ?? null;

  const trendSummary = useMemo(() => {
    if (trend.length < 2) return null;
    const first = trend[0].price_per_liter;
    const last = trend[trend.length - 1].price_per_liter;
    const delta = last - first;
    return { delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' as const };
  }, [trend]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
        <View style={styles.padding}>
          <Text>Configure Supabase to load DOE bulletin prices.</Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return <LoadingState message="Loading fuel prices…" />;
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.padding}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <Text style={styles.heading}>Fuel Price Monitoring</Text>
      {bulletin && (
        <Text style={styles.subheading}>
          Latest bulletin: {formatDate(bulletin.bulletin_date)}
        </Text>
      )}

      <ChipSelect
        label="Region"
        options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
        value={region}
        onChange={setRegion}
      />
      <ChipSelect
        label="Fuel type"
        options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
        value={fuelType}
        onChange={setFuelType}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {lowest ? (
        <Card style={styles.highlight}>
          <Text style={styles.highlightLabel}>Lowest price in {region.replace('_', ' ')}</Text>
          <Text style={styles.highlightPrice}>{formatCurrency(lowest.price_per_liter)}/L</Text>
          <Text style={styles.highlightMeta}>{lowest.oil_company.name}</Text>
        </Card>
      ) : (
        <Card>
          <Text>No prices found. Run supabase db reset to load dev seed data.</Text>
        </Card>
      )}

      {trendSummary && (
        <Card>
          <Text style={styles.sectionTitle}>Price trend ({lowest?.oil_company.name})</Text>
          <Text>
            {trendSummary.direction === 'up' && '▲'}
            {trendSummary.direction === 'down' && '▼'}
            {trendSummary.direction === 'flat' && '→'}{' '}
            {formatCurrency(Math.abs(trendSummary.delta))} since {formatDate(trend[0].bulletin_date)}
          </Text>
          {trend.map((point) => (
            <Text key={point.bulletin_date} style={styles.trendRow}>
              {formatDate(point.bulletin_date)} — {formatCurrency(point.price_per_liter)}/L
            </Text>
          ))}
        </Card>
      )}

      <Text style={styles.sectionTitle}>Company comparison</Text>
      {prices.map((row, index) => (
        <Card key={row.id}>
          <View style={styles.row}>
            <View>
              <Text style={styles.company}>{row.oil_company.name}</Text>
              {index === 0 && <Text style={styles.badge}>Lowest</Text>}
            </View>
            <Text style={styles.price}>{formatCurrency(row.price_per_liter)}/L</Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subheading: { opacity: 0.7, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  highlight: { backgroundColor: '#e8f4fd' },
  highlightLabel: { fontSize: 13, opacity: 0.8 },
  highlightPrice: { fontSize: 28, fontWeight: 'bold', marginVertical: 4 },
  highlightMeta: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  company: { fontSize: 16, fontWeight: '600' },
  price: { fontSize: 16, fontWeight: '700' },
  badge: { color: '#1a7f37', fontSize: 12, fontWeight: '600', marginTop: 2 },
  trendRow: { marginTop: 4, opacity: 0.85 },
  error: { color: '#c0392b', marginBottom: 12 },
});
