import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { designSystem as D, GasTaColors, radii, spacing } from '@/constants/Theme';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import { formatDoeTimelineDate } from '@/lib/doeCoverage';
import { formatCurrency } from '@/lib/format';
import { placePriceTrendLabels } from '@/components/prices/priceTrendLabels';

export type TrendPoint = {
  bulletin_date: string;
  coverage_end: string | null;
  price_per_liter: number;
};

type Props = {
  points: TrendPoint[];
  /** Shown above the chart, e.g. "RON 91 · South Luzon". */
  caption?: string;
  fuelCode?: string | null;
  /** Chart body height in pixels (excluding label headroom). */
  height?: number;
  downColor?: string;
  upColor?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of interior horizontal grid lines (top + bottom edge always drawn). */
const GRID_INTERIOR = 2;
/** Line stroke thickness. */
const LINE_H = 2;
/** Pixel space above the plot to prevent value labels being clipped. */
const LABEL_HEADROOM = 18;
/** Width of the y-axis column. */
const Y_AXIS_W = 52;

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * DOE price-trend line chart built entirely from React Native Views.
 *
 * Features: connected polyline, filled dots at every data point, price
 * collision-safe callouts prioritizing the latest value and key extremes,
 * restrained horizontal grid, y-axis ticks, and x-axis date labels.
 *
 * GEOMETRY NOTE
 * Every segment is drawn as a rotated rectangle. The correct way to do this
 * without specifying `transformOrigin` (which varies by RN version) is to
 * centre the rectangle on the segment midpoint and let RN's default
 * centre-pivot rotation handle the rest:
 *
 *   left  = cx − length / 2,   where cx = (x1 + x2) / 2
 *   top   = cy − LINE_H / 2,  where cy = (y1 + y2) / 2
 *   width = length
 *   angle = atan2(dy, dx)
 *
 * After rotation the left edge lands exactly on (x1, y1) and the right edge
 * on (x2, y2), so consecutive segments join seamlessly without gaps.
 */
export default function PriceTrendChart({
  points: allPoints,
  caption,
  fuelCode,
  height = 150,
  downColor = GasTaColors.forest,
  upColor = '#E0533D',
}: Props) {
  const points = allPoints.filter((point) => point.coverage_end != null)
    .sort((a, b) => a.coverage_end!.localeCompare(b.coverage_end!));
  const unresolvedCount = allPoints.length - points.length;
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Not enough history yet</Text>
        <Text style={styles.emptyBody}>
          {unresolvedCount ? 'Coverage dates are unavailable for some bulletins. At least two confirmed periods are needed to plot this trend.' : 'DOE bulletins build up over time. Once a second week is loaded, the real price trend appears here.'}
        </Text>
      </View>
    );
  }

  const values = points.map((p) => p.price_per_liter);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 0.5;

  // Add padding so dots never sit flush against the grid edges.
  const rangeLo = min - span * 0.15;
  const rangeHi = max + span * 0.15;
  const rangeSpan = rangeHi - rangeLo || 1;

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const direction = delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat';
  const lineColor = fuelCode != null ? getFuelTypePresentation(fuelCode).accent
    : direction === 'down' ? downColor : direction === 'up' ? upColor : GasTaColors.forestMuted;

  // Subsample long series so segments stay readable at phone widths.
  const MAX_POINTS = 40;
  const stride = Math.max(1, Math.ceil((points.length - 1) / MAX_POINTS));
  const sampled = points.filter((_, i) => i % stride === 0 || i === points.length - 1);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  // Y-axis tick values: (GRID_INTERIOR + 2) evenly spaced levels, top→bottom.
  const tickCount = GRID_INTERIOR + 2;
  const yTicks = Array.from({ length: tickCount }, (_, i) => {
    const frac = 1 - i / (tickCount - 1);
    return Math.round((rangeLo + frac * rangeSpan) * 100) / 100;
  });

  return (
    <View>
    <PlotCanvas
      sampled={sampled}
      height={height}
      rangeLo={rangeLo}
      rangeSpan={rangeSpan}
      lineColor={lineColor}
      caption={caption}
      points={points}
      delta={delta}
      min={min}
      max={max}
      yTicks={yTicks}
    />
    {unresolvedCount ? <Text accessibilityLabel={`${unresolvedCount} coverage gap${unresolvedCount === 1 ? '' : 's'}: coverage end date unavailable.`}
      style={styles.coverageMetadata}>{unresolvedCount} coverage gap{unresolvedCount === 1 ? '' : 's'} · coverage end date unavailable</Text> : null}
    </View>
  );
}

// ─── PlotCanvas ──────────────────────────────────────────────────────────────
//
// Separated component so onLayout can capture the real pixel width before any
// geometry is computed. All coordinates are in the same unit (pixels).

