import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import PriceCompareRow from '@/components/ui/PriceCompareRow';
import PriceHistoryList from '@/components/ui/PriceHistoryList';
import PriceTrendChart from '@/components/ui/PriceTrendChart';
import SelectField from '@/components/ui/SelectField';
import StationPriceTable, {
  type AreaPriceRow,
  type StationPriceRow,
} from '@/components/ui/StationPriceTable';
import { useResponsive } from '@/hooks/useResponsive';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import {
  DOE_REGIONS,
  REGION_FALLBACK_CITIES,
  type DoeRegionCode,
} from '@/constants/regions';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import {
  formatBulletinWeek,
  formatCurrency,
  formatDate,
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
  fetchBulletinsForRegion,
  fetchBulletinAreas,
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  fetchLatestDoeWebsiteFetchAt,
  fetchPriceTrend,
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
): { stationRows: StationPriceRow[]; areaRows: AreaPriceRow[] } {
  const doeBySlug = new Map(doePrices.map((row) => [row.oil_company.slug, row.price_per_liter]));
  const verifiedByStation = new Map(verified.map((row) => [row.station_id, row] as const));
  const pendingByName = new Map<string, PendingCommunityReport>();
  for (const report of pending) {
    if (report.fuel_type?.code && report.fuel_type.code !== fuelCode) continue;
    const name = report.station?.name;
    if (name && !pendingByName.has(name)) pendingByName.set(name, report);
  }

  const stationRows = stations
    .filter((station) => matchesCityFilter(station, city))
    .map((station) => {
      const brand = station.brand_label?.trim() || station.oil_company.name;
      const verifiedRow = verifiedByStation.get(station.id);
      const pendingRow = pendingByName.get(station.name);
      const doePrice = doeBySlug.get(station.oil_company.slug) ?? null;

      if (verifiedRow) {
        return {
          id: station.id,
          slug: station.oil_company.slug,
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
          slug: station.oil_company.slug,
          brand,
          station: station.name,
          price: pendingRow.reported_price,
          source: 'community' as const,
          status: 'Unverified',
        };
      }
      return {
        id: station.id,
        slug: station.oil_company.slug,
        brand,
        station: station.name,
        price: doePrice,
        source: doePrice != null ? ('doe' as const) : ('none' as const),
        status: doePrice != null ? 'DOE estimate' : undefined,
      };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.station.localeCompare(b.station));

  const includedStationSlugs = new Set(
    stations
      .filter((station) => matchesCityFilter(station, city))
      .map((station) => station.oil_company.slug)
  );
  const seenAreaSlugs = new Set<string>();
  const areaRows: AreaPriceRow[] = [];

  for (const row of doePrices) {
    const slug = row.oil_company.slug;
    if (includedStationSlugs.has(slug) || seenAreaSlugs.has(slug)) continue;
    seenAreaSlugs.add(slug);

    areaRows.push({
      id: `doe-area-${row.id}`,
      slug,
      brand: row.oil_company.name,
      areaName: row.area_name || 'All cities',
      price: doeBySlug.get(slug) ?? row.price_per_liter,
      source: 'doe_area',
      status: 'DOE area price',
    });
  }

  areaRows.sort((a, b) => a.brand.localeCompare(b.brand));

  return { stationRows, areaRows };
}

type PricesView = 'now' | 'history';

const HISTORY_WEEKS = 52;

/*
 * Centred content column. On phones this never binds (the viewport is narrower
 * than the cap), so the layout is effectively full width. On tablet/web it keeps
 * the list readable instead of letting rows stretch to 1366px.
 */
const SHELL_MAX_WIDTH = 660;

const PRICE_GREEN = GasTaColors.forest;
const PRICE_GREEN_SOFT = GasTaColors.forestGlow;

type PriceFilterOption<T extends string = string> = {
  value: T;
  label: string;
};

type PriceFilterFieldProps<T extends string> = {
  label: string;
  value: T;
  options: readonly PriceFilterOption<T>[];
  onChange: (value: T) => void;
  icon: 'map-marker-outline' | 'office-building-outline' | 'gas-station';
  placeholder?: string;
  /** Optional override for the field container, used by the narrow-phone wrap. */
  style?: StyleProp<ViewStyle>;
};

function PriceFilterField<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = 'Choose…',
  style,
}: PriceFilterFieldProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value)?.label ?? placeholder;
  // Location / place / fuel each get a faint, distinct cast.
  const tint =
    icon === 'map-marker-outline'
      ? styles.filterIconRegion
      : icon === 'office-building-outline'
        ? styles.filterIconCity
        : styles.filterIconFuel;

  return (
    <View style={[styles.filterField, style]}>
      <View style={styles.filterLabelRow}>
        <View style={[styles.filterIcon, tint]}>
          <MaterialCommunityIcons name={icon} size={12} color={GasTaColors.forestDark} />
        </View>
        <Text style={styles.filterLabel}>{label}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.filterControl,
          pressed && { backgroundColor: GasTaColors.cream },
        ]}>
        <Text style={styles.filterValue} numberOfLines={1}>
          {selected}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={GasTaColors.textSoft} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.filterBackdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.filterSheet, { backgroundColor: GasTaColors.creamLight }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={styles.filterSheetHeader}>
              <Text style={[styles.filterSheetTitle, { color: theme.text }]}>{label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${label} options`}
                hitSlop={8}
                onPress={() => setOpen(false)}>
                <MaterialCommunityIcons name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>
            <FlatList
              data={[...options]}
              keyExtractor={(item) => item.value}
              style={styles.filterOptionList}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.filterOption,
                      (isSelected || pressed) && { backgroundColor: PRICE_GREEN_SOFT },
                    ]}>
                    <Text
                      style={[
                        styles.filterOptionText,
                        { color: theme.text, fontWeight: isSelected ? '800' : '500' },
                      ]}>
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <MaterialCommunityIcons name="check-circle" size={19} color={PRICE_GREEN} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function FuelPricesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  // Below ~360px three filter columns are too tight to read, so the row wraps
  // to 2+1 there. `isCompact` is width-only, so it is safe to read before any
  // conditional return.
  const { isCompact } = useResponsive();
  const [view, setView] = useState<PricesView>('now');
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [areaName, setAreaName] = useState('');
  const [doeAreas, setDoeAreas] = useState<string[]>([]);
  const [areasFromDoe, setAreasFromDoe] = useState(false);
  const [trendCompanySlug, setTrendCompanySlug] = useState('petron');
  const [bulletin, setBulletin] = useState<BulletinWeek | null>(null);
  const [doeFetchAt, setDoeFetchAt] = useState<string | null>(null);
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
      const [latest, pending, regionStations, websiteFetchAt] = await Promise.all([
        fetchLatestBulletinForRegion(region),
        fetchPendingReports(50, { regionCode: region }).catch((e) => {
          console.warn('Pending community reports failed', e);
          return [];
        }),
        fetchFuelStationsByRegion(region).catch((e) => {
          console.warn('Fuel stations failed', e);
          return [];
        }),
        fetchLatestDoeWebsiteFetchAt().catch((e) => {
          console.warn('DOE fetch timestamp failed', e);
          return null;
        }),
      ]);

      setBulletin(latest);
      setDoeFetchAt(websiteFetchAt);
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

  const { stationRows, areaRows } = useMemo(
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

  const latestFetchLabel = useMemo(() => {
    const iso = doeFetchAt ?? bulletin?.last_loaded_at;
    if (!iso) return null;
    const loaded = new Date(iso);
    if (Number.isNaN(loaded.getTime())) return null;
    return loaded.toLocaleDateString('en-PH', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [doeFetchAt, bulletin]);

  /*
   * Lowest available price, for the summary card.
   *
   * Derived only from rows already loaded and in memory -- no extra fetch, and
   * no change to the precedence that produced those rows (verified > pending >
   * DOE). Station rows win over area rows, matching what the list already
   * treats as the best entry.
   *
   * `status` is carried through because `source` alone is not enough to describe
   * a community row: `buildStationPriceRows` emits `source: 'community'` for
   * both verified and pending reports, and only `status` tells them apart. The
   * summary must not label a pending price as verified.
   */
  type CheapestRow =
    | {
        price: number;
        brand: string;
        station: string;
        source: 'community' | 'doe' | 'none';
        status?: string;
      }
    | { price: number; brand: string; areaName: string; source: 'doe_area'; status?: string };

  const cheapest = useMemo<CheapestRow | null>(() => {
    /*
     * The hero must consider BOTH pools, not prefer one.
     *
     * `stationRows` only covers brands that appear in the station directory;
     * `areaRows` covers DOE brands that have no station. The previous version
     * returned as soon as any station row had a price, so a region with a
     * station directory silently ignored its area-level rows: Visayas showed
     * 84.10 (Shell, a station) instead of 80.60 (Total, area-level), and North
     * Luzon showed 57.90 (Seaoil, a station) instead of 57.80 (Jetti, area-level).
     * South Luzon looked correct only because it has no stations at all, so the
     * areaRows fallback happened to run.
     *
     * The two pools cannot overlap: `buildStationPriceRows` only emits an
     * areaRow for a DOE brand that has no station in the filtered directory, so
     * taking the minimum across both never double-counts a brand.
     *
     * Source precedence is untouched -- it is already resolved per row inside
     * `buildStationPriceRows` (verified > pending > DOE), and an area-level row
     * carries its own honest label rather than an invented station name.
     *
     * TRUSTED LOWEST: a pending, unconfirmed community report stays visible in
     * the station list, correctly labelled "Unverified", but it must not become
     * the headline. "Current lowest" is the number people act on, so it is held
     * to DOE and verified community data only. This is a hero-selection rule
     * only: it does not reorder, relabel, or remove anything in the list, and it
     * does not touch `buildStationPriceRows` or the precedence the list uses.
     */
    const candidates: CheapestRow[] = [];
    for (const row of stationRows) {
      if (typeof row.price !== 'number' || row.price <= 0) continue;
      if (row.status === 'Unverified') continue;
      candidates.push({
        price: row.price,
        brand: row.brand,
        station: row.station,
        source: row.source,
        status: row.status,
      });
    }
    for (const row of areaRows) {
      if (typeof row.price !== 'number' || row.price <= 0) continue;
      if (row.status === 'Unverified') continue;
      candidates.push({
        price: row.price,
        brand: row.brand,
        areaName: row.areaName,
        source: 'doe_area',
        status: row.status,
      });
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((best, row) => (row.price < best.price ? row : best));
  }, [stationRows, areaRows]);

  /*
   * Price range across every price already in memory.
   *
   * Built purely from `stationRows` / `areaRows` -- the rows the list is already
   * rendering -- so it costs no query and cannot disagree with the list. Only
   * surfaced with at least two valid prices; a single price has no spread.
   */
  const priceRange = useMemo(() => {
    const all: number[] = [];
    for (const row of stationRows) {
      if (typeof row.price === 'number' && row.price > 0) all.push(row.price);
    }
    for (const row of areaRows) {
      if (typeof row.price === 'number' && row.price > 0) all.push(row.price);
    }
    if (all.length < 2) return null;
    const low = Math.min(...all);
    const high = Math.max(...all);
    return { low, high, spread: high - low, count: all.length };
  }, [stationRows, areaRows]);

  /*
   * Change vs the previously loaded DOE bulletin for the same brand/fuel/region.
   *
   * REAL data only: it reads the `trend` series the screen already fetches when
   * Past prices is opened. `trend` is deliberately never cleared on a view
   * switch (only on region change), so once history has been loaded the hero
   * keeps showing a genuine movement figure.
   *
   * On a first visit -- before Past prices has ever been opened -- `trend` is
   * empty, because the "This week" load fetches exactly one bulletin. There is
   * then no previous price in memory, so the hero shows no delta at all rather
   * than inventing one. No extra query is issued to fill that gap.
   */
  const heroMovement = useMemo(() => {
    if (trend.length < 2) return null;
    const prev = trend[trend.length - 2].price_per_liter;
    const last = trend[trend.length - 1].price_per_liter;
    return { delta: last - prev, prevDate: trend[trend.length - 2].bulletin_date };
  }, [trend]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={styles.flex}
      contentContainerStyle={[
        styles.padding,
        // Centred responsive shell. On phones this is transparent and the
        // column simply fills the width; on tablet/web it stops the content
        // from stretching edge to edge.
        { maxWidth: SHELL_MAX_WIDTH, alignSelf: 'center', width: '100%' },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadRegion();
          }}
          tintColor={GasTaColors.forest}
        />
      }>
      {/*
        Compact header. The old PageHero restated "region · fuel · area", which
        the filters directly below already show, and the DOE fetch timestamp is
        source metadata rather than a headline -- so it moves to one quiet line
        under the title instead of being the largest text on the screen.
      */}
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Fuel Prices</Text>
          {latestFetchLabel || bulletin ? (
            <Text numberOfLines={1} style={styles.headerMeta}>
              {[
                latestFetchLabel ? `DOE fetched ${latestFetchLabel}` : null,
                bulletin ? formatBulletinWeek(bulletin.bulletin_date) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Community prices"
          hitSlop={8}
          onPress={() => router.push('/(tabs)/prices/community')}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <Text style={styles.headerActionText}>Community</Text>
        </Pressable>
      </View>

      {/*
        View toggle kept inline rather than via SegmentedToggle: the shared
        control is a full-width block, and Prices wants a short pill on the
        right of the header row. Same two options, same `view` state.
      */}
      <View style={styles.viewToggle} accessibilityRole="tablist">
        {(
          [
            { value: 'now', label: 'This week' },
            { value: 'history', label: 'Past prices' },
          ] as const
        ).map((option) => {
          const active = view === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setView(option.value)}
              style={({ pressed }) => [
                styles.viewToggleItem,
                active && styles.viewToggleItemActive,
                pressed && !active && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.viewToggleText,
                  active && styles.viewToggleTextActive,
                ]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Filters as one compact row. The "Find prices" accent header and the
        wrapping Card are gone -- the fields are self-describing, and they were
        costing more vertical space than the first price. Same values, same
        modals, no behaviour change.
      */}
      <View style={[styles.filterRow, isCompact && styles.filterRowWrap]}>
        <PriceFilterField
          label="Region"
          value={region}
          options={regionOptions}
          onChange={setRegion}
          icon="map-marker-outline"
          style={isCompact ? styles.filterFieldWrap : undefined}
        />
        <PriceFilterField
          label="City"
          value={areaName}
          options={areaOptions}
          onChange={setAreaName}
          icon="office-building-outline"
          placeholder="All cities"
          style={isCompact ? styles.filterFieldWrap : undefined}
        />
        <PriceFilterField
          label="Fuel"
          value={fuelType}
          options={fuelOptions}
          onChange={setFuelType}
          icon="gas-station"
          style={isCompact ? styles.filterFieldWrap : undefined}
        />
      </View>

      {!areasFromDoe && areas.length > 0 ? (
        <Text style={styles.hintText}>
          DOE has no per-city prices for this region this week — station prices use community
          reports or region brand estimates.
        </Text>
      ) : null}

      {/* Bulletin error is preserved and surfaced as before, just flattened so
          it reads as an inline notice instead of another boxed card. */}
      {error ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="large" color={GasTaColors.forest} />
          <Text style={styles.hintText}>Loading fuel prices…</Text>
        </View>
      ) : (
        <>
          {/*
            THE HERO. The single strongest element on the screen, on a forest
            surface, so the page reads as a fuel dashboard rather than a stack of
            white cards. Same minimum the list already highlights -- derived from
            rows in memory, no extra fetch, precedence untouched.
          */}
          {cheapest ? (
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroLabel}>Current lowest</Text>
                {/*
                  Source labelling is driven by the row's `status`, not just its
                  `source`, because a pending community report also carries
                  `source: 'community'`. A pending price must read as
                  "Unverified" -- it must never pick up the verified badge.
                */}
                <View style={styles.heroPill}>
                  <MaterialCommunityIcons
                    name={
                      cheapest.status === 'Unverified'
                        ? 'clock-outline'
                        : cheapest.source === 'community'
                          ? 'shield-check'
                          : 'file-document-outline'
                    }
                    size={11}
                    color={GasTaColors.forestDark}
                  />
                  <Text style={styles.heroPillText}>
                    {cheapest.status === 'Unverified'
                      ? 'Unverified'
                      : cheapest.source === 'community'
                        ? 'Community verified'
                        : 'DOE bulletin'}
                  </Text>
                </View>
              </View>

              <View style={styles.heroPriceRow}>
                <Text style={styles.heroPrice} numberOfLines={1} adjustsFontSizeToFit>
                  {formatCurrency(cheapest.price)}
                </Text>
                <Text style={styles.heroUnit}>/L</Text>
              </View>

              <Text numberOfLines={1} style={styles.heroStation}>
                {cheapest.brand} ·{' '}
                {'station' in cheapest ? cheapest.station || areaLabel : cheapest.areaName}
              </Text>

              {/*
                Real movement only. On a first visit the screen holds exactly one
                bulletin, so there is no previous price to compare against and
                this line is simply absent -- never filled with an assumed value.
              */}
              {heroMovement ? (
                <View style={styles.heroMovement}>
                  <HeroDelta delta={heroMovement.delta} />
                  <Text numberOfLines={1} style={styles.heroMovementNote}>
                    vs {formatShortDate(heroMovement.prevDate)} · {fuelLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/*
            Price range, computed from the very same rows the list renders below.
            Needs at least two valid prices, otherwise there is no spread to
            describe.
          */}
          {priceRange ? (
            <View style={styles.rangeCard}>
              <View style={styles.rangeHead}>
                <Text style={styles.rangeTitle}>Price range</Text>
                <Text style={styles.rangeCount}>{priceRange.count} listed</Text>
              </View>
              <View style={styles.rangeEnds}>
                <View>
                  <Text style={styles.rangeEndLabel}>Lowest</Text>
                  <Text style={styles.rangeEndValue}>{formatCurrency(priceRange.low)}</Text>
                </View>
                <View style={styles.rangeMid}>
                  <Text style={styles.rangeEndLabel}>Spread</Text>
                  <Text style={styles.rangeEndValue}>
                    {formatCurrency(priceRange.spread)}/L
                  </Text>
                </View>
                <View style={styles.rangeEndRight}>
                  <Text style={styles.rangeEndLabel}>Highest</Text>
                  <Text style={styles.rangeEndValue}>{formatCurrency(priceRange.high)}</Text>
                </View>
              </View>
              <View style={styles.rangeBar}>
                <View style={styles.rangeTrack} />
                <View style={[styles.rangeDot, { left: 0 }]} />
                <View style={[styles.rangeDot, { right: 0 }]} />
              </View>
            </View>
          ) : null}

          {/*
            TREND. The This week / Past prices toggle now sits directly above the
            content it controls, so the modes read as one continuous fuel story.
            Behaviour is unchanged -- same `view` state, same two options.
          */}
          <View style={styles.trendHead}>
            <Text style={styles.sectionTitle}>Price trend</Text>
            <View style={styles.viewToggle} accessibilityRole="tablist">
              {(
                [
                  { value: 'now', label: 'This week' },
                  { value: 'history', label: 'Past prices' },
                ] as const
              ).map((option) => {
                const active = view === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setView(option.value)}
                    style={({ pressed }) => [
                      styles.viewToggleItem,
                      active && styles.viewToggleItemActive,
                      pressed && !active && styles.pressed,
                    ]}>
                    <Text
                      style={[styles.viewToggleText, active && styles.viewToggleTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.trendPanel}>
            {view === 'history' && companyOptions.length > 0 ? (
              <View style={styles.trendBrandRow}>
                <SelectField
                  label="Brand"
                  value={trendCompanySlug}
                  options={companyOptions}
                  onChange={setTrendCompanySlug}
                />
              </View>
            ) : null}

            {view === 'history' && historySummary ? (
              <View style={styles.summaryStrip}>
                <Text style={styles.summaryStripText}>
                  {historySummary.delta < 0
                    ? `${formatCurrency(Math.abs(historySummary.delta))} cheaper than ${formatShortDate(historySummary.oldest.bulletin_date)}`
                    : historySummary.delta > 0
                      ? `${formatCurrency(historySummary.delta)} higher than ${formatShortDate(historySummary.oldest.bulletin_date)}`
                      : `Unchanged since ${formatShortDate(historySummary.oldest.bulletin_date)}`}
                </Text>
                <Text style={styles.summaryStripMeta}>
                  {formatCurrency(historySummary.oldest.price_per_liter)} →{' '}
                  {formatCurrency(historySummary.newest.price_per_liter)}/L
                </Text>
              </View>
            ) : null}

            <PriceTrendChart
              points={trend}
              caption={
                view === 'history'
                  ? `${fuelLabel} · ${companyName}`
                  : `${fuelLabel} · ${regionLabel}`
              }
              height={isCompact ? 104 : view === 'history' ? 148 : 126}
            />

            {view === 'history' && trend.length > 0 ? (
              <View style={styles.weekList}>
                <PriceHistoryList
                  points={trend}
                  selectedDate={selectedPastDate ?? undefined}
                  onSelectDate={(date) =>
                    setSelectedPastDate((current) => (current === date ? null : date))
                  }
                />
              </View>
            ) : null}
          </View>

          {selectedPastDate && pastWeekPrices.length > 0 ? (
            <>
              <Text style={styles.sectionTitleTop}>
                All brands · {formatDate(selectedPastDate)}
              </Text>
              <View style={styles.plainListTight}>
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
              </View>
            </>
          ) : null}

          {/* STATIONS & PRICES -- visible in both modes, one continuous story. */}
          <View style={styles.listHead}>
            <Text style={styles.sectionTitle}>Stations & prices</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report a price"
              hitSlop={8}
              onPress={() => router.push('/(tabs)/prices/report')}
              style={({ pressed }) => [styles.reportCta, pressed && styles.pressed]}>
              <MaterialCommunityIcons
                name="plus-circle-outline"
                size={15}
                color={GasTaColors.forest}
              />
              <Text style={styles.reportCtaText}>Report a price</Text>
            </Pressable>
          </View>

          {stationRows.length === 0 && areaRows.length === 0 ? (
            <Text style={styles.emptyLine}>
              No stations for these filters. Try another city or fuel type.
            </Text>
          ) : (
            <StationPriceTable rows={stationRows} areaRows={areaRows} />
          )}

          {pendingForFuel.length > 0 ? (
            <>
              <Text style={styles.sectionTitleTop}>
                Needs confirmation ({pendingForFuel.length})
              </Text>
              <Text style={styles.hintText}>
                Confirm a station price ({VERIFY_CONFIRMATIONS_REQUIRED} needed).
              </Text>
              <View style={styles.confirmList}>
                {pendingForFuel.map((report, index) => {
                  const isOwn = Boolean(user && report.reported_by === user.id);
                  const alreadyVoted = confirmedIds.has(report.id);
                  const isLast = index === pendingForFuel.length - 1;
                  const stationTitle = report.station?.name ?? 'Station';
                  const fuelPart = report.fuel_type?.name ?? 'Fuel';
                  return (
                    <View
                      key={report.id}
                      style={[styles.verifyRow, !isLast && styles.rowDivider]}>
                      <View style={styles.verifyInfo}>
                        <Text numberOfLines={1} style={styles.verifyTitle}>
                          {stationTitle}
                        </Text>
                        <Text numberOfLines={1} style={styles.verifyMeta}>
                          {fuelPart} ·{' '}
                          {isOwn
                            ? `You reported this · ${report.confirmation_count}/${VERIFY_CONFIRMATIONS_REQUIRED}`
                            : alreadyVoted
                              ? `You confirmed this · ${usersConfirmedLabel(report.confirmation_count)}`
                              : `Unverified · ${usersConfirmedLabel(report.confirmation_count)}`}
                        </Text>
                      </View>
                      <Text style={styles.verifyPrice}>
                        {formatCurrency(report.reported_price)}
                        <Text style={styles.verifyUnit}>/L</Text>
                      </Text>
                      {isOwn || alreadyVoted ? null : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm the price at ${stationTitle}`}
                          disabled={confirmingId === report.id}
                          onPress={() => handleConfirmPrice(report)}
                          style={({ pressed }) => [
                            styles.voteBtn,
                            pressed && styles.pressed,
                            confirmingId === report.id && styles.voteBtnBusy,
                          ]}>
                          <Text style={styles.voteBtnText}>
                            {confirmingId === report.id ? 'Confirming…' : 'Price is accurate'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/**
 * Movement indicator for the forest hero.
 *
 * Colour follows the consumer's interest: a falling price is good news and
 * reads green, a rising price reads warm red. The arrow and the peso value are
 * always present, so the meaning never depends on hue alone.
 */
function HeroDelta({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.005) {
    return (
      <View style={styles.heroDeltaFlat}>
        <Text style={styles.heroDeltaFlatText}>No change vs last week</Text>
      </View>
    );
  }
  const down = delta < 0;
  return (
    <View style={[styles.heroDeltaTag, down ? styles.heroDeltaDown : styles.heroDeltaUp]}>
      <Text style={[styles.heroDeltaText, { color: down ? '#7BE3A8' : '#FFB4A2' }]}>
        {down ? '↓' : '↑'} {formatCurrency(Math.abs(delta))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  /* ---- header ---- */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: GasTaColors.textPrimary,
  },
  headerMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  headerAction: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.white,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },

  /* ---- view toggle ---- */
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  viewToggleItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.creamLight,
  },
  viewToggleItemActive: {
    backgroundColor: GasTaColors.forest,
    borderColor: GasTaColors.forestDark,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  viewToggleTextActive: {
    color: GasTaColors.textOnForest,
  },

  /* ---- compact filters ---- */
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  /* Narrow phones: 2+1 instead of three cramped columns. The flex-basis is
     what actually forces the wrap -- `flex: 1` alone would shrink all three
     onto one line and squeeze the labels. */
  filterRowWrap: { flexWrap: 'wrap' },
  filterFieldWrap: { flexBasis: '46%' },
  filterField: { flex: 1, minWidth: 0 },
  filterLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  filterIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Each filter gets a faint, distinct cast so the row reads as
     location / place / fuel rather than three identical dropdowns. */
  filterIconRegion: { backgroundColor: 'rgba(1, 68, 33, 0.08)' },
  filterIconCity: { backgroundColor: 'rgba(1, 68, 33, 0.12)' },
  /* Fuel keeps a faint amber-green cast -- fuel, but still on-palette. */
  filterIconFuel: { backgroundColor: 'rgba(180, 83, 9, 0.12)' },
  filterLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
  },
  filterControl: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    backgroundColor: GasTaColors.white,
    borderColor: GasTaColors.forestGlow,
  },
  filterValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
  },
  filterBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 42, 31, 0.45)',
    justifyContent: 'flex-end',
  },
  filterSheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  filterSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  filterSheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: GasTaColors.textPrimary,
  },
  filterOptionList: {
    paddingHorizontal: spacing.md,
  },
  filterOption: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterOptionText: {
    flex: 1,
    fontSize: 15,
    paddingRight: spacing.sm,
    color: GasTaColors.textPrimary,
  },

  /* ---- hero: the primary data surface ---- */
  heroCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: GasTaColors.forestDark,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroLabel: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(248, 240, 229, 0.72)',
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.cream,
  },
  heroPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  heroPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: spacing.sm,
  },
  heroPrice: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.6,
    color: GasTaColors.cream,
    flexShrink: 1,
  },
  heroUnit: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(248, 240, 229, 0.7)',
  },
  heroStation: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(248, 240, 229, 0.78)',
    marginTop: 2,
  },
  heroMovement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(248, 240, 229, 0.2)',
  },
  heroDeltaTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  heroDeltaDown: { backgroundColor: 'rgba(123, 227, 168, 0.18)' },
  heroDeltaUp: { backgroundColor: 'rgba(255, 180, 162, 0.18)' },
  heroDeltaText: { fontSize: 13, fontWeight: '800' },
  heroDeltaFlat: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(248, 240, 229, 0.14)',
  },
  heroDeltaFlatText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(248, 240, 229, 0.8)',
  },
  heroMovementNote: {
    flex: 1,
    fontSize: 11,
    color: 'rgba(248, 240, 229, 0.6)',
  },

  /* ---- price range ---- */
  rangeCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  rangeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  rangeTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textMuted,
  },
  rangeCount: {
    fontSize: 10,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  rangeEnds: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  rangeEndLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
  },
  rangeEndValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: GasTaColors.forestDark,
    marginTop: 1,
  },
  rangeMid: { alignItems: 'center' },
  rangeEndRight: { alignItems: 'flex-end' },
  rangeBar: {
    height: 6,
    marginTop: spacing.md,
    justifyContent: 'center',
  },
  rangeTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: GasTaColors.forestGlow,
  },
  rangeDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GasTaColors.forest,
  },

  /* ---- trend ---- */
  trendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  trendPanel: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  trendBrandRow: { marginBottom: spacing.md },
  summaryStrip: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestGlow,
  },
  summaryStripText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: GasTaColors.forestDark,
  },
  summaryStripMeta: {
    fontSize: 11,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  weekList: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestGlow,
  },

  /* ---- list heading + report CTA ---- */
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
  },
  sectionTitleTop: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
    marginTop: spacing.xl,
  },
  reportCta: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.creamLight,
  },
  reportCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },

  /* ---- flat row lists ---- */
  plainListTight: {
    backgroundColor: GasTaColors.creamLight,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
    overflow: 'hidden',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  /* Needs-confirmation is pending community data, so it carries a pale amber
     cast rather than reading as another authoritative white block. */
  confirmList: {
    backgroundColor: 'rgba(180, 83, 9, 0.06)',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(180, 83, 9, 0.22)',
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestGlow,
  },

  /* ---- needs-confirmation rows ---- */
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  verifyInfo: { flex: 1, minWidth: 0 },
  verifyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
  },
  verifyMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  verifyPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  verifyUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: GasTaColors.textSoft,
  },
  voteBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.creamLight,
  },
  voteBtnBusy: { opacity: 0.5 },
  voteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },

  /* ---- history summary ---- */

  /* ---- quiet text states ---- */
  inlineLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginTop: spacing.sm,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
    marginBottom: 2,
  },
  emptyLine: {
    fontSize: 13,
    lineHeight: 19,
    color: GasTaColors.textSoft,
    paddingVertical: spacing.lg,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: GasTaColors.error,
    backgroundColor: palette.dangerSoft,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: palette.danger,
  },
});
