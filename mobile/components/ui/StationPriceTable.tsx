import { useEffect, useState } from 'react';
import ReportStationSelector, { type ReportStationContext } from '@/components/ReportStationSelector';
import CompanyEstimateCard from '@/components/ui/CompanyEstimateCard';
import OfficialStationDirectory from '@/components/OfficialStationDirectory';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import BrandMark from '@/components/ui/BrandMark';

export type StationPriceRow = {
  id: string;
  slug: string;
  brand: string;
  station: string;
  price: number | null;
  source: 'community' | 'doe' | 'none';
  status?: string;
};

export type AreaPriceRow = {
  id: string;
  slug: string;
  brand: string;
  areaName: string;
  price: number | null;
  source: 'doe_area';
  status?: string;
};

type Props = {
  rows: StationPriceRow[];
  areaRows?: AreaPriceRow[];
  fuelType?: string;
  region?: string;
  selectedArea?: string;
};

const PRICE_FOREST = GasTaColors.forestDark;
const PRICE_GREEN = GasTaColors.forest;
const PRICE_GREEN_SOFT = GasTaColors.forestGlow;
const PRICE_GREEN_BORDER = GasTaColors.forestBorder;

type StatusPresentation = {
  backgroundColor: string;
  color: string;
  icon: 'shield-check' | 'clock-outline' | 'file-document-outline';
};

function statusPresentation(status?: string): StatusPresentation | null {
  if (status === 'Verified') {
    return { backgroundColor: PRICE_GREEN_SOFT, color: PRICE_GREEN, icon: 'shield-check' };
  }
  if (status === 'Unverified') {
    return { backgroundColor: palette.warningSoft, color: '#9A6700', icon: 'clock-outline' };
  }
  if (
    status === 'DOE estimate' ||
    status === 'Official DOE Price' ||
    status === 'DOE Area/Brand Estimate' ||
    status === 'DOE Region-Wide Estimate'
  ) {
    return {
      backgroundColor: GasTaColors.forestGlow,
      color: PRICE_FOREST,
      icon: 'file-document-outline',
    };
  }
  return null;
}

