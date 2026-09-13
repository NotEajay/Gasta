import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import PageHero from '@/components/ui/PageHero';
import PriceCompareRow from '@/components/ui/PriceCompareRow';
import PriceHistoryList from '@/components/ui/PriceHistoryList';
import SectionHeader from '@/components/ui/SectionHeader';
import SegmentedToggle from '@/components/ui/SegmentedToggle';
import SelectField from '@/components/ui/SelectField';
import StationPriceTable, { type StationPriceRow } from '@/components/ui/StationPriceTable';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import {
  DOE_REGIONS,
  REGION_FALLBACK_CITIES,
  type DoeRegionCode,
} from '@/constants/regions';
import { GasTaColors, palette, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import {
  formatBulletinWeek,
  formatCurrency,
  formatDate,
  formatLoadedAt,
  formatShortDate,
} from '@/lib/format';
import {
  confirmCommunityReport,
  fetchConfirmedReportIds,
  fetchFreshVerifiedPrices,
  fetchFuelStationsByRegion,
  fetchPendingReports,
  usersConfirmedLabel,
  type FuelStationOption,
  type PendingCommunityReport,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import {
  bulletinAgeInDays,
  fetchBulletinsForRegion,
  fetchBulletinAreas,
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  fetchPriceTrend,
  isBulletinStale,
  type BulletinWeek,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';

function matchesCityFilter(station: FuelStationOption, city: string): boolean {
  if (!city) return true;
  const needle = city.toLowerCase().replace(/\s+city$/i, '').trim();
  const hay = `${station.name} ${station.address ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

function buildStationPriceRows(
  stations: FuelStationOption[],
  verified: VerifiedCommunityPrice[],
  pending: PendingCommunityReport[],
  doePrices: FuelPriceRow[],
  city: string,
  fuelCode: string
): StationPriceRow[] {
  const doeBySlug = new Map(doePrices.map((row) => [row.oil_company.slug, row.price_per_liter]));
  const verifiedByStation = new Map(verified.map((row) => [row.station_id, row] as const));
  const pendingByName = new Map<string, PendingCommunityReport>();
  for (const report of pending) {
    if (report.fuel_type?.code && report.fuel_type.code !== fuelCode) continue;
    const name = report.station?.name;
    if (name && !pendingByName.has(name)) pendingByName.set(name, report);
  }

  return stations
    .filter((station) => matchesCityFilter(station, city))
    .map((station) => {
      const brand = station.brand_label?.trim() || station.oil_company.name;
      const verifiedRow = verifiedByStation.get(station.id);
      const pendingRow = pendingByName.get(station.name);
      const doePrice = doeBySlug.get(station.oil_company.slug) ?? null;

      if (verifiedRow) {
        return {
          id: station.id,
          brand,
          station: station.name,
          price: verifiedRow.reported_price,
          source: 'community' as const,
          status: 'Verified',
        };
      }
      if (pendingRow) {
        return {
          id: station.id,
          brand,
          station: station.name,
          price: pendingRow.reported_price,
          source: 'community' as const,
          status: 'Unverified',
        };
      }
      return {
        id: station.id,
        brand,
        station: station.name,
        price: doePrice,
        source: doePrice != null ? ('doe' as const) : ('none' as const),
        status: doePrice != null ? 'DOE estimate' : undefined,
      };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.station.localeCompare(b.station));
}

type PricesView = 'now' | 'history';

const HISTORY_WEEKS = 52;

export default function FuelPricesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const [view, setView] = useState<PricesView>('now');
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [areaName, setAreaName] = useState('');
  const [doeAreas, setDoeAreas] = useState<string[]>([]);
  const [areasFromDoe, setAreasFromDoe] = useState(false);
  const [trendCompanySlug, setTrendCompanySlug] = useState('petron');
  const [bulletin, setBulletin] = useState<BulletinWeek | null>(null);
  const [pastBulletins, setPastBulletins] = useState<BulletinWeek[]>([]);
  const [selectedPastDate, setSelectedPastDate] = useState<string | null>(null);
  const [prices, setPrices] = useState<FuelPriceRow[]>([]);
  const [pastWeekPrices, setPastWeekPrices] = useState<FuelPriceRow[]>([]);
  const [trend, setTrend] = useState<{ bulletin_date: string; price_per_liter: number }[]>([]);
  const [verifiedCommunity, setVerifiedCommunity] = useState<VerifiedCommunityPrice[]>([]);
  const [pendingCommunity, setPendingCommunity] = useState<PendingCommunityReport[]>([]);
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyLoadedFor = useRef<string | null>(null);

  const regionLabel = DOE_REGIONS.find((r) => r.code === region)?.name ?? region;
  const fuelLabel = DOE_FUEL_TYPES.find((f) => f.code === fuelType)?.name ?? fuelType;
  const areaLabel = areaName || 'All cities';

  const areas = useMemo(() => {
    if (doeAreas.length > 0) return doeAreas;
    return [...(REGION_FALLBACK_CITIES[region] ?? [])];
  }, [doeAreas, region]);

  const regionOptions = useMemo(
    () => DOE_REGIONS.map((r) => ({ value: r.code, label: r.name })),
    []
  );
  const fuelOptions = useMemo(
    () => DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name })),
    []
  );
  const areaOptions = useMemo(
    () => [
      { value: '', label: 'All cities' },
      ...areas.map((name) => ({ value: name, label: name })),
    ],
    [areas]
  );

  const companyOptions = useMemo(
    () => prices.map((row) => ({ value: row.oil_company.slug, label: row.oil_company.name })),
    [prices]
  );

  /** Region-scoped data only — skips 52-week history and area/fuel price refetch. */
  const loadRegion = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setError(null);
      const [latest, pending, regionStations] = await Promise.all([
        fetchLatestBulletinForRegion(region),
        fetchPendingReports(50, { regionCode: region }).catch((e) => {
          console.warn('Pending community reports failed', e);
          return [];
        }),
        fetchFuelStationsByRegion(region).catch((e) => {
          console.warn('Fuel stations failed', e);
          return [];
        }),
      ]);

      setBulletin(latest);
      setPendingCommunity(pending);
      setStations(regionStations);
      historyLoadedFor.current = null;

      if (user && pending.length > 0) {
        const voted = await fetchConfirmedReportIds(
          user.id,
          pending.map((row) => row.id)
        ).catch(() => new Set<string>());
        setConfirmedIds(voted);
      } else {
        setConfirmedIds(new Set());
      }

      if (!latest) {
        setDoeAreas([]);
        setAreasFromDoe(false);
        setPrices([]);
        return;
      }

      const cityAreas = await fetchBulletinAreas(latest.id, region).catch((): string[] => []);
      setDoeAreas(cityAreas);
      setAreasFromDoe(cityAreas.length > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [region, user]);

  useEffect(() => {
    setSelectedPastDate(null);
    setPastWeekPrices([]);
    setAreaName('');
    setPastBulletins([]);
    setTrend([]);
    setLoading(true);
    void loadRegion();
  }, [loadRegion]);

  // Fuel / city change: only prices + verified community (fast path).
  useEffect(() => {
    if (!isSupabaseConfigured || loading) return;

    let cancelled = false;
    setPricesLoading(true);

    const run = async () => {
      try {
        const communityPromise = fetchFreshVerifiedPrices(region, fuelType).catch((e) => {
          console.warn('Verified community prices failed', e);
          return [] as VerifiedCommunityPrice[];
        });

        if (!bulletin) {
          const community = await communityPromise;
          if (cancelled) return;
          setVerifiedCommunity(community);
          setPrices([]);
          return;
        }

        // Prefer DOE city prices when that area exists in the bulletin; otherwise
        // fetchFuelPricesForBulletin falls back to region-wide mins.
        const areaForDoe = areasFromDoe && areaName ? areaName : '';
        const [rows, community] = await Promise.all([
          fetchFuelPricesForBulletin(bulletin.id, region, fuelType, areaForDoe),
          communityPromise,
        ]);
        if (cancelled) return;
        setPrices(rows);
        setVerifiedCommunity(community);

        setTrendCompanySlug((current) =>
          rows.some((r) => r.oil_company.slug === current)
            ? current
            : (rows[0]?.oil_company.slug ?? 'petron')
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load prices');
        }
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bulletin, region, fuelType, areaName, areasFromDoe, loading]);

  // History tab: load 52 weeks only when opened (not on every This week visit).
  useEffect(() => {
    if (view !== 'history' || !bulletin || loading) return;
    const key = `${region}:${fuelType}:${trendCompanySlug}`;
    if (historyLoadedFor.current === key) return;

    let cancelled = false;
    void Promise.all([
      fetchBulletinsForRegion(region, HISTORY_WEEKS).catch(() => []),
      fetchPriceTrend(region, fuelType, trendCompanySlug).catch(() => []),
    ]).then(([weeks, points]) => {
      if (cancelled) return;
      setPastBulletins(weeks);
      setTrend(points.slice(-HISTORY_WEEKS));
      historyLoadedFor.current = key;
    });

    return () => {
      cancelled = true;
    };
  }, [view, bulletin, region, fuelType, trendCompanySlug, loading]);

  useEffect(() => {
    if (view !== 'history' || !trendCompanySlug || loading) return;
    void fetchPriceTrend(region, fuelType, trendCompanySlug)
      .then((points) => setTrend(points.slice(-HISTORY_WEEKS)))
      .catch(() => setTrend([]));
  }, [trendCompanySlug, region, fuelType, view, loading]);

  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      setLoading(true);
      setVerifiedCommunity([]);
      setPendingCommunity([]);
      setStations([]);
      setConfirmedIds(new Set());
      void loadRegion();
    }, [loadRegion])
  );

  const stationRows = useMemo(
    () =>
      buildStationPriceRows(
        stations,
        verifiedCommunity,
        pendingCommunity,
        prices,
        areaName,
        fuelType
      ),
    [stations, verifiedCommunity, pendingCommunity, prices, areaName, fuelType]
  );

  const pendingForFuel = useMemo(
    () =>
      pendingCommunity.filter(
        (report) => !report.fuel_type?.code || report.fuel_type.code === fuelType
      ),
    [pendingCommunity, fuelType]
  );

  const handleConfirmPrice = async (report: PendingCommunityReport) => {
    if (!user) {
      router.push('/login');
      return;
    }
    setConfirmingId(report.id);
    try {
      await confirmCommunityReport(report.id);
      Alert.alert(
        'Confirmed',
        report.confirmation_count + 1 >= VERIFY_CONFIRMATIONS_REQUIRED
          ? 'Report is now verified for display.'
          : `${report.confirmation_count + 1}/${VERIFY_CONFIRMATIONS_REQUIRED} confirmations`
      );
      await loadRegion();
    } catch (e) {
      Alert.alert('Could not confirm', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConfirmingId(null);
    }
  };

  useEffect(() => {
    if (!selectedPastDate || !fuelType) {
      setPastWeekPrices([]);
      return;
    }
    const selected = pastBulletins.find((b) => b.bulletin_date === selectedPastDate);
    if (!selected) return;
    const areaForDoe = areasFromDoe && areaName ? areaName : '';
    void fetchFuelPricesForBulletin(selected.id, region, fuelType, areaForDoe)
      .then(setPastWeekPrices)
      .catch(() => setPastWeekPrices([]));
  }, [selectedPastDate, pastBulletins, region, fuelType, areaName, areasFromDoe]);

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

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadRegion();
          }}
          tintColor={palette.primary}
        />
      }>
      <PageHero
        module="prices"
        title="Fuel Prices"
        subtitle={
          bulletin
            ? `${regionLabel} · ${fuelLabel} · ${areaLabel}\nLatest available DOE bulletin: ${formatBulletinWeek(bulletin.bulletin_date)}`
            : `${regionLabel} · ${fuelLabel}`
        }
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

      <FormSection
        title="Find prices"
        subtitle="Tap each field to choose region, city, and fuel"
        module="prices">
        <SelectField label="Region" value={region} options={regionOptions} onChange={setRegion} />
        <SelectField
          label="City / area"
          value={areaName}
          options={areaOptions}
          onChange={setAreaName}
          placeholder="All cities"
        />
        <SelectField
          label="Fuel type"
          value={fuelType}
          options={fuelOptions}
          onChange={setFuelType}
        />
        {!areasFromDoe && areas.length > 0 ? (
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            Cities listed for browsing stations. DOE has no per-city prices for this region this
            week — station prices use community reports or region brand estimates.
          </Text>
        ) : null}
      </FormSection>

      {error ? (
        <Card style={{ borderColor: palette.danger, backgroundColor: palette.dangerSoft }}>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>{error}</Text>
        </Card>
      ) : null}

      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={[styles.summaryBody, { color: theme.textSecondary, marginTop: spacing.md }]}>
            Loading fuel prices…
          </Text>
        </View>
      ) : view === 'now' ? (
        <>
          {freshness?.stale ? (
            <Card style={{ borderColor: palette.warning, backgroundColor: palette.warningSoft }}>
              <Text style={[styles.summaryTitle, { color: theme.text }]}>
                These prices are {freshness.ageDays} days old
              </Text>
              <Text style={[styles.summaryBody, { color: theme.textSecondary }]}>
                DOE publishes every Tuesday. This is the newest bulletin available for {regionLabel}{' '}
                — pull down to check for a newer one.
              </Text>
            </Card>
          ) : null}

          <SectionHeader
            title="Stations & prices"
            subtitle={
              areaName
                ? `${fuelLabel} at stations in ${areaName}`
                : `${fuelLabel} stations in ${regionLabel}`
            }
            module="prices"
          />
          <Card elevated>
            {pricesLoading ? (
              <View style={styles.softLoading}>
                <ActivityIndicator color={palette.primary} />
              </View>
            ) : null}
            <StationPriceTable rows={stationRows} />
            <Pressable
              onPress={() => router.push('/(tabs)/prices/report')}
              style={({ pressed }) => [styles.reportBtn, pressed && styles.reportBtnPressed]}>
              <Text style={styles.reportBtnText}>Report a station price</Text>
            </Pressable>
          </Card>

          {pendingForFuel.length > 0 ? (
            <>
              <SectionHeader
                title="Help verify"
                subtitle={`Confirm a station price (${VERIFY_CONFIRMATIONS_REQUIRED} needed)`}
                module="community"
              />
              <Card elevated>
                {pendingForFuel.map((report, index) => {
                  const isOwn = Boolean(user && report.reported_by === user.id);
                  const alreadyVoted = confirmedIds.has(report.id);
                  const isLast = index === pendingForFuel.length - 1;
                  const stationTitle = report.station?.name ?? 'Station';
                  const fuelPart = report.fuel_type?.name ?? 'Fuel';
                  return (
                    <View
                      key={report.id}
                      style={[
                        styles.pendingRow,
                        !isLast && {
                          borderBottomColor: theme.borderLight,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}>
                      <View style={styles.verifyRow}>
                        <View style={styles.verifyText}>
                          <Text
                            style={[styles.verifyTitle, { color: theme.text }]}
                            numberOfLines={2}>
                            {stationTitle}
                          </Text>
                          <Text style={[styles.voteHint, { color: theme.textSecondary }]}>
                            {formatCurrency(report.reported_price)}/L · {fuelPart} ·{' '}
                            {usersConfirmedLabel(report.confirmation_count)}
                          </Text>
                        </View>
                      </View>
                      {isOwn ? (
                        <Text style={[styles.voteHint, { color: theme.textSecondary }]}>
                          You reported this · {report.confirmation_count}/
                          {VERIFY_CONFIRMATIONS_REQUIRED} needed
                        </Text>
                      ) : alreadyVoted ? (
                        <Text style={[styles.voteHint, { color: theme.textSecondary }]}>
                          You confirmed this · {usersConfirmedLabel(report.confirmation_count)}
                        </Text>
                      ) : (
                        <Pressable
                          onPress={() => handleConfirmPrice(report)}
                          disabled={confirmingId === report.id}
                          style={({ pressed }) => [
                            styles.voteBtn,
                            pressed && styles.reportBtnPressed,
                            confirmingId === report.id && { opacity: 0.5 },
                          ]}>
                          <Text style={styles.voteBtnText}>
                            {confirmingId === report.id ? 'Confirming…' : 'Price is accurate'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
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
              <SelectField
                label="Brand"
                value={trendCompanySlug}
                options={companyOptions}
                onChange={setTrendCompanySlug}
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
  inlineLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  softLoading: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  pendingRow: {
    paddingBottom: spacing.sm,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  verifyText: { flex: 1 },
  verifyTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  voteHint: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  voteBtn: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: GasTaColors.forest,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  voteBtnText: {
    color: GasTaColors.textOnForest,
    fontSize: 13,
    fontWeight: '700',
  },
  reportBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    marginTop: spacing.sm,
  },
  reportBtnPressed: { opacity: 0.88 },
  reportBtnText: {
    color: GasTaColors.forestDark,
    fontSize: 13,
    fontWeight: '700',
  },
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
