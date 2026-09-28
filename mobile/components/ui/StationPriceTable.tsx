import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { getBrandLogo } from '@/constants/brandLogos';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';

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

/*
 * Accent tints for the brand mark when a station has no logo file. These are
 * UI-only decorative colours (the fallback gas-station glyph and the dashed
 * frame), not brand artwork -- the actual logos in `brandLogos` are untouched.
 */
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

const PRICE_FOREST = GasTaColors.forestDark;
const PRICE_GREEN = GasTaColors.forest;
const PRICE_GREEN_SOFT = GasTaColors.forestGlow;
const PRICE_GREEN_BORDER = GasTaColors.forestBorder;

type StatusPresentation = {
  backgroundColor: string;
  color: string;
  icon: 'shield-check' | 'clock-outline' | 'file-document-outline';
};

function brandColor(brand: string): string {
  const key = brand.trim().toLowerCase();
  return BRAND_COLOR[key] ?? PRICE_FOREST;
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
      color: PRICE_FOREST,
      icon: 'file-document-outline',
    };
  }
  return null;
}

export default function StationPriceTable({ rows, areaRows = [] }: Props) {
  const router = useRouter();
  const lowestStationPrice = rows.reduce<number | null>((lowest, row) => {
    if (row.price == null) return lowest;
    return lowest == null || row.price < lowest ? row.price : lowest;
  }, null);

  if (rows.length === 0 && areaRows.length === 0) {
    return (
      <Text style={styles.empty}>
        No stations for this filter yet. Report a price at a named station to list it here.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {/*
        Flat rows: logo, station name, price right-aligned, source/status
        underneath. No column header row -- "Brand / Station / Price" repeats
        what each row already says and costs a full line of vertical space.
      */}
      {rows.map((row, index) => {
        const accent = brandColor(row.brand);
        const logo = getBrandLogo(row.slug);
        const statusStyle = statusPresentation(row.status);
        const isBestPrice = row.price != null && row.price === lowestStationPrice;
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
            <View style={styles.logoWrap}>
              {logo ? (
                <Image
                  source={logo}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel={`${row.brand} logo`}
                />
              ) : (
                <MaterialCommunityIcons name="gas-station" size={17} color={accent} />
              )}
            </View>

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

            <Text style={[styles.price, isBestPrice && styles.priceBest]}>
              {row.price != null ? formatCurrency(row.price) : '—'}
              {row.price != null ? <Text style={styles.priceUnit}>/L</Text> : null}
            </Text>
          </View>
        );
      })}

      {/*
        DOE area rows reuse the same row language as the station rows so they
        read as a continuation of the list rather than a second competing
        table. The dashed logo frame and the note above keep the source
        distinction visible without reintroducing a section header block.
      */}
      {areaRows.length > 0 ? (
        <>
          <View style={styles.areaNote}>
            <MaterialCommunityIcons
              name="storefront-outline"
              size={13}
              color={GasTaColors.textSoft}
            />
            <Text style={styles.areaNoteText}>
              No station reported yet — DOE area price
            </Text>
          </View>
          {areaRows.map((row, index) => {
            const logo = getBrandLogo(row.slug);
            const areaLabel = row.areaName === 'All cities' ? 'All cities' : row.areaName;
            const isLast = index === areaRows.length - 1;
            return (
              <View
                key={row.id}
                style={[styles.row, !isLast && styles.divider, styles.areaRow]}>
                <View style={[styles.logoWrap, styles.logoWrapDashed]}>
                  {logo ? (
                    <Image
                      source={logo}
                      style={styles.logo}
                      resizeMode="contain"
                      accessibilityLabel={`${row.brand} logo`}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="storefront-outline"
                      size={17}
                      color={GasTaColors.textSoft}
                    />
                  )}
                </View>

                <View style={styles.rowMain}>
                  <Text style={styles.station} numberOfLines={1}>
                    {row.brand} · {areaLabel}
                  </Text>
                  <Text style={styles.areaSub} numberOfLines={1}>
                    {row.status ?? 'DOE area price'}
                  </Text>
                </View>

                <View style={styles.areaRight}>
                  <Text style={styles.areaPrice}>
                    {formatCurrency(row.price)}
                    <Text style={styles.priceUnit}>/L</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Report a price for ${row.brand}`}
                    hitSlop={6}
                    onPress={() => router.push('/(tabs)/prices/report')}
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
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  logoWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrapDashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.cream,
  },
  logo: {
    width: 26,
    height: 26,
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

  /* ---- DOE area rows, same list language ---- */
  areaNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.forestBorder,
  },
  areaNoteText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
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