export default function StationPriceTable({
  rows,
  areaRows = [],
  fuelType,
  region,
  selectedArea,
}: Props) {
  const router = useRouter();
  const filterKey = JSON.stringify([region ?? '', selectedArea ?? '', fuelType ?? '']);
  const [unavailableScope, setUnavailableScope] = useState<string | null>(null);
  const showUnavailable = unavailableScope === filterKey;
  useEffect(() => { setUnavailableScope(null); }, [filterKey]);
  const hasPrice = (row: AreaPriceRow) => typeof row.price === 'number' && Number.isFinite(row.price);
  const availableRows = areaRows.filter(hasPrice);
  const unavailableRows = areaRows.filter((row) => !hasPrice(row));
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  useEffect(() => { setExpandedCompany(null); }, [region, selectedArea, fuelType]);
  const [reportContext, setReportContext] = useState<ReportStationContext | null>(null);
  const reportFor = (params: Record<string, string>) => {
    router.push({
      pathname: '/(tabs)/prices/report',
      params,
    });
  };
  const lowestStationPrice = rows.reduce<number | null>((lowest, row) => {
    if (row.price == null) return lowest;
    return lowest == null || row.price < lowest ? row.price : lowest;
  }, null);

  if (rows.length === 0 && areaRows.length === 0) {
    return (
      <Text style={styles.empty}>
        No DOE prices for these filters. Try another area or fuel type.
      </Text>
    );
  }

  const renderCompany = (row: AreaPriceRow) => {
    const reportCompany = () => setReportContext({
      company: row.brand, slug: row.slug,
      area: selectedArea ?? (row.areaName === region || row.areaName === 'Region-wide DOE price' ? '' : row.areaName),
      region: region ?? '', fuelType: fuelType ?? '',
      doeContext: row.status ?? 'DOE Area/Brand Estimate',
    });
    if (row.slug === 'seaoil') {
      return <OfficialStationDirectory key={row.id}
        selectedRegion={region}
        selectedArea={selectedArea ?? (row.areaName === region ? '' : row.areaName)}
        doeSummary={{ price: hasPrice(row) ? row.price : null, sourceLabel: row.status ?? 'DOE Area/Brand Estimate' }}
        unavailableLabel={`No available price in this ${selectedArea ? 'area' : 'region'}`}
        expanded={expandedCompany === row.slug}
        onToggle={() => setExpandedCompany((current) => current === row.slug ? null : row.slug)}
        onReport={reportCompany} />;
    }
    return <CompanyEstimateCard key={row.id}
      company={row.brand} slug={row.slug} price={hasPrice(row) ? row.price : null}
      unavailableLabel={`No available price in this ${selectedArea ? 'area' : 'region'}`}
      sourceLabel={row.status ?? 'DOE Area/Brand Estimate'}
      expanded={expandedCompany === row.slug}
      onToggle={() => setExpandedCompany((current) => current === row.slug ? null : row.slug)}
      onReport={reportCompany}>
      <Text style={styles.directoryTitle}>Station directory</Text>
      <Text style={styles.directoryCopy}>Official branch directory not available yet.</Text>
      <Text style={styles.directoryCopy}>You can still report a price for a known station.</Text>
    </CompanyEstimateCard>;

  };

  return (
    <>
    <View style={rows.length ? styles.list : undefined}>
      {/*
        Flat rows: logo, station name, price right-aligned, source/status
        underneath. No column header row -- "Brand / Station / Price" repeats
        what each row already says and costs a full line of vertical space.
      */}
      {rows.map((row, index) => {
        const statusStyle = statusPresentation(row.status);
        const isBestPrice =
          row.source === 'community' &&
          row.price != null &&
          row.price === lowestStationPrice;
        const isLast = index === rows.length - 1 && areaRows.length === 0;
        return (
          <View
            key={row.id}
            style={[
              styles.row,
              !isLast && styles.divider,
              // Pending community rows get a warm cast so an unconfirmed price
              // never sits in the same visual register as a settled one.
              row.status === 'Unverified' && styles.unverifiedRow,
              isBestPrice && styles.bestRow,
            ]}>
            <BrandMark brand={row.brand} slug={row.slug} stationName={row.station} size="sm" />

            <View style={styles.rowMain}>
              <Text style={styles.station} numberOfLines={1}>
                {row.station}
              </Text>
              <View style={styles.metaRow}>
                {isBestPrice ? (
                  <View style={styles.bestTag}>
                    <MaterialCommunityIcons
                      name="tag-check-outline"
                      size={10}
                      color={GasTaColors.forestDark}
                    />
                    <Text style={styles.bestTagText}>Best price</Text>
                  </View>
                ) : null}
                {statusStyle ? (
                  <View style={[styles.statusPill, { backgroundColor: statusStyle.backgroundColor }]}>
                    <MaterialCommunityIcons
                      name={statusStyle.icon}
                      size={10}
                      color={statusStyle.color}
                    />
                    <Text style={[styles.statusText, { color: statusStyle.color }]}>
                      {row.status}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.rowRight}>
              <Text style={[styles.price, isBestPrice && styles.priceBest]}>
                {row.price != null ? formatCurrency(row.price) : '—'}
                {row.price != null ? <Text style={styles.priceUnit}>/L</Text> : null}
              </Text>
              {row.source === 'doe' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Report a price at ${row.station}`}
                  hitSlop={6}
                  onPress={() =>
                    reportFor({
                      station_id: row.id,
                      station_name: row.station,
                      brand: row.brand,
                      ...(fuelType ? { fuel_type: fuelType } : {}),
                      ...(region ? { region } : {}),
                    })
                  }
                  style={({ pressed }) => [
                    styles.reportButton,
                    pressed && styles.reportButtonPressed,
                  ]}>
                  <MaterialCommunityIcons
                    name="map-marker-plus-outline"
                    size={12}
                    color={GasTaColors.forest}
                  />
                  <Text style={styles.reportButtonText}>Report here</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}

    </View>
      {/* Exact DOE company cards remain separate from branch observations. */}
      {areaRows.length > 0 ? (
        <View style={styles.companySection}>
          {!availableRows.length ? <Text style={styles.noPrices}>No DOE prices available for this {selectedArea ? 'area' : 'region'}</Text> : null}
          <View style={styles.companyStack}>{availableRows.map(renderCompany)}</View>
          {unavailableRows.length ? <>
            <Pressable accessibilityRole="button"
              accessibilityLabel={showUnavailable ? 'Hide companies without available prices' : availableRows.length ? 'Show companies without available prices' : 'View supported companies'}
              accessibilityState={{ expanded: showUnavailable }}
              onPress={() => { setUnavailableScope(showUnavailable ? null : filterKey); setExpandedCompany(null); }}
              style={({ pressed }) => [styles.disclosure, pressed && { opacity: 0.7 }]}>
              <Text style={styles.disclosureText}>{showUnavailable ? 'Hide companies without available prices' : availableRows.length ? `Show companies without available prices (${unavailableRows.length})` : `View supported companies (${unavailableRows.length})`}</Text>
              <MaterialCommunityIcons name={showUnavailable ? 'chevron-up' : 'chevron-down'} size={18} color={GasTaColors.forest} />
            </Pressable>
            {showUnavailable ? <View style={styles.companyStack}>{unavailableRows.map(renderCompany)}</View> : null}
          </> : null}
        </View>
      ) : null}
    <ReportStationSelector context={reportContext} onClose={() => setReportContext(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  companySection: { gap: spacing.sm, marginBottom: spacing.md },
  companyStack: { gap: spacing.sm },
  noPrices: { color: GasTaColors.forestMuted, fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.xs, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: GasTaColors.forestBorder, backgroundColor: GasTaColors.creamLight },
  disclosureText: { flex: 1, color: GasTaColors.forest, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  directoryTitle: { fontSize: 14, fontWeight: '600', color: GasTaColors.forestDark },
  directoryCopy: { fontSize: 12, lineHeight: 18, color: GasTaColors.forestMuted },
  /*
   * A grouped ledger rather than a stack of white cards. The section surface is
   * a warm creamLight so the page keeps its cream identity; white is reserved
   * for contrast moments instead of being the default.
   */
  list: {
    backgroundColor: GasTaColors.creamLight,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestGlow,
  },
  /* Best price: a very subtle pale-green cast, not a filled badge. */
  bestRow: {
    backgroundColor: 'rgba(46, 125, 50, 0.09)',
  },
  /* Pending community data reads warm, so it can never be mistaken for a
     settled figure. */
  unverifiedRow: {
    backgroundColor: 'rgba(180, 83, 9, 0.07)',
  },
  rowMain: { flex: 1, minWidth: 0 },
  station: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    color: GasTaColors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  bestTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(46, 125, 50, 0.16)',
  },
  bestTagText: {
    color: '#1B5E20',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.pill,
  },
  statusText: { fontSize: 9, fontWeight: '800' },
  price: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: GasTaColors.forestDark,
  },
  priceBest: { color: '#1B5E20' },
  priceUnit: { fontSize: 10, fontWeight: '700', opacity: 0.7 },
  rowRight: {
    minWidth: 88,
    alignItems: 'flex-end',
  },

  /* ---- DOE area rows, same list language ---- */
  areaRow: { backgroundColor: GasTaColors.cream },
  areaSub: {
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  areaRight: {
    minWidth: 78,
    alignItems: 'flex-end',
  },
  areaPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: GasTaColors.textMuted,
  },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.white,
  },
  reportButtonPressed: {
    backgroundColor: GasTaColors.forestGlow,
  },
  reportButtonText: {
    fontSize: 10,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  empty: {
    fontSize: 13,
    lineHeight: 19,
    color: GasTaColors.textSoft,
    paddingVertical: spacing.lg,
  },
});
