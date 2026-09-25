import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { getBrandLogo } from '@/constants/brandLogos';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';

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
  price: number;
  source: 'doe_area';
  status?: string;
};

type Props = {
  rows: StationPriceRow[];
  areaRows?: AreaPriceRow[];
};

const BRAND_COLOR: Record<string, string> = {
  seaoil: '#2E7D32',
  petron: '#2563EB',
  'flying v': '#DC2626',
  flyingv: '#DC2626',
  ptt: '#7C3AED',
  shell: '#CA8A04',
  caltex: '#EA580C',
  phoenix: '#DC2626',
  total: '#0284C7',
  unioil: '#64748B',
};

const PRICE_NAVY = '#14315C';
const PRICE_GREEN = '#2E7D32';
const PRICE_GREEN_SOFT = 'rgba(46, 125, 50, 0.10)';
const PRICE_GREEN_BORDER = 'rgba(46, 125, 50, 0.30)';

type StatusPresentation = {
  backgroundColor: string;
  color: string;
  icon: 'shield-check' | 'clock-outline' | 'file-document-outline';
};

function brandColor(brand: string): string {
  const key = brand.trim().toLowerCase();
  return BRAND_COLOR[key] ?? PRICE_NAVY;
}

function statusPresentation(status?: string): StatusPresentation | null {
  if (status === 'Verified') {
    return { backgroundColor: PRICE_GREEN_SOFT, color: PRICE_GREEN, icon: 'shield-check' };
  }
  if (status === 'Unverified') {
    return { backgroundColor: palette.warningSoft, color: '#9A6700', icon: 'clock-outline' };
  }
  if (status === 'DOE estimate') {
    return {
      backgroundColor: GasTaColors.forestGlow,
      color: PRICE_NAVY,
      icon: 'file-document-outline',
    };
  }
  return null;
}

