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
import ScreenHeader from '@/components/ui/ScreenHeader';
import FuelTypeBadge from '@/components/ui/FuelTypeBadge';
import { getFuelTypeColor } from '@/constants/fuelTypeColors';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import PriceCompareRow from '@/components/ui/PriceCompareRow';
import PriceHistoryList from '@/components/ui/PriceHistoryList';
import PriceTrendChart from '@/components/ui/PriceTrendChart';
import SelectField from '@/components/ui/SelectField';
import BrandMark from '@/components/ui/BrandMark';
import StationPriceTable, {
  type AreaPriceRow,
  type StationPriceRow,
} from '@/components/ui/StationPriceTable';
import { useResponsive } from '@/hooks/useResponsive';
import { useFuelPriceDefault } from '@/hooks/useFuelPriceDefault';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import FuelTypeFilter from '@/components/prices/FuelTypeFilter';
import NearbyStationPicker from '@/components/prices/NearbyStationPicker';
import { isStationBrand, type StationBrand } from '@/lib/services/googlePlacesAutocomplete';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { DOE_FUEL_TYPES } from '@/constants/fuelTypes';
import {
  DOE_REGIONS,
  type DoeRegionCode,
} from '@/constants/regions';
import { colors, GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingNavContentInset } from '@/app/(tabs)/_layout';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import {
  formatBulletinRange,
  formatCurrency,
  formatDate,
  formatRelativeReportAge,
  formatShortDate,
} from '@/lib/format';
import {
  communityReportMatchesRecency,
  confirmCommunityReport,
  fetchCommunityReports,
  fetchOilCompanies,
  fetchConfirmedReportIds,
  fetchPendingReports,
  fetchFreshVerifiedPrices,
  fetchFuelStationsByRegion,
  isHistoricalCommunityReport,
  usersConfirmedLabel,
  type CommunityRecency,
  type FuelStationOption,
  type CommunityReport,
  type PendingCommunityReport,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import {
  fetchBulletinsForRegion,
  fetchBulletinAreas,
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  fetchPriceTrend,
  type BulletinWeek,
  type FuelPriceRow,
  type PriceTrendPoint,
} from '@/lib/services/fuelPrices';
import { matchBulletinArea, resolveCurrentPlace } from '@/lib/services/location';
import { buildOfficialDoeRows, trustedPriceComparisons, type SupportedFuelCompany } from '@/lib/officialCompanyRows';
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
  const doeBySlug = new Map(doePrices.map((row) => [row.oil_company.slug, row]));
  const doeByCompanyId = new Map(doePrices.map((row) => [row.oil_company.id, row]));
  const verifiedByStation = new Map(verified.map((row) => [row.station_id, row] as const));
  const pendingByName = new Map<string, PendingCommunityReport>();
  for (const report of pending) {
    if (report.fuel_type?.code && report.fuel_type.code !== fuelCode) continue;
    const name = report.station?.name;
    if (name && !pendingByName.has(name)) pendingByName.set(name, report);
  }

  const matchingStations = stations.filter((station) => matchesCityFilter(station, city));
  const matchingCompanyIds = new Set(matchingStations.map((station) => station.oil_company.id));
  const doeCompanyIds = new Set(doePrices.map((row) => row.oil_company.id));
  const visibleStations = city
    ? stations.filter(
        (station) =>
          matchesCityFilter(station, city) ||
          (doeCompanyIds.has(station.oil_company.id) &&
            !matchingCompanyIds.has(station.oil_company.id))
      )
    : stations;

  const stationRows = visibleStations
    .map((station) => {
      const brand = station.brand_label?.trim() || station.oil_company.name;
      const verifiedRow = verifiedByStation.get(station.id);
      const pendingRow = pendingByName.get(station.name);
      const doeRow =
        doeByCompanyId.get(station.oil_company.id) ??
        doeBySlug.get(station.oil_company.slug) ??
        null;
      const doePrice = doeRow?.price_per_liter ?? null;

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
        status:
          doeRow == null
            ? undefined
            : doeRow.area_name
              ? 'DOE Area/Brand Estimate'
              : 'DOE Region-Wide Estimate',
      };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.station.localeCompare(b.station));

  const includedStationSlugs = new Set(
    visibleStations.map((station) => station.oil_company.slug)
  );
  const includedCompanyIds = new Set(
    visibleStations.map((station) => station.oil_company.id)
  );
  const seenAreaSlugs = new Set<string>();
  const areaRows: AreaPriceRow[] = [];

  for (const row of doePrices) {
    const slug = row.oil_company.slug;
    if (
      includedStationSlugs.has(slug) ||
      includedCompanyIds.has(row.oil_company.id) ||
      seenAreaSlugs.has(slug)
    )
      continue;
    seenAreaSlugs.add(slug);

    areaRows.push({
      id: `doe-area-${row.id}`,
      slug,
      brand: row.oil_company.name,
      areaName: row.area_name || 'Region-wide DOE price',
      price: doeBySlug.get(slug)?.price_per_liter ?? row.price_per_liter,
      source: 'doe_area',
      status: row.area_name ? 'DOE Area/Brand Estimate' : 'DOE Region-Wide Estimate',
    });
  }

  areaRows.sort((a, b) => a.brand.localeCompare(b.brand));

  return { stationRows, areaRows };
}

type PricesView = 'now' | 'history';

const COMMUNITY_RECENCY_OPTIONS: { value: CommunityRecency; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: 'past', label: 'Past' },
];

const HISTORY_WEEKS = 52;

