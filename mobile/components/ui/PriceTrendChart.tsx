import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';

export type TrendPoint = {
  bulletin_date: string;
  price_per_liter: number;
};

type Props = {
  points: TrendPoint[];
  /** Shown in the caption, e.g. "RON 91 · Petron". */
  caption?: string;
  /** Chart body height. The whole block stays compact. */
  height?: number;
  downColor?: string;
  upColor?: string;
};

/**
 * A compact DOE price-trend chart built from plain Views.
 *
 * There is no chart library and no `react-native-svg` in this project, so this
 * is drawn with absolutely-positioned segments rather than pulling in a
 * dependency. It renders exactly the points it is given -- it never invents,
 * smooths, or interpolates values.
 *
 * Chronology is preserved as given; callers pass the series oldest -> newest.
 */
export default function PriceTrendChart({
  points,
  caption,
  height = 132,
  downColor = GasTaColors.forest,
  upColor = '#E0533D',
}: Props) {
  // Two points is the minimum that describes movement at all.
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Not enough history yet</Text>
        <Text style={styles.emptyBody}>
          DOE bulletins build up over time. Once a second week is loaded, the real price trend
          appears here.
        </Text>
      </View>
    );
  }

  const values = points.map((p) => p.price_per_liter);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a nominal band so the line sits
  // mid-height instead of collapsing to an edge.
  const span = max - min || 0.5;
  const rangeLo = min - span * 0.18;
  const rangeHi = max + span * 0.18;
  const rangeSpan = rangeHi - rangeLo || 1;

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const direction = delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat';
  const lineColor =
    direction === 'down' ? downColor : direction === 'up' ? upColor : GasTaColors.forestMuted;

  const y = (value: number) => height - ((value - rangeLo) / rangeSpan) * height;

  // Cap the rendered point count so a long series stays readable at phone
  // widths rather than turning into a smear.
  const MAX_SEGMENTS = 40;
  const stride = Math.max(1, Math.ceil((points.length - 1) / MAX_SEGMENTS));
  const sampled = points.filter((_, i) => i % stride === 0 || i === points.length - 1);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  const segments: { key: string; left: number; width: number; top: number; angle: number }[] = [];
  for (let i = 0; i < sampled.length - 1; i += 1) {
    const x1 = (i / (sampled.length - 1)) * 100;
    const x2 = ((i + 1) / (sampled.length - 1)) * 100;
    const y1 = y(sampled[i].price_per_liter);
    const y2 = y(sampled[i + 1].price_per_liter);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) continue;
    segments.push({
      key: `seg-${i}`,
      left: x1,
      width: length,
      top: (y1 + y2) / 2,
      // Degrees, clockwise, matching the y-down screen axis.
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }

  const lastY = y(last);

  return (
    <View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}

      <View style={styles.plotRow}>
        <View style={styles.axis}>
          <Text style={styles.axisText}>{formatCurrency(max)}</Text>
          <Text style={styles.axisText}>{formatCurrency(min)}</Text>
        </View>

        <View style={[styles.plot, { height }]}>
          {/* Deliberately axis-light: two faint lines read magnitude without a
              full grid. */}
          <View style={[styles.guide, { top: 0 }]} />
          <View style={[styles.guide, styles.guideMid, { top: height / 2 }]} />
          <View style={[styles.guide, { bottom: 0 }]} />

          {segments.map((seg) => (
            <View
              key={seg.key}
              style={[
                styles.segment,
                {
                  left: `${seg.left}%`,
                  top: seg.top - 1,
                  width: seg.width,
                  backgroundColor: lineColor,
                  transform: [{ rotate: `${seg.angle}deg` }],
                },
              ]}
            />
          ))}

          {/* `left: 100%` would hang off the plot, so the endpoint dot is pulled
              back by its own width and nudged above the line. */}
          <View
            style={[styles.endDot, { left: '100%', top: lastY, backgroundColor: lineColor }]}
          />
        </View>
      </View>

      <View style={styles.xAxis}>
        <Text style={styles.xText}>{formatShortWeek(points[0].bulletin_date)}</Text>
        <Text style={styles.xText}>
          {formatShortWeek(points[points.length - 1].bulletin_date)}
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerLabel}>
          {points.length} {points.length === 1 ? 'bulletin' : 'bulletins'}
          {caption ? ` · ${caption}` : ''}
        </Text>
        <MovementTag delta={delta} />
      </View>
    </View>
  );
}

/** Arrow + value, never colour alone, so the meaning survives without hue. */
function MovementTag({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.005) {
    return (
      <View style={[styles.moveTag, { backgroundColor: GasTaColors.creamLight }]}>
        <Text style={[styles.moveText, { color: GasTaColors.textMuted }]}>No change</Text>
      </View>
    );
  }
  const down = delta < 0;
  return (
    <View
      style={[
        styles.moveTag,
        { backgroundColor: down ? GasTaColors.forestGlow : 'rgba(224, 83, 61, 0.12)' },
      ]}>
      <Text style={[styles.moveText, { color: down ? GasTaColors.forestDark : '#B03A24' }]}>
        {down ? '↓' : '↑'} {formatCurrency(Math.abs(delta))}
      </Text>
    </View>
  );
}

function formatShortWeek(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
}
const styles = StyleSheet.create({
  caption: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
    marginBottom: spacing.sm,
  },
  plotRow: { flexDirection: 'row', alignItems: 'stretch' },
  axis: {
    width: 46,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  axisText: {
    fontSize: 9,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  plot: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  guide: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.forestGlow,
  },
  guideMid: { backgroundColor: GasTaColors.forestBorder },
  segment: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    // Rotate about the segment's own left edge so consecutive segments join
    // cleanly instead of pivoting around their centres.
    transformOrigin: 'left center',
  },
  endDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    marginLeft: -5,
    marginTop: -4,
    borderWidth: 2,
    borderColor: GasTaColors.creamLight,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginLeft: 46,
  },
  xText: {
    fontSize: 9,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  footerLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  moveTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  moveText: { fontSize: 11, fontWeight: '800' },
  empty: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
    marginBottom: 2,
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
  },
});