export default function StationPriceTable({ rows, areaRows = [] }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const lowestStationPrice = rows.reduce<number | null>((lowest, row) => {
    if (row.price == null) return lowest;
    return lowest == null || row.price < lowest ? row.price : lowest;
  }, null);

  if (rows.length === 0 && areaRows.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        No stations for this filter yet. Report a price at a named station to list it here.
      </Text>
    );
  }

  return (
    <View>
      {rows.length > 0 ? (
        <>
          <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
            <Text style={[styles.headerCell, styles.brandCol, { color: theme.textSecondary }]}>
              Brand
            </Text>
            <Text style={[styles.headerCell, styles.stationCol, { color: theme.textSecondary }]}>
              Station
            </Text>
            <Text style={[styles.headerCell, styles.priceCol, { color: theme.textSecondary }]}>
              Price
            </Text>
          </View>
          {rows.map((row, index) => {
            const accent = brandColor(row.brand);
            const logo = getBrandLogo(row.slug);
            const statusStyle = statusPresentation(row.status);
            const isBestPrice = row.price != null && row.price === lowestStationPrice;
            return (
              <View
                key={row.id}
                style={[
                  styles.row,
                  index < rows.length - 1 && {
                    borderBottomColor: theme.borderLight,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                  isBestPrice && styles.bestPriceRow,
                ]}>
                <View style={[styles.brandCol, styles.brandCell]}>
                  <View style={[styles.stationIcon, { backgroundColor: `${accent}18` }]}>
                    {logo ? (
                      <Image
                        source={logo}
                        style={styles.stationLogo}
                        resizeMode="contain"
                        accessibilityLabel={`${row.brand} logo`}
                      />
                    ) : (
                      <MaterialCommunityIcons name="gas-station" size={17} color={accent} />
                    )}
                  </View>
                  <Text style={[styles.brandText, { color: theme.text }]} numberOfLines={2}>
                    {row.brand}
                  </Text>
                </View>
                <View style={styles.stationCol}>
                  <Text
                    style={[styles.stationText, { color: theme.text }]}
                    numberOfLines={2}>
                    {row.station}
                  </Text>
                  {isBestPrice ? (
                    <View style={styles.bestPriceTag}>
                      <MaterialCommunityIcons name="tag-check-outline" size={12} color={PRICE_GREEN} />
                      <Text style={styles.bestPriceTagText}>Best price</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.priceCol}>
                  <Text
                    style={[
                      styles.priceText,
                      { color: isBestPrice ? PRICE_GREEN : PRICE_NAVY },
                    ]}>
                    {row.price != null ? formatCurrency(row.price) : '—'}
                    {row.price != null ? <Text style={styles.priceUnit}>/L</Text> : null}
                  </Text>
                  {statusStyle ? (
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: statusStyle.backgroundColor },
                      ]}>
                      <MaterialCommunityIcons
                        name={statusStyle.icon}
                        size={12}
                        color={statusStyle.color}
                      />
                      <Text style={[styles.statusText, { color: statusStyle.color }]}>
                        {row.status}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      {areaRows.length > 0 ? (
        <View style={styles.areaSection}>
          <View style={[styles.areaDivider, { borderColor: theme.borderLight }]} />
          <View style={styles.areaHeading}>
            <View style={[styles.areaHeadingIcon, { backgroundColor: theme.overlay }]}>
              <MaterialCommunityIcons name="storefront-outline" size={17} color={PRICE_NAVY} />
            </View>
            <View style={styles.areaHeadingCopy}>
              <Text style={[styles.areaHeadingTitle, { color: theme.text }]}>
                No station reported yet — DOE area price
              </Text>
              <Text style={[styles.areaHeadingSubtitle, { color: theme.textSecondary }]}>
                Company-level bulletin prices for this area.
              </Text>
            </View>
          </View>
          {areaRows.map((row, index) => {
            const logo = getBrandLogo(row.slug);
            const areaLabel =
              row.areaName === 'All cities' ? 'All cities' : `${row.areaName} area`;
            return (
              <View
                key={row.id}
                style={[
                  styles.areaRow,
                  index < areaRows.length - 1 && {
                    borderBottomColor: theme.borderLight,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}>
                <View style={[styles.areaIcon, { borderColor: theme.borderLight }]}>
                  {logo ? (
                    <Image
                      source={logo}
                      style={styles.areaLogo}
                      resizeMode="contain"
                      accessibilityLabel={`${row.brand} logo`}
                    />
                  ) : (
                    <MaterialCommunityIcons name="storefront-outline" size={18} color={PRICE_NAVY} />
                  )}
                </View>
                <View style={styles.areaCopy}>
                  <Text style={[styles.areaTitle, { color: theme.text }]} numberOfLines={2}>
                    {row.brand} · {areaLabel}
                  </Text>
                  <Text style={[styles.areaSubtitle, { color: theme.textSecondary }]}>
                    {row.status ?? 'DOE area price'}
                  </Text>
                </View>
                <View style={styles.areaPriceCol}>
                  <Text style={[styles.areaPrice, { color: theme.textSecondary }]}>
                    {formatCurrency(row.price)}
                    <Text style={styles.areaPriceUnit}>/L</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report a price for ${row.brand}`}
                    hitSlop={6}
                    onPress={() => router.push('/(tabs)/prices/report')}
                    style={({ pressed }) => [styles.reportButton, pressed && styles.reportButtonPressed]}>
                    <MaterialCommunityIcons name="map-marker-plus-outline" size={14} color={PRICE_NAVY} />
                    <Text style={[styles.reportButtonText, { color: PRICE_NAVY }]}>Report here</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    backgroundColor: GasTaColors.forestGlow,
    borderRadius: radii.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 78,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    gap: spacing.sm,
  },
  bestPriceRow: {
    backgroundColor: PRICE_GREEN_SOFT,
    borderLeftWidth: 3,
    borderLeftColor: PRICE_GREEN,
    paddingLeft: spacing.sm,
  },
  brandCol: { width: '30%' },
  brandCell: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stationCol: { flex: 1, paddingHorizontal: spacing.xs },
  priceCol: { width: '31%', alignItems: 'flex-end' },
  stationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationLogo: {
    width: 30,
    height: 30,
  },
  brandText: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 16 },
  stationText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bestPriceTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.white,
  },
  bestPriceTagText: {
    color: PRICE_GREEN,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  priceText: { fontSize: 19, fontWeight: '900', letterSpacing: -0.4 },
  priceUnit: { fontSize: 11, fontWeight: '700', opacity: 0.72 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  statusText: { fontSize: 9, fontWeight: '800' },
  areaSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  areaDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    marginBottom: spacing.md,
  },
  areaHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  areaHeadingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaHeadingCopy: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  areaHeadingTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  areaHeadingSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    gap: spacing.sm,
  },
  areaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.white,
  },
  areaLogo: {
    width: 27,
    height: 27,
    opacity: 0.62,
  },
  areaCopy: {
    flex: 1,
    minWidth: 0,
  },
  areaTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  areaSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  areaPriceCol: {
    minWidth: 86,
    alignItems: 'flex-end',
  },
  areaPrice: {
    fontSize: 15,
    fontWeight: '800',
  },
  areaPriceUnit: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.72,
  },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.white,
  },
  reportButtonPressed: {
    backgroundColor: PRICE_GREEN_SOFT,
    borderColor: PRICE_GREEN_BORDER,
  },
  reportButtonText: {
    fontSize: 10,
    fontWeight: '800',
  },
  empty: { fontSize: 14, lineHeight: 20 },
});