/*
 * The centred content column comes from `useResponsive().contentMaxWidth`, so
 * it fills a phone and caps the dashboard on tablet/web instead of letting
 * rows stretch across a 1366px browser.
 */

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
  loading?: boolean;
  more?: boolean;
  error?: string | null;
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
  loading = false,
  more = false,
  error = null,
  style,
}: PriceFilterFieldProps<T>) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { isCompact } = useResponsive();
  const [open, setOpen] = useState(false);
  useFocusEffect(useCallback(() => () => setOpen(false), []));
  const selected = options.find((option) => option.value === value)?.label ?? placeholder;
  const selectedFuelTone = more && options.some((option) => option.value === value) ? getFuelTypeColor(value) : null;
  // Location controls keep the neutral surface; fuel labels use their own tone.
  const tint =
    icon === 'map-marker-outline'
      ? styles.filterIconRegion
      : icon === 'office-building-outline'
        ? styles.filterIconCity
        : styles.filterIconFuel;

  return (
    <View style={[styles.filterField, selectedFuelTone && (isCompact ? styles.moreFuelFieldCompact : styles.moreFuelField), style]}>
      {!more ? <View style={styles.filterLabelRow}>
        <View style={[styles.filterIcon, tint]}>
          <MaterialCommunityIcons name={icon} size={12} color={GasTaColors.forestDark} />
        </View>
        <Text style={styles.filterLabel}>{label}</Text>
      </View> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
        accessibilityState={{ expanded: open, selected: more ? options.some((option) => option.value === value) : undefined }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.filterControl,
          more && styles.moreFuelControl,
          selectedFuelTone && { backgroundColor: selectedFuelTone.strong, borderColor: selectedFuelTone.strong },
          pressed && (selectedFuelTone ? styles.pressed : { backgroundColor: GasTaColors.cream }),
        ]}>
        <Text style={[styles.filterValue, more && styles.fuelChipText, more && isCompact && styles.moreFuelLabelCompact, selectedFuelTone && { color: selectedFuelTone.onStrong }]} numberOfLines={1} adjustsFontSizeToFit={more} minimumFontScale={0.9}>
          {selected}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={14} color={selectedFuelTone?.onStrong ?? GasTaColors.textSoft} />
      </Pressable>

      <Modal visible={open} transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
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
              ListEmptyComponent={
                loading ? (
                  <Text style={[styles.filterLoadingText, { color: theme.textSecondary }]}>
                    Loading available areas…
                  </Text>
                ) : error ? (
                  <Text style={[styles.filterLoadingText, { color: theme.textSecondary }]}>
                    {error}
                  </Text>
                ) : undefined
              }
              ListFooterComponent={
                options.length > 0 && (loading || error) ? (
                  <Text style={[styles.filterLoadingText, { color: theme.textSecondary }]}>
                    {loading ? 'Refreshing available areas…' : error}
                  </Text>
                ) : undefined
              }
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                const fuelTone = more ? getFuelTypeColor(item.value) : null;
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
                      (isSelected || pressed) && { backgroundColor: fuelTone?.soft ?? PRICE_GREEN_SOFT },
                    ]}>
                    {fuelTone ? <View accessible={false} style={[styles.fuelOptionDot, { backgroundColor: fuelTone.strong }]} /> : null}
                    <Text
                      style={[
                        styles.filterOptionText,
                        { color: fuelTone?.text ?? theme.text, fontWeight: isSelected ? '800' : '500' },
                      ]}>
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <MaterialCommunityIcons name="check-circle" size={19} color={fuelTone?.strong ?? PRICE_GREEN} />
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
  // Show the selected scope first; reveal editing controls on demand.
  const { width, contentMaxWidth, isCompact, isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<PricesView>('now');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [rangeExpanded, setRangeExpanded] = useState(false);
  const [coverageInfoOpen, setCoverageInfoOpen] = useState(false);
  const [nearbySearch, setNearbySearch] = useState<{ brand: StationBrand; brandName: string; priceContext: string } | null>(null);
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const { fuelType, selectFuelType, vehicleLabel } = useFuelPriceDefault(user?.id ?? null);
  const fuelTone = getFuelTypeColor(fuelType);
  const fuelCardSurface = { backgroundColor: GasTaColors.white, borderColor: GasTaColors.glassBorderSubtle };
  const [areaName, setAreaName] = useState('');
  const [doeAreas, setDoeAreas] = useState<string[]>([]);
  const [areasFromDoe, setAreasFromDoe] = useState(false);
  const [doeAreasLoading, setDoeAreasLoading] = useState(false);
  const [doeAreasError, setDoeAreasError] = useState<string | null>(null);
  const doeAreasCache = useRef(new Map<string, string[]>());
  const activeAreaRequestKey = useRef<string | null>(null);
  /*
   * Location-derived filtering.
   *
   * `nearMePlace` is non-null only while the CURRENT Region/City selection came
   * from the device location. Any manual filter change clears it, which is what
   * stops the screen from snapping back to the user after they browse elsewhere.
   *
   * `regionTouchedManually` records that the user has chosen a region by hand at
   * least once this session, so the one-time location default never fights them.
   */
  const [nearMePlace, setNearMePlace] = useState<{
    regionCode: DoeRegionCode;
    city: string | null;
  } | null>(null);
  const [regionTouchedManually, setRegionTouchedManually] = useState(false);
  const [nearMeBusy, setNearMeBusy] = useState(false);
  const [nearMeDenied, setNearMeDenied] = useState(false);
  const initialisedFromLocation = useRef(false);

  /**
   * Apply a resolved place to the filters.
   *
   * Region is always set. Area is set only when the reverse-geocoded city matches
   * a REAL area name from this region's bulletin -- `matchBulletinArea` never
   * invents one, so an unmatched city remains on the region-wide DOE option.
   */
  const applyPlace = useCallback(
    async (place: { regionCode: DoeRegionCode; city: string | null }) => {
      setRegion(place.regionCode);
      setNearMePlace({ regionCode: place.regionCode, city: place.city });
      setNearMeDenied(false);
      try {
        const week = await fetchLatestBulletinForRegion(place.regionCode);
        if (!week) {
          setAreaName('');
          return;
        }
        const bulletinAreas = await fetchBulletinAreas(week.id, place.regionCode);
        setAreaName(matchBulletinArea(place.city, bulletinAreas) ?? '');
      } catch {
        setAreaName('');
      }
    },
    []
  );

  /**
   * User-triggered `Near me`. This is the only path that actively asks for
   * permission, so a refusal is never nagged -- it just leaves the filters
   * exactly as they were.
   */
  const handleNearMe = useCallback(async () => {
    setNearMeBusy(true);
    try {
      const place = await resolveCurrentPlace({ requestIfNeeded: true, force: true });
      if (!place) {
        setNearMeDenied(true);
        return;
      }
      await applyPlace(place);
    } finally {
      setNearMeBusy(false);
    }
  }, [applyPlace]);

  // Any manual change to Region or City means the user is driving the filters
  // from here, so drop the location badge and retire the default.
  const handleManualRegion = useCallback((next: DoeRegionCode) => {
    setRegionTouchedManually(true);
    setNearMePlace(null);
    setNearMeDenied(false);
    setRegion(next);
  }, []);
  const handleManualArea = useCallback((next: string) => {
    setRegionTouchedManually(true);
    setNearMePlace(null);
    setNearMeDenied(false);
    setAreaName(next);
  }, []);

  /*
   * One-time location default. It reads an EXISTING grant without prompting and
   * runs only until it succeeds once; a manual choice, or a missing grant,
   * permanently retires it for the session.
   */
  useEffect(() => {
    if (initialisedFromLocation.current || regionTouchedManually) return;
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      const place = await resolveCurrentPlace();
      if (cancelled) return;
      // No grant (or unavailable). Mark as done so we never silently retry, and
      // leave every manual filter fully functional.
      initialisedFromLocation.current = true;
      if (place) await applyPlace(place);
    })();
    return () => {
      cancelled = true;
    };
  }, [regionTouchedManually, applyPlace]);
  const [trendCompanySlug, setTrendCompanySlug] = useState('petron');
  const [bulletin, setBulletin] = useState<BulletinWeek | null>(null);
  const [pastBulletins, setPastBulletins] = useState<BulletinWeek[]>([]);
  const [selectedPastDate, setSelectedPastDate] = useState<string | null>(null);
  const [prices, setPrices] = useState<FuelPriceRow[]>([]);
  const [supportedCompanies, setSupportedCompanies] = useState<SupportedFuelCompany[]>([]);
  const [pastWeekPrices, setPastWeekPrices] = useState<FuelPriceRow[]>([]);
  const [trend, setTrend] = useState<PriceTrendPoint[]>([]);
  /**
   * Explicit history lifecycle. The chart used to render "Not enough history
   * yet" purely because `trend` was still `[]`, which conflated "not requested
   * yet" with "genuinely too few weeks". Now the message is reachable only from
   * 'ready' with fewer than two usable points.
   */
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [verifiedCommunity, setVerifiedCommunity] = useState<VerifiedCommunityPrice[]>([]);
  const [pendingCommunity, setPendingCommunity] = useState<PendingCommunityReport[]>([]);
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [communityRecency, setCommunityRecency] = useState<CommunityRecency>('recent');
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyLoadedFor = useRef<string | null>(null);

  /*
   * The community feed is fetched with a query-side period bound (Recent /
   * Last 7 Days / Last 30 Days / Past), so the row limit only ever truncates
   * inside the selected period and the Past filter reaches rows older than 30
   * days instead of only whatever happens to sit inside the newest 200 overall.
   *
   * The loader reads the current period from a ref so its identity changes
   * only with the region: chip changes re-run the effect below without
   * re-running the focus effect or `loadRegion`. Focus-triggered refreshes
   * call the same loader through `communityLoaderRef`.
   */
  const communityRecencyRef = useRef(communityRecency);
  const loadCommunityReports = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const rows = await fetchCommunityReports(200, {
      regionCode: region,
      recency: communityRecencyRef.current,
    }).catch((e) => {
      console.warn('Community reports failed', e);
      return null;
    });
    if (rows) setCommunityReports(rows);
  }, [region]);
  const communityLoaderRef = useRef(loadCommunityReports);

  useEffect(() => {
    communityRecencyRef.current = communityRecency;
    communityLoaderRef.current = loadCommunityReports;
    void loadCommunityReports();
  }, [communityRecency, loadCommunityReports]);

  const regionLabel = DOE_REGIONS.find((r) => r.code === region)?.name ?? region;
  const regionDisplay = DOE_REGIONS.find((r) => r.code === region)?.code ?? regionLabel;
  const fuelLabel = DOE_FUEL_TYPES.find((f) => f.code === fuelType)?.name ?? fuelType;
  const fuelDisplay = getFuelTypePresentation(fuelType);
  const areaLabel = areaName || 'Region-wide DOE price';
  const selectedBulletinForAreas = selectedPastDate
    ? pastBulletins.find((week) => week.bulletin_date === selectedPastDate) ?? bulletin
    : bulletin;

  const areas = doeAreas;

  const regionOptions = useMemo(
    () => DOE_REGIONS.map((r) => ({ value: r.code, label: r.name })),
    []
  );
  const areaOptions = useMemo(
    () => [
      { value: '', label: 'Region-wide DOE price' },
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
      // Pending reports are fetched unbounded by period on purpose: the
      // confirmation queue and the station-row inputs keep showing every
      // pending report (pre-existing behaviour), while the period-scoped
      // community feed is loaded separately by `loadCommunityReports`.
      const [latest, pendingReports, regionStations, companies] = await Promise.all([
        fetchLatestBulletinForRegion(region),
        fetchPendingReports(50, { regionCode: region }).catch((e) => {
          console.warn('Pending community reports failed', e);
          return [];
        }),
        fetchFuelStationsByRegion(region).catch((e) => {
          console.warn('Fuel stations failed', e);
          return [];
        }),
        // Canonical catalog is independent of DOE coverage in the active area.
        fetchOilCompanies(),
      ]);

      setSupportedCompanies(companies);
      setBulletin(latest);
      setPendingCommunity(pendingReports);
      setStations(regionStations);
      historyLoadedFor.current = null;

      if (user && pendingReports.length > 0) {
        const voted = await fetchConfirmedReportIds(
          user.id,
          pendingReports.map((row) => row.id)
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

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fuel prices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [region, user]);

  useEffect(() => {
    const activeBulletin = selectedBulletinForAreas;
    if (!activeBulletin) {
      activeAreaRequestKey.current = null;
      setDoeAreas([]);
      setAreasFromDoe(false);
      setDoeAreasLoading(false);
      setDoeAreasError(null);
      setAreaName('');
      return;
    }

    const cacheKey = `${activeBulletin.id}:${region}:${fuelType}`;
    activeAreaRequestKey.current = cacheKey;
    const cachedAreas = doeAreasCache.current.get(cacheKey);
    if (cachedAreas) {
      setDoeAreas(cachedAreas);
      setAreasFromDoe(cachedAreas.length > 0);
      setDoeAreasLoading(false);
      setDoeAreasError(null);
      setAreaName((current) => (current && !cachedAreas.includes(current) ? '' : current));
      return;
    }

    let cancelled = false;
    setDoeAreasLoading(true);
    setDoeAreasError(null);
    void fetchBulletinAreas(activeBulletin.id, region, fuelType)
      .then((nextAreas) => {
        if (cancelled || activeAreaRequestKey.current !== cacheKey) return;
        doeAreasCache.current.set(cacheKey, nextAreas);
        setDoeAreas(nextAreas);
        setAreasFromDoe(nextAreas.length > 0);
        setAreaName((current) => (current && nextAreas.includes(current) ? current : ''));
      })
      .catch(() => {
        if (cancelled || activeAreaRequestKey.current !== cacheKey) return;
        setDoeAreasError(
          doeAreasCache.current.has(cacheKey)
            ? null
            : 'Could not load area options. Please try again.'
        );
      })
      .finally(() => {
        if (!cancelled && activeAreaRequestKey.current === cacheKey) {
          setDoeAreasLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBulletinForAreas, region, fuelType]);

  useEffect(() => {
    setSelectedPastDate(null);
    setPastWeekPrices([]);
    setAreaName('');
    setPastBulletins([]);
    // Clearing the series without resetting the status would leave the chart in
    // 'ready' with zero points, which is exactly the "unloaded shown as missing"
    // bug. 'idle' is the honest state: nothing has been requested for this
    // region yet, and the eager effect below moves it to 'loading'.
    setTrend([]);
    setHistoryStatus('idle');
    setLoading(true);
    void loadRegion();
  }, [loadRegion]);

  // Fuel / city change: only prices + verified community (fast path).
  useEffect(() => {
    if (!isSupabaseConfigured || loading) return;

    let cancelled = false;
    setPricesLoading(true);
    setPrices([]);
    setVerifiedCommunity([]);

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

        const areaForDoe = areaName;
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
  }, [bulletin, region, fuelType, areaName, loading]);

  /*
   * History loads eagerly, in the background, as soon as a bulletin exists --
   * not only when Past prices is opened.
   *
   * Reasons:
   *  - The hero delta becomes truthful immediately, instead of only after the
   *    user happens to visit the history tab.
   *  - Opening Past prices is instant rather than showing a first-paint stall.
   *  - It removes the "Not enough history yet -> graph appears" transition,
   *    which only ever meant "the request had not run yet".
   *
   * No new backend work: this reuses the existing fetchPriceTrend and
   * fetchBulletinsForRegion. `historyLoadedFor` keys the cache on
   * region + fuel + company, so switching back and forth does not refetch, and
   * a genuine change of any of those three inputs refetches exactly once.
   *
   * The two calls are tracked separately on purpose: the week list feeds the
   * Past prices picker, while the trend series feeds the chart and the hero
   * delta. A failure in either is reported honestly rather than being smoothed
   * into an empty array that would read as "no history".
   */
  useEffect(() => {
    if (!bulletin || loading) return;
    const key = `${region}:${fuelType}:${trendCompanySlug}`;
    if (historyLoadedFor.current === key) return;

    let cancelled = false;
    setHistoryStatus('loading');

    void Promise.all([
      fetchBulletinsForRegion(region, HISTORY_WEEKS),
      fetchPriceTrend(region, fuelType, trendCompanySlug),
    ])
      .then(([weeks, points]) => {
        if (cancelled) return;
        setPastBulletins(weeks);
        setTrend(points.slice(-HISTORY_WEEKS));
        historyLoadedFor.current = key;
        setHistoryStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        // Allow a later retry: do not poison the cache key on failure.
        setHistoryStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [bulletin, region, fuelType, trendCompanySlug, loading]);

  /*
   * A company change inside the history tab needs a fresh series for that
   * brand, so it is fetched on its own rather than going through the cached
   * effect above (whose key already moved, but only after the region load
   * settles). Kept narrow: it never downgrades a 'ready' state to 'error' on
   * cancellation, and it always ends in an honest terminal state.
   */
  useEffect(() => {
    if (view !== 'history' || !trendCompanySlug || loading) return;
    const key = `${region}:${fuelType}:${trendCompanySlug}`;
    if (historyLoadedFor.current === key) return;

    let cancelled = false;
    void fetchPriceTrend(region, fuelType, trendCompanySlug)
      .then((points) => {
        if (cancelled) return;
        setTrend(points.slice(-HISTORY_WEEKS));
        setHistoryStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setHistoryStatus('error');
      });

    return () => {
      cancelled = true;
    };
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
      // Returning to the tab refreshes the period-scoped feed as well; it lives
      // in its own loader so chip changes never re-run this whole effect.
      void communityLoaderRef.current();
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

  const officialRows = useMemo(
    () => ({ stationRows: [], areaRows: buildOfficialDoeRows(supportedCompanies, prices, {
      bulletinId: bulletin?.id ?? null, region, area: areaName, fuelType,
    }) }),
    [supportedCompanies, prices, bulletin, region, areaName, fuelType]
  );

  const communityForFuel = useMemo(
    () =>
      communityReports
        .filter((report) => !report.fuel_type?.code || report.fuel_type.code === fuelType)
        .filter((report) => communityReportMatchesRecency(report.created_at, communityRecency)),
    [communityReports, communityRecency, fuelType]
  );

  const communityStatusLabel = (report: CommunityReport, isHistorical: boolean): string => {
    if (report.status === 'verified') {
      return isHistorical
        ? 'Verified · Historical'
        : `✓ Verified · ${report.confirmation_count} confirmation${
            report.confirmation_count === 1 ? '' : 's'
          }`;
    }
    if (report.status === 'needs_review') return 'Needs Review';
    if (report.status === 'rejected') return 'Rejected';
    if (user && report.reported_by !== user.id && confirmedIds.has(report.id)) {
      return `✓ You confirmed · ${report.confirmation_count}/${VERIFY_CONFIRMATIONS_REQUIRED}`;
    }
    return report.confirmation_count === 0
      ? 'Pending · No confirmations yet'
      : `Pending · ${report.confirmation_count}/${VERIFY_CONFIRMATIONS_REQUIRED} confirmations`;
  };

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
      await communityLoaderRef.current();
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
    let cancelled = false;
    setPastWeekPrices([]);
    const areaForDoe = areaName;
    void fetchFuelPricesForBulletin(selected.id, region, fuelType, areaForDoe)
      .then((rows) => { if (!cancelled) setPastWeekPrices(rows); })
      .catch(() => { if (!cancelled) setPastWeekPrices([]); });
    return () => { cancelled = true; };
  }, [selectedPastDate, pastBulletins, region, fuelType, areaName]);

  const historySummary = useMemo(() => {
    if (trend.length < 2) return null;
    const oldest = trend[0];
    const newest = trend[trend.length - 1];
    const delta = newest.price_per_liter - oldest.price_per_liter;
    return { oldest, newest, delta };
  }, [trend]);

  const companyName =
    companyOptions.find((c) => c.value === trendCompanySlug)?.label ?? 'this brand';

  // Compare authoritative source facts. A company-level DOE reference counts
  // once, regardless of how many physical branches the directory contains.
  type CheapestRow = ReturnType<typeof trustedPriceComparisons>[number];

  const comparisonRows = useMemo(() => trustedPriceComparisons(stationRows, officialRows.areaRows), [stationRows, officialRows]);
  const cheapest = useMemo<CheapestRow | null>(() => {
    if (!comparisonRows.length) return null;
    return comparisonRows.reduce((best, row) => row.price < best.price ? row : best);
  }, [comparisonRows]);

  /*
   * Does the selected fuel actually have any usable price right now?
   *
   * The old empty-state test was `stationRows.length === 0 && areaRows.length
   * === 0`, which counts *stations*, not prices. The station directory is a
   * static table and always has rows for a populated region, so that condition
   * was almost never true -- including when the bulletin contained no prices
   * for the selected fuel at all. North Luzon with RON_91 hit exactly this: 12
   * stations, zero DOE rows, and the table rendered 12 lines of "—", which read
   * as a broken page.
   *
   * A price counts as usable only when it is a real positive number, so a null
   * DOE lookup, an unpriced community row, and a genuine value are all
   * distinguished properly.
   */
  const hasAnyPrice = useMemo(() => {
    const pricedStations = stationRows.filter(
      (row) => typeof row.price === 'number' && row.price > 0
    );
    const pricedAreas = areaRows.filter(
      (row) => typeof row.price === 'number' && row.price > 0
    );
    return pricedStations.length > 0 || pricedAreas.length > 0;
  }, [stationRows, areaRows]);

  // Range uses the same trusted facts as the headline, not branch-count copies
  // of a regional estimate or unverified community reports.
  const priceRange = useMemo(() => {
    const all = comparisonRows.map((row) => row.price);
    if (all.length < 2) return null;
    const low = Math.min(...all);
    const high = Math.max(...all);
    return { low, high, spread: high - low, count: all.length };
  }, [comparisonRows]);

  /*
   * Change vs the previous DOE bulletin for the same brand/fuel/region.
   *
   * REAL data only. It reads the `trend` series, which is now fetched eagerly
   * alongside the current bulletin rather than waiting for Past prices, so the
   * hero can carry a genuine movement figure on a first visit instead of
   * silently having none until the user happens to open the history tab.
   *
   * The `historyStatus` guard matters: `trend` is reset to `[]` on region
   * change, so without it the memo would keep returning the previous region's
   * last two points for one render after the switch -- briefly attributing
   * another region's movement to the new one. While history is loading or has
   * failed there is simply no delta, which is honest, rather than a wrong one.
   */
  const heroMovement = useMemo(() => {
    if (historyStatus !== 'ready') return null;
    if (trend.length < 2) return null;
    const prev = trend[trend.length - 2].price_per_liter;
    const last = trend[trend.length - 1].price_per_liter;
    return { delta: last - prev, prevDate: trend[trend.length - 2].bulletin_date };
  }, [trend, historyStatus]);

  const trendSection = (
    <View testID="prices-trend" style={styles.trendSection}>
      <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>Price trend</Text><FuelTypeBadge fuelCode={fuelType} /></View>

      <View testID="price-trend-card" style={[styles.trendPanel, fuelCardSurface]}>
        {view === 'history' && companyOptions.length > 0 ? (
          <View style={styles.trendBrandRow}>
            <SelectField
              appearance="standard"
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
                ? `${formatCurrency(Math.abs(historySummary.delta))} cheaper than ${formatBulletinRange(historySummary.oldest.bulletin_date)}`
                : historySummary.delta > 0
                  ? `${formatCurrency(historySummary.delta)} higher than ${formatBulletinRange(historySummary.oldest.bulletin_date)}`
                  : `Unchanged since ${formatBulletinRange(historySummary.oldest.bulletin_date)}`}
            </Text>
            <Text style={styles.summaryStripMeta}>
              {formatCurrency(historySummary.oldest.price_per_liter)} →{' '}
              {formatCurrency(historySummary.newest.price_per_liter)}/L
            </Text>
          </View>
        ) : null}

        {/*
          The chart is only asked to draw once history has actually
          resolved. Before this, `trend` was `[]` and PriceTrendChart
          rendered its own "Not enough history yet" -- which claimed the
          region had no history when in fact the request simply had not run.
          Loading and failure are now stated here instead, and the
          insufficient-history message is reachable only from a successful
          load that really did return fewer than two usable weeks.
        */}
        {historyStatus === 'error' ? (
          <View style={styles.historyNote}>
            <Text style={styles.historyNoteTitle}>Price history unavailable</Text>
            <Text style={styles.historyNoteBody}>
              Could not load past bulletins for this region. Pull to refresh to try again.
            </Text>
          </View>
        ) : historyStatus === 'loading' || historyStatus === 'idle' ? (
          <View style={styles.historyNote}>
            <Text style={styles.historyNoteTitle}>Loading price history…</Text>
          </View>
        ) : (
          <PriceTrendChart
            points={trend}
            fuelCode={fuelType}
            caption={
              view === 'history'
                ? `${fuelLabel} · ${companyName}`
                : `${fuelLabel} · ${regionLabel}`
            }
            height={isCompact ? 104 : view === 'history' ? 148 : 126}
          />
        )}

        {view === 'history' && historyStatus === 'ready' && trend.length > 0 ? (
          <View style={styles.weekList}>
            <PriceHistoryList
              points={trend}
              selectedDate={selectedPastDate ?? undefined}
              onSelectDate={(date) => {
                setSelectedPastDate((current) => (current === date ? null : date));
                setAreaName('');
              }}
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

    </View>
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  return (
    <ScrollView
      testID="fuel-prices-screen"
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={styles.flex}
      contentContainerStyle={[
        styles.padding,
        // Centred responsive shell. On phones this is transparent and the
        // column simply fills the width; on tablet/web it stops the content
        // from stretching edge to edge.
        { maxWidth: isDesktop ? contentMaxWidth : Math.min(width, 760), alignSelf: 'center', width: '100%',
          paddingHorizontal: isDesktop ? spacing.lg : 20,
          paddingBottom: isDesktop ? spacing.xxl : floatingNavContentInset(insets.bottom) },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadRegion();
            void communityLoaderRef.current();
          }}
          tintColor={GasTaColors.forest}
        />
      }>
      <ScreenHeader
        compact={!isDesktop}
        eyebrow={isDesktop ? 'At the pump' : undefined}
        title="Fuel prices"
        subtitle={isDesktop ? 'Find your next fill-up.' : undefined}
        action={
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Community prices"
          hitSlop={8}
          onPress={() => router.push('/(tabs)/prices/community')}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <Text style={styles.headerActionText}>Community</Text>
        </Pressable>
        }
      />

      {nearbySearch ? <NearbyStationPicker {...nearbySearch} priceContexts={Object.fromEntries(officialRows.areaRows.map((row) => [row.slug, row.price != null && row.price > 0 ? `${row.brand} DOE estimate: ${formatCurrency(row.price)}/L for ${fuelLabel} in ${areaName || regionLabel}. Branch prices may differ.` : `Price unavailable for ${row.brand} in this selection. You can still plan your drive.`]))} onClose={() => setNearbySearch(null)} /> : null}

      {/* The summary always reflects the same scope used by prices and history. */}
      <View testID="prices-controls" style={styles.controlsPanel}>
        <View style={styles.filterSummary}>
          <View style={styles.filterSummaryCopy}>
            <View style={styles.filterSummaryScope}>
              <MaterialCommunityIcons name="gas-station-outline" size={18} color={colors.primary} />
              <Text style={styles.filterSummaryFuel}>{fuelDisplay.primaryLabel}</Text>
              <Text style={styles.filterSummaryRegion} numberOfLines={1}>· {region === 'NCR' ? 'NCR' : regionLabel}</Text>
            </View>
            <View style={styles.filterSummaryMeta}>
              <Text style={styles.filterSummaryArea} numberOfLines={1}>
                {fuelDisplay.subtitle ? `${fuelDisplay.subtitle} · ` : ''}{areaName || 'Region-wide DOE'} · {view === 'now' ? 'This week' : 'Past prices'}
              </Text>
              {!areaName ? <Pressable testID="prices-coverage-info" accessibilityRole="button"
                accessibilityLabel="About region-wide DOE prices" hitSlop={8}
                onPress={() => setCoverageInfoOpen(true)} style={styles.coverageInfoButton}>
                <MaterialCommunityIcons name="information-outline" size={15} color={GasTaColors.textMuted} />
              </Pressable> : null}
            </View>
          </View>
          <Pressable
            testID="prices-filter-toggle" accessibilityRole="button"
            accessibilityLabel={`${filtersExpanded ? 'Hide' : 'Show'} filters. Fuel: ${fuelLabel}. Region: ${regionLabel}. Area: ${areaLabel}. ${view === 'now' ? 'This week' : 'Past prices'}.`}
            accessibilityState={{ expanded: filtersExpanded }} aria-expanded={filtersExpanded}
            aria-controls="prices-filter-options" onPress={() => setFiltersExpanded((expanded) => !expanded)}
            style={({ pressed }) => [styles.filterSummaryAction, filtersExpanded && styles.filterSummaryActionActive, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={filtersExpanded ? 'close' : 'tune-variant'} size={21}
              color={colors.onPrimary} />
          </Pressable>
        </View>
        {coverageInfoOpen ? <Modal testID="prices-coverage-dialog" transparent visible animationType="fade" onRequestClose={() => setCoverageInfoOpen(false)}>
          <Pressable style={styles.filterBackdrop} onPress={() => setCoverageInfoOpen(false)} accessibilityLabel="Close DOE coverage information">
            <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={styles.coverageSheet}>
              <Text accessibilityRole="header" style={styles.coverageTitle}>Region-wide DOE prices</Text>
              <Text style={styles.coverageBody}>These prices cover {regionLabel}. {areasFromDoe ? 'Choose an area in Filters to narrow the DOE prices.' : 'DOE area-level prices are unavailable for this selection, so we show the region-wide bulletin instead.'} Exact station prices may differ.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close DOE coverage details" onPress={() => setCoverageInfoOpen(false)} style={styles.filterDone}>
                <Text style={styles.filterSummaryActionText}>Got it</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal> : null}
        <View
          nativeID="prices-filter-options"
          testID="prices-filter-options"
          accessibilityElementsHidden={!filtersExpanded}
          aria-hidden={!filtersExpanded}
          importantForAccessibility={filtersExpanded ? 'auto' : 'no-hide-descendants'}
          style={[styles.filterDetails, !filtersExpanded && styles.filtersHidden]}>
        <View style={styles.viewToggle} accessibilityRole="tablist" accessibilityLabel="Price period">
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

        <FuelTypeFilter compact={!isDesktop} label="Fuel" value={fuelType} onChange={selectFuelType} context={
          vehicleLabel ? <View testID="prices-default-context" accessible
            accessibilityLabel={`Using ${vehicleLabel} · ${fuelLabel}`} style={styles.fuelContext}>
            <Text style={styles.contextText} numberOfLines={1}>Using {vehicleLabel} ·</Text>
            <View style={[styles.contextDot, { backgroundColor: fuelTone.strong }]} />
            <Text style={styles.contextText}>{fuelLabel}</Text>
          </View> : null
        } />
        <View style={styles.filterRow}>
          <PriceFilterField label="Region" value={region} options={regionOptions}
            onChange={handleManualRegion} icon="map-marker-outline" />
          <PriceFilterField label="Area" value={areaName} options={areaOptions}
            onChange={handleManualArea} icon="office-building-outline"
            placeholder="Region-wide DOE price" loading={doeAreasLoading} error={doeAreasError} />
        </View>

        {nearMePlace || nearMeDenied ? (
          <View style={styles.nearMeRow}>
            {nearMePlace ? (
              <>
                <MaterialCommunityIcons
                  name="crosshairs-gps"
                  size={13}
                  color={GasTaColors.forest}
                />
                <Text style={styles.nearMeText} numberOfLines={1}>
                  Near you · {nearMePlace.city ?? nearMePlace.regionCode}
                </Text>
              </>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="map-marker-off-outline"
                  size={13}
                  color={GasTaColors.textSoft}
                />
                <Text style={styles.nearMeText} numberOfLines={2}>
                  Location access is off. Choose your area manually.
                </Text>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my current location"
              disabled={nearMeBusy}
              hitSlop={8}
              onPress={() => void handleNearMe()}
              style={({ pressed }) => [pressed && styles.pressed]}>
              <Text style={styles.nearMeAction}>
                {nearMeBusy ? 'Locating…' : 'Near me'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.nearMeRow}>
            <Text style={styles.nearMeText} numberOfLines={1}>
              Showing {areaLabel}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my current location"
              disabled={nearMeBusy}
              hitSlop={8}
              onPress={() => void handleNearMe()}
              style={({ pressed }) => [pressed && styles.pressed]}>
              <Text style={styles.nearMeAction}>
                {nearMeBusy ? 'Locating…' : 'Near me'}
              </Text>
            </Pressable>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done editing filters"
          onPress={() => setFiltersExpanded(false)}
          style={({ pressed }) => [styles.filterDone, pressed && styles.pressed]}>
          <Text style={styles.filterSummaryActionText}>Done</Text>
        </Pressable>
        </View>
      </View>
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
            On web the hero and the range summary sit side by side, so the top
            of the page uses the available width instead of stacking two
            half-empty cards. Phones still get the original vertical order.
          */}
          <View style={[styles.overviewRow, isDesktop && styles.overviewRowDesktop]}>
          {/*
            THE HERO. The single strongest element on the screen, on a forest
            surface, so the page reads as a fuel dashboard rather than a stack of
            white cards. Same minimum the list already highlights -- derived from
            rows in memory, no extra fetch, precedence untouched.
          */}
          {cheapest ? (
            <View testID="prices-lowest" accessibilityLabel={`${fuelLabel} lowest listed price`} style={[styles.heroCard, { backgroundColor: fuelTone.strong, borderColor: fuelTone.border }, isDesktop && styles.overviewCard]}>
              <View style={styles.heroTopRow}>
                <Text style={[styles.heroLabel, { color: fuelTone.onStrong }]}>Lowest listed price</Text>
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
                        : 'DOE estimate'}
                  </Text>
                </View>
              </View>

              <View style={styles.heroScopeRow}><FuelTypeBadge fuelCode={fuelType} /><Text style={[styles.heroScope, { color: fuelTone.onStrong }]}>{regionLabel}</Text></View>
              <View style={styles.heroPriceRow}>
                <Text style={[styles.heroPrice, { color: fuelTone.onStrong }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatCurrency(cheapest.price)}
                </Text>
                <Text style={[styles.heroUnit, { color: fuelTone.onStrong }]}>/L</Text>
              </View>

              <Text style={[styles.heroStation, { color: fuelTone.onStrong }]}>{cheapest.brand}</Text>
              <Text style={[styles.heroStation, { color: fuelTone.onStrong }]}>{'station' in cheapest ? cheapest.station || areaLabel : areaName || 'Region-wide DOE price'}</Text>

              {/*
                Real movement only. On a first visit the screen holds exactly one
                bulletin, so there is no previous price to compare against and
                this line is simply absent -- never filled with an assumed value.
              */}
              {heroMovement ? (
                <View style={styles.heroMovement}>
                  <HeroDelta delta={heroMovement.delta} />
                  <Text numberOfLines={1} style={[styles.heroMovementNote, { color: fuelTone.onStrong }]}>
                    vs {formatShortDate(heroMovement.prevDate)} · {fuelLabel}
                  </Text>
                </View>
              ) : null}
              {isStationBrand(cheapest.slug) ? <Pressable testID="price-find-station"
                accessibilityRole="button" accessibilityLabel={`Find nearby ${cheapest.brand} stations`}
                onPress={() => {
                  if (!isStationBrand(cheapest.slug)) return;
                  setNearbySearch({ brand: cheapest.slug, brandName: cheapest.brand,
                    priceContext: cheapest.source === 'community'
                      ? `The verified price is reported at ${cheapest.station}. Other branch prices may differ.`
                      : `${fuelLabel} DOE estimate for ${areaName || regionLabel}. Branch prices may differ.` });
                }}
                style={({ pressed }) => [styles.findStation, pressed && styles.pressed]}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={18} color={colors.navy} />
                <Text style={styles.findStationText}>Find nearby stations</Text>
                <MaterialCommunityIcons name="arrow-right" size={17} color={colors.navy} />
              </Pressable> : null}
            </View>
          ) : <View testID="prices-empty" style={[styles.priceEmpty, fuelCardSurface, isDesktop && styles.overviewCard]}>
            <MaterialCommunityIcons name="gas-station-outline" size={28} color={GasTaColors.forest} />
            <Text style={styles.priceEmptyTitle}>No trusted price available</Text>
            <Text style={styles.priceEmptyBody}>You can still find nearby stations and plan your drive.</Text>
            <Pressable testID="price-find-station" accessibilityRole="button" accessibilityLabel="Find nearby stations without price data"
              onPress={() => setNearbySearch({ brand: 'all', brandName: 'All companies',
                priceContext: `No DOE price is available for ${fuelLabel} in ${areaName || regionLabel}. You can still choose a station and plan your drive.` })}
              style={({ pressed }) => [styles.findStation, styles.findStationEmpty, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="map-marker-radius-outline" size={18} color={colors.navy} />
              <Text style={styles.findStationText}>Find nearby stations</Text>
              <MaterialCommunityIcons name="arrow-right" size={17} color={colors.navy} />
            </Pressable>
          </View>}

          {/*
            Price range, computed from the very same rows the list renders below.
            Needs at least two valid prices, otherwise there is no spread to
            describe.
          */}
          {priceRange ? (
            <View testID="price-range-card" style={[styles.rangeCard, isDesktop && styles.overviewCard]}>
              <View style={styles.rangeToolbar}>
              <Pressable testID="price-range-toggle" accessibilityRole="button"
                accessibilityLabel={rangeExpanded ? 'Hide price range' : 'Show price range'}
                accessibilityState={{ expanded: rangeExpanded }} aria-expanded={rangeExpanded}
                aria-controls="price-range-details" onPress={() => setRangeExpanded((expanded) => !expanded)}
                hitSlop={4} style={({ pressed }) => [styles.rangeHead, pressed && styles.pressed]}>
                <Text style={styles.rangeTitle}>Price range</Text>
                <View style={styles.rangeAction}>
                  <MaterialCommunityIcons name={rangeExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={GasTaColors.forest} />
                </View>
              </Pressable>
              <Text style={styles.doeInfoBody}>DOE prices are area or regional estimates. Station prices may differ.</Text>
              </View>
              {rangeExpanded ? <View nativeID="price-range-details" testID="price-range-details" style={styles.rangeDetails}>
              <Text style={styles.rangeCount}>{priceRange.count} listed</Text>
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
                <View style={[styles.rangeTrack, { backgroundColor: GasTaColors.glassBorderSubtle }]} />
                <View style={[styles.rangeDot, { left: 0, backgroundColor: GasTaColors.textMuted }]} />
                <View style={[styles.rangeDot, { right: 0, backgroundColor: GasTaColors.textMuted }]} />
              </View>
              </View> : null}
            </View>
          ) : null}
          </View>

          {view === 'history' ? trendSection : null}

          {!priceRange ? <View style={styles.doeInfoStrip}>
            <Text style={styles.doeInfoBody}>DOE prices are area or regional estimates. Station prices may differ.</Text>
          </View> : null}
          <View style={styles.listHead}>
            <Text style={styles.sectionTitle}>Official DOE Prices</Text>
          </View>

          {officialRows.areaRows.length === 0 ? (
            <Text style={styles.emptyLine}>
              No DOE prices for these filters. Try another area or fuel type.
            </Text>
          ) : (
            <StationPriceTable
              rows={officialRows.stationRows}
              areaRows={officialRows.areaRows}
              fuelType={fuelType}
              region={region}
              selectedArea={areaName}
            />
          )}

          <View style={styles.communitySection}>
            <View style={styles.listHead}>
              <View style={styles.communityHeading}>
                <Text style={styles.sectionTitle}>Community Station Reports</Text>
                <Text style={styles.sourceDescription}>
                  User-observed station prices, separate from the official DOE baseline.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View all community reports"
                onPress={() => router.push('/(tabs)/prices/community')}
                style={({ pressed }) => [styles.reportCta, pressed && styles.pressed]}>
                <Text style={styles.reportCtaText}>
                  View all{communityForFuel.length > 0 ? ` (${communityForFuel.length})` : ''}
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.communityFilters}>
              {COMMUNITY_RECENCY_OPTIONS.map((option) => {
                const active = communityRecency === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setCommunityRecency(option.value)}
                    style={[styles.communityChip, active && styles.communityChipActive]}>
                    <Text style={[styles.communityChipText, active && styles.communityChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {communityForFuel.length === 0 ? (
              <View style={styles.communityEmpty}>
                <MaterialCommunityIcons
                  name="map-marker-off-outline"
                  size={24}
                  color={GasTaColors.textSoft}
                />
                <View style={styles.communityEmptyCopy}>
                  <Text style={styles.emptyTitle}>No reports in this period</Text>
                  <Text style={styles.emptyLine}>
                    Try another recency filter or report a price you saw at a station.
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.communityCards, { borderColor: GasTaColors.glassBorderSubtle }]}>
                {communityForFuel.slice(0, 4).map((report, index) => {
                  const isVerified = report.status === 'verified';
                  // Historical = older than the 7-day recommendation freshness
                  // window (verified_at, not created_at): readable for
                  // monitoring, but never labelled as a current price input.
                  const isHistorical = isHistoricalCommunityReport(report);
                  const statusLabel = communityStatusLabel(report, isHistorical);
                  const canConfirm =
                    Boolean(user) &&
                    report.status === 'pending' &&
                    report.reported_by !== user?.id &&
                    !confirmedIds.has(report.id);
                  return (
                    <View
                      key={report.id}
                      testID="fuel-price-report-card"
                      style={[
                        styles.communityCard,
                        index > 0 && styles.communityCardDivider,
                      ]}>
                      <View style={styles.communityCardTop}>
                        <BrandMark
                          brand={report.station?.brand_label ?? report.station?.oil_company?.name}
                          slug={report.station?.oil_company?.slug}
                          stationName={report.station?.name}
                          size="md"
                        />
                        <View style={styles.communityCardMain}>
                          <Text numberOfLines={1} style={styles.communityStation}>
                            {report.station?.name ?? 'Station'}
                          </Text>
                          <View style={styles.communityFuelMeta}><FuelTypeBadge fuelCode={report.fuel_type?.code} label={report.fuel_type?.name} />
                          <Text style={styles.communityMeta}>
                            {formatRelativeReportAge(report.created_at)}
                            {isHistorical ? ` · ${formatDate(report.created_at)}` : ''}
                          </Text></View>
                        </View>
                        <Text style={styles.communityPrice}>
                          {formatCurrency(report.reported_price)}
                          <Text style={styles.verifyUnit}>/L</Text>
                        </Text>
                      </View>
                      <View style={styles.communityBadgeRow}>
                        <View style={[styles.communityBadge, isVerified && styles.communityBadgeVerified]}>
                          <MaterialCommunityIcons
                            name={isVerified ? 'shield-check' : 'clock-outline'}
                            size={11}
                            color={isVerified ? GasTaColors.forest : '#9A6700'}
                          />
                          <Text style={[styles.communityBadgeText, isVerified && styles.communityBadgeTextVerified]}>
                            {statusLabel}
                          </Text>
                        </View>
                        <Text style={styles.communityConfirmations}>
                          {usersConfirmedLabel(report.confirmation_count)}
                        </Text>
                        {canConfirm ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Confirm the price at ${
                              report.station?.name ?? 'this station'
                            }`}
                            disabled={confirmingId === report.id}
                            onPress={() => handleConfirmPrice(report)}
                            style={({ pressed }) => [
                              styles.inlineConfirm,
                              pressed && styles.pressed,
                              confirmingId === report.id && styles.voteBtnBusy,
                            ]}>
                            <Text style={styles.inlineConfirmText}>
                              {confirmingId === report.id ? 'Confirming…' : 'Confirm'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
          {view === 'now' ? trendSection : null}
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
      <Text style={[styles.heroDeltaText, { color: down ? palette.success : '#B42318' }]}>
        {down ? '↓' : '↑'} {formatCurrency(Math.abs(delta))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fuelContext: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, flexShrink: 1 },
  contextDot: { width: 6, height: 6, borderRadius: 3 },
  contextText: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  flex: { flex: 1, backgroundColor: GasTaColors.cream },
  pressed: { opacity: 0.7 },
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  controlsPanel: { backgroundColor: colors.primarySoft, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: colors.primaryBorder },
  filterSummary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterSummaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  filterSummaryScope: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterSummaryFuel: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: GasTaColors.textPrimary },
  filterSummaryRegion: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: GasTaColors.textMuted },
  filterSummaryMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  filterSummaryArea: { flexShrink: 1, fontSize: 11, lineHeight: 16, color: GasTaColors.textMuted },
  coverageInfoButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  coverageSheet: { padding: 24, paddingBottom: 32, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: GasTaColors.white, gap: 12 },
  coverageTitle: { fontSize: 18, fontWeight: '700', color: GasTaColors.textPrimary },
  coverageBody: { fontSize: 14, lineHeight: 22, color: GasTaColors.textMuted },
  filterSummaryAction: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  filterSummaryActionActive: { backgroundColor: colors.primaryDark },
  filterSummaryActionText: { fontSize: 12, fontWeight: '700', color: colors.navy },
  filterDetails: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GasTaColors.glassBorderSubtle },
  filtersHidden: { display: 'none' },
  filterDone: { alignSelf: 'flex-end', minWidth: 72, minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  fuelShortcuts: { flexDirection: 'row', gap: 6, marginBottom: 12, alignItems: 'center' },
  fuelChip: { flex: 1, minWidth: 0, minHeight: 36, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, backgroundColor: GasTaColors.white },
  fuelChipText: { fontSize: 11, fontWeight: '600', color: GasTaColors.textMuted },
  moreFuelField: { flex: 1.5 },
  moreFuelLabelCompact: { fontSize: 10 },
  moreFuelFieldCompact: { flexGrow: 0, flexShrink: 0, flexBasis: 88, width: 88 },
  moreFuelControl: { minHeight: 36, borderRadius: 10, paddingHorizontal: 6, gap: 2 },
  fuelOptionDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  communityFuelMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 },
  heroScopeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 18 },
  heroScope: { color: GasTaColors.white, fontSize: 12, lineHeight: 18 },
  trendSection: { marginTop: 24, gap: 12 },
  priceEmpty: { marginTop: 16, padding: 20, borderRadius: 22, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, gap: 10 },
  priceEmptyTitle: { color: GasTaColors.textPrimary, fontSize: 18, fontWeight: '700' },
  priceEmptyBody: { color: GasTaColors.textMuted, fontSize: 13, lineHeight: 20 },
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
  /* ---- location status ---- */
  nearMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  nearMeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
  },
  nearMeAction: {
    fontSize: 11,
    fontWeight: '800',
    color: GasTaColors.forest,
  },
  /* ---- history placeholder ---- */
  historyNote: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  historyNoteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: GasTaColors.textSoft,
  },
  historyNoteBody: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: GasTaColors.textMuted,
    marginTop: 2,
  },
  headerAction: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },

  /* ---- view toggle ---- */
  viewToggle: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: GasTaColors.cream, marginBottom: 12 },
  viewToggleItem: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9 },
  viewToggleItemActive: { backgroundColor: GasTaColors.forestDark },
  viewToggleText: { fontSize: 12, fontWeight: '600', color: GasTaColors.textMuted },
  viewToggleTextActive: { color: GasTaColors.white },

  /* ---- compact filters ---- */
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 8,
  },
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
  /* Consistent neutral icon fills keep the controls visually quiet. */
  filterIconRegion: { backgroundColor: GasTaColors.forestGlow },
  filterIconCity: { backgroundColor: GasTaColors.forestGlow },
  filterIconFuel: { backgroundColor: GasTaColors.forestGlow },
  filterLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
  },
  filterControl: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    backgroundColor: GasTaColors.white,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  filterValue: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: GasTaColors.textPrimary,
  },
  filterBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(25, 45, 66, 0.45)',
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
  filterLoadingText: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    fontSize: 14,
    textAlign: 'center',
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
  overviewRow: {},
  overviewRowDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  overviewCard: { flex: 1, minWidth: 0 },
  findStation: { marginTop: 18, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 8 },
  findStationEmpty: { marginTop: 4, backgroundColor: colors.primarySoft },
  findStationText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.navy },
  heroCard: {
    borderWidth: 1,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8,
    marginTop: spacing.md,
    padding: 20,
    borderRadius: 26,
    backgroundColor: GasTaColors.forestDark,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  heroLabel: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: GasTaColors.white,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
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
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1.6,
    color: GasTaColors.white,
    flexShrink: 1,
  },
  heroUnit: {
    fontSize: 16,
    fontWeight: '700',
    color: GasTaColors.white,
  },
  heroStation: {
    fontSize: 14,
    fontWeight: '600',
    color: GasTaColors.white,
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
  heroDeltaDown: { backgroundColor: palette.successSoft },
  heroDeltaUp: { backgroundColor: '#FFF1F0' },
  heroDeltaText: { fontSize: 13, fontWeight: '800' },
  heroDeltaFlat: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.white,
  },
  heroDeltaFlatText: {
    fontSize: 12,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  heroMovementNote: {
    flex: 1,
    fontSize: 11,
    color: GasTaColors.white,
  },

  /* ---- price range ---- */
  rangeCard: { marginTop: 12, backgroundColor: GasTaColors.cream },
  rangeToolbar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rangeHead: { minHeight: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, backgroundColor: GasTaColors.white, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rangeAction: { flexDirection: 'row', alignItems: 'center' },
  rangeDetails: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, gap: 8 },
  rangeTitle: { fontSize: 11, fontWeight: '600', color: GasTaColors.textPrimary },
  rangeCount: {
    fontSize: 10,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  rangeEnds: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 10,
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
    borderColor: GasTaColors.glassBorderSubtle,
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
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: GasTaColors.textPrimary,
  },
  sectionTitleTop: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: GasTaColors.textPrimary,
    marginTop: spacing.xl,
  },
  confirmHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  confirmTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: GasTaColors.textPrimary,
  },
  reportCta: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.creamLight,
  },
  reportCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  communitySection: {
    marginTop: spacing.md,
    paddingTop: 0,
    borderTopWidth: 0,
    borderTopColor: GasTaColors.forestGlow,
  },
  communityHeading: { flex: 1, minWidth: 0 },
  sourceDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 3,
  },
  doeInfoStrip: { marginTop: 12 },
  doeInfoBody: { flex: 1, minWidth: 0, color: GasTaColors.textMuted, fontSize: 11, lineHeight: 16 },
  doeInfoLead: { fontWeight: '500' },
  communityFilters: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.sm,
    paddingRight: spacing.sm,
  },
  communityChip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
  },
  communityChipActive: {
    borderColor: GasTaColors.forestDark,
    backgroundColor: GasTaColors.forest,
  },
  communityChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  communityChipTextActive: { color: GasTaColors.textOnForest },
  communityCards: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.creamLight,
  },
  communityCard: {
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  communityCardDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestGlow,
  },
  communityCardVerified: {
    backgroundColor: GasTaColors.white,
  },
  communityCardPending: {
    backgroundColor: 'rgba(180, 83, 9, 0.06)',
  },
  communityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  communityCardMain: { flex: 1, minWidth: 0 },
  communityStation: {
    fontSize: 13,
    fontWeight: '800',
    color: GasTaColors.textPrimary,
  },
  communityMeta: {
    fontSize: 11,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  communityPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  communityBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 4,
  },
  communityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(180, 83, 9, 0.12)',
  },
  communityBadgeVerified: { backgroundColor: GasTaColors.forestGlow },
  communityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9A6700',
  },
  communityBadgeTextVerified: { color: GasTaColors.forest },
  communityConfirmations: {
    fontSize: 10,
    color: GasTaColors.textSoft,
  },
  inlineConfirm: {
    marginLeft: 'auto',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
  },
  inlineConfirmText: {
    fontSize: 10,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  communityEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.creamLight,
  },
  communityEmptyCopy: { flex: 1, minWidth: 0 },

  /* ---- flat row lists ---- */
  plainListTight: {
    backgroundColor: GasTaColors.creamLight,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
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
    minHeight: 76,
    paddingVertical: spacing.sm,
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
  /* Quiet, informative panel -- not an error and not a warning banner. */
  emptyCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
  },
  emptyCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  emptyCardBody: {
    fontSize: 13,
    lineHeight: 20,
    color: GasTaColors.textPrimary,
    marginTop: 4,
  },
  emptyCardHint: {
    fontSize: 12,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: 6,
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
