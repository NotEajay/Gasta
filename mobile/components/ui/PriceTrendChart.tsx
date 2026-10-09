import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { formatDoeTimelineDate } from '@/lib/doeCoverage';
import { formatCurrency } from '@/lib/format';

export type TrendPoint = {
  bulletin_date: string;
  coverage_end: string | null;
  price_per_liter: number;
};

type Props = {
  points: TrendPoint[];
  /** Shown above the chart, e.g. "RON 91 · South Luzon". */
  caption?: string;
  /** Chart body height in pixels (excluding label headroom). */
  height?: number;
  downColor?: string;
  upColor?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of interior horizontal grid lines (top + bottom edge always drawn). */
const GRID_INTERIOR = 3;
/** Dot radius for every data-point marker. */
const DOT_R = 3.5;
/** Line stroke thickness. */
const LINE_H = 2;
/** Pixel space above the plot to prevent value labels being clipped. */
const LABEL_HEADROOM = 18;
/** Minimum horizontal gap (px) between two value labels before one is hidden. */
const LABEL_MIN_GAP = 34;
/** Width of the y-axis column. */
const Y_AXIS_W = 52;

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * DOE price-trend line chart built entirely from React Native Views.
 *
 * Features: connected polyline, filled dots at every data point, price
 * callouts at key moments (first, last, all-time high, all-time low), full
 * horizontal grid, y-axis ticks, and x-axis date labels.
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
  const lineColor =
    direction === 'down' ? downColor : direction === 'up' ? upColor : GasTaColors.forestMuted;

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
    {unresolvedCount ? <Text style={styles.emptyBody}>{unresolvedCount} bulletin{unresolvedCount === 1 ? '' : 's'} not plotted: coverage end date unavailable.</Text> : null}
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

  // ── Value labels ─────────────────────────────────────────────────────────
  // Show at: first point, last point, all-time high, all-time low.
  // Then suppress any label that would overlap with a previously placed one
  // (sorted left → right, minimum gap of LABEL_MIN_GAP pixels).
  const visibleLabelIndices = React.useMemo(() => {
    if (dots.length === 0) return [];
    const vals = dots.map((d) => d.value);
    const minIdx = vals.indexOf(Math.min(...vals));
    const maxIdx = vals.indexOf(Math.max(...vals));
    const candidates = [...new Set([0, dots.length - 1, minIdx, maxIdx])].sort(
      (a, b) => dots[a].x - dots[b].x,
    );
    const result: number[] = [];
    let lastX = -Infinity;
    for (const idx of candidates) {
      if (dots[idx].x - lastX >= LABEL_MIN_GAP) {
        result.push(idx);
        lastX = dots[idx].x;
      }
    }
    return result;
  }, [dots]);

  // ── X-axis labels ────────────────────────────────────────────────────────
  // Show first, last, and up to 3 evenly spaced in between.
  const xLabelIndices = React.useMemo(() => {
    const n = sampled.length;
    if (n <= 2) return [0, n - 1];
    const steps = Math.min(3, n - 2);
    const mids = Array.from({ length: steps }, (_, i) =>
      Math.round(((i + 1) / (steps + 1)) * (n - 1)),
    );
    return [0, ...mids, n - 1];
  }, [sampled.length]);

  // ── Grid ─────────────────────────────────────────────────────────────────
  const gridCount = GRID_INTERIOR + 2; // top edge + interior + bottom edge
  const gridTops = Array.from({ length: gridCount }, (_, i) =>
    (i / (gridCount - 1)) * height,
  );

  return (
    <View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}

      <View style={styles.plotRow}>
        {/* Y-axis --------------------------------------------------------- */}
        <View style={[styles.yAxis, { height: height + LABEL_HEADROOM }]}>
          {yTicks.map((tick, i) => (
            <Text key={`y${i}`} style={styles.yTickText}>
              {formatCurrency(tick)}
            </Text>
          ))}
        </View>

        {/* Plot column ---------------------------------------------------- */}
        <View style={{ flex: 1 }}>
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
            {dots.map((dot, i) => (
              <View
                key={`d${i}`}
                style={[
                  styles.dot,
                  {
                    left: dot.x - DOT_R,
                    top: dot.y - DOT_R,
                    width: DOT_R * 2,
                    height: DOT_R * 2,
                    borderRadius: DOT_R,
                    backgroundColor: lineColor,
                  },
                ]}
              />
            ))}

            {/* Value labels at key dots */}
            {visibleLabelIndices.map((idx) => {
              const dot = dots[idx];
              // Place label above the dot; flip below when near the top edge.
              const above = dot.y >= LABEL_HEADROOM;
              return (
                <Text
                  key={`lbl${idx}`}
                  style={[
                    styles.valueLabel,
                    { color: lineColor },
                    above
                      ? { left: dot.x - 18, top: dot.y - LABEL_HEADROOM + 1 }
                      : { left: dot.x - 18, top: dot.y + DOT_R + 3 },
                  ]}
                >
                  {formatCurrency(dot.value)}
                </Text>
              );
            })}
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
                    style={[styles.xTickText, { left: dot.x - 16 }]}
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
          {caption ? ` · ${caption}` : ''}
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
      ]}
    >
      <Text style={[styles.moveText, { color: down ? GasTaColors.forestDark : '#B03A24' }]}>
        {down ? '↓' : '↑'} {formatCurrency(Math.abs(delta))}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  caption: {
    fontSize: 13,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    marginBottom: spacing.sm,
  },
  plotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: Y_AXIS_W,
    justifyContent: 'space-between',
  },
  yTickText: {
    fontSize: 9,
    fontWeight: '600',
    color: GasTaColors.textSoft,
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
    backgroundColor: GasTaColors.forestBorder,
  },
  gridMid: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.glassBorderSubtle,
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
    width: 36,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  xAxisRow: {
    position: 'relative',
    height: 18,
    marginTop: 4,
  },
  xTickText: {
    position: 'absolute',
    width: 32,
    fontSize: 9,
    fontWeight: '600',
    color: GasTaColors.textSoft,
    textAlign: 'center',
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