type PlotCanvasProps = {
  sampled: TrendPoint[];
  height: number;
  rangeLo: number;
  rangeSpan: number;
  lineColor: string;
  caption?: string;
  points: TrendPoint[];
  delta: number;
  min: number;
  max: number;
  yTicks: number[];
};

function PlotCanvas({
  sampled,
  height,
  rangeLo,
  rangeSpan,
  lineColor,
  caption,
  points,
  delta,
  min,
  max,
  yTicks,
}: PlotCanvasProps) {
  const [plotWidth, setPlotWidth] = React.useState(0);

  /** Price → pixel y (0 = top of plot area). */
  const yPx = React.useCallback(
    (v: number) => height - ((v - rangeLo) / rangeSpan) * height,
    [height, rangeLo, rangeSpan],
  );

  // Compute dot (x, y) positions in pixels once plotWidth is known.
  const dots = React.useMemo(() => {
    if (plotWidth === 0) return [];
    return sampled.map((pt, i) => ({
      x: (i / (sampled.length - 1)) * plotWidth,
      y: yPx(pt.price_per_liter),
      value: pt.price_per_liter,
      date: pt.coverage_end!,
    }));
  }, [plotWidth, sampled, yPx]);

  // ── Segments ────────────────────────────────────────────────────────────
  // Each segment is a rotated rectangle centred on the segment midpoint.
  // Default transformOrigin in React Native is 'center', so no override needed.
  //
  //   left  = cx − length / 2
  //   top   = cy − LINE_H / 2
  //
  // After rotating by angle = atan2(dy, dx), the left edge sits at (x1, y1)
  // and the right edge at (x2, y2), giving gap-free segment joins.
  const segments = React.useMemo(() => {
    if (dots.length < 2) return [];
    return dots.slice(0, -1).map((d, i) => {
      const next = dots[i + 1];
      const dx = next.x - d.x;
      const dy = next.y - d.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 0.5) return null;
      const cx = (d.x + next.x) / 2;
      const cy = (d.y + next.y) / 2;
      return {
        key: `seg-${i}`,
        left: cx - length / 2,
        top: cy - LINE_H / 2,
        width: length,
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
    }).filter(Boolean) as { key: string; left: number; top: number; width: number; angle: number }[];
  }, [dots]);

  // Reserve the latest annotation first. Remaining callouts must fit around
  // it in both axes; horizontal distance alone misses early clamped collisions.
  const valueLabels = React.useMemo(() => placePriceTrendLabels(dots, plotWidth, height + 12,
    Math.max(52, ...dots.map(dot => formatCurrency(dot.value).length * 7)), 16, LABEL_HEADROOM),
  [dots, plotWidth, height]);

  // ── X-axis labels ────────────────────────────────────────────────────────
  // Show first, latest, and one or two evenly spaced dates in between.
  const xLabelIndices = React.useMemo(() => {
    const n = sampled.length;
    if (n <= 2) return [0, n - 1];
    const steps = Math.min(plotWidth < 320 ? 1 : 2, n - 2);
    const mids = Array.from({ length: steps }, (_, i) =>
      Math.round(((i + 1) / (steps + 1)) * (n - 1)),
    );
    return [0, ...mids, n - 1];
  }, [sampled.length, plotWidth]);

  // ── Grid ─────────────────────────────────────────────────────────────────
  const gridCount = GRID_INTERIOR + 2; // top edge + interior + bottom edge
  const gridTops = Array.from({ length: gridCount }, (_, i) =>
    (i / (gridCount - 1)) * height,
  );

  return (
    <View>
      {caption ? <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: lineColor }]} />
        <Text style={styles.caption}>{caption}</Text>
      </View> : null}

      <View style={styles.plotRow}>
        {/* Y-axis --------------------------------------------------------- */}
        <View style={[styles.yAxis, { height: height + LABEL_HEADROOM }]}>
          {yTicks.map((tick, i) => (
            <Text key={`y${i}`} style={[styles.yTickText, { top: LABEL_HEADROOM + gridTops[i] - 8 }]}>
              {formatCurrency(tick)}
            </Text>
          ))}
        </View>

        {/* Plot column ---------------------------------------------------- */}
        <View style={{ flex: 1, paddingRight: 18 }}>
          {/* Headroom above the chart so value labels don't clip */}
          <View style={{ height: LABEL_HEADROOM }} />

          <View
            style={[styles.plot, { height }]}
            onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
          >
            {/* Horizontal grid lines */}
            {gridTops.map((top, i) => (
              <View
                key={`g${i}`}
                style={[
                  styles.gridLine,
                  (i === 0 || i === gridCount - 1) ? styles.gridEdge : styles.gridMid,
                  { top },
                ]}
              />
            ))}

            {/* Line segments */}
            {segments.map((seg) => (
              <View
                key={seg.key}
                style={[
                  styles.segment,
                  {
                    left: seg.left,
                    top: seg.top,
                    width: seg.width,
                    backgroundColor: lineColor,
                    transform: [{ rotate: `${seg.angle}deg` }],
                  },
                ]}
              />
            ))}

            {/* Data-point dots */}
            {dots.map((dot, i) => {
              const latest = i === dots.length - 1;
              const radius = latest ? 4 : 2.5;
              return <View key={`d${i}`} accessible
                accessibilityLabel={`${formatCurrency(dot.value)} · ${formatDoeTimelineDate(dot.date)}`}
                testID={latest ? 'price-trend-latest-point' : undefined} style={[styles.dot, {
                left: dot.x - radius, top: dot.y - radius,
                width: radius * 2, height: radius * 2, borderRadius: radius,
                backgroundColor: lineColor, opacity: latest ? 1 : 0.45,
              }]} />;
            })}

            {/* Annotations use exact values; no changes to dots or segments. */}
            {valueLabels.map(label => <Text key={`lbl${label.index}`} testID="price-trend-value-label"
              accessibilityLabel={`${formatCurrency(dots[label.index].value)} · ${formatDoeTimelineDate(dots[label.index].date)}`}
              numberOfLines={1} style={[styles.valueLabel, {
                left: label.left, top: label.top, width: label.width, height: label.height,
                fontWeight: label.index === dots.length - 1 ? '600' : '500',
              }]}>{formatCurrency(dots[label.index].value)}</Text>)}
          </View>

          {/* X-axis date labels ------------------------------------------ */}
          {plotWidth > 0 && (
            <View style={styles.xAxisRow}>
              {xLabelIndices.map((idx) => {
                const dot = dots[idx];
                if (!dot) return null;
                return (
                  <Text
                    key={`xl${idx}`}
                    numberOfLines={1}
                    style={[styles.xTickText, { left: Math.max(0, Math.min(plotWidth - 44, dot.x - 22)) }]}
                  >
                    {formatDoeTimelineDate(sampled[idx].coverage_end!)}
                  </Text>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {/* Footer ----------------------------------------------------------- */}
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>
          {points.length} {points.length === 1 ? 'bulletin' : 'bulletins'}
        </Text>
        <MovementTag delta={delta} />
      </View>
    </View>
  );
}

// ─── Supporting components ────────────────────────────────────────────────────

function MovementTag({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.005) {
    return (
      <View style={[styles.moveTag, { backgroundColor: D.color.surface }]}>
        <Text style={[styles.moveText, { color: D.color.textSecondary }]}>No change</Text>
      </View>
    );
  }
  const down = delta < 0;
  return (
    <View
      style={[
        styles.moveTag,
        { backgroundColor: down ? D.status.success.background : D.status.error.background },
      ]}
    >
      <Text style={[styles.moveText, { color: down ? D.status.success.foreground : D.status.error.foreground }]}>
        {down ? '↓' : '↑'} {formatCurrency(Math.abs(delta))}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  caption: {
    fontSize: 13,
    fontWeight: '500',
    color: D.color.textSecondary,
    flex: 1,
  },
  plotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: Y_AXIS_W,
    position: 'relative',
  },
  yTickText: {
    position: 'absolute', left: 0, right: 0,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '400',
    color: D.color.textSecondary,
    textAlign: 'right',
    paddingRight: 4,
  },
  plot: {
    position: 'relative',
    // overflow visible so labels can sit above the top grid edge.
    overflow: 'visible',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  gridEdge: {
    height: 1,
    backgroundColor: D.color.borderSubtle, opacity: 0.65,
  },
  gridMid: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: D.color.neutralSoft,
  },
  segment: {
    position: 'absolute',
    height: LINE_H,
    borderRadius: LINE_H / 2,
    // React Native default transformOrigin is 'center center'.
    // The segment is pre-positioned at its geometric centre (cx, cy), so
    // rotation pivots correctly and segments meet without gaps.
  },
  dot: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  valueLabel: {
    position: 'absolute',
    color: D.color.textPrimary, fontVariant: ['tabular-nums'],
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  xAxisRow: {
    position: 'relative',
    height: 18,
    // White space for low-point callouts, without moving any plotted point.
    marginTop: 16,
  },
  xTickText: {
    position: 'absolute',
    width: 44,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '400',
    color: D.color.textTertiary,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 12,
  },
  footerLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: D.color.textTertiary,
  },
  coverageMetadata: { fontSize: 11, lineHeight: 16, fontWeight: '400', color: D.color.textTertiary, marginTop: 2 },
  moveTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  moveText: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  empty: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: D.color.surface,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: D.color.textPrimary,
    marginBottom: 2,
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: 17,
    color: D.color.textTertiary,
  },
});
