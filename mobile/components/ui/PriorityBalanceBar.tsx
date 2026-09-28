import { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { Text } from '@/components/Themed';
import { HomeColors } from '@/constants/home';
import { GasTaColors, radii, spacing } from '@/constants/Theme';

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 28;
const STEP = 0.05;
const MARKS = [
  { key: 'cheapest', label: 'Cheapest', position: 0 },
  { key: 'balanced', label: 'Balanced', position: 0.5 },
  { key: 'fastest', label: 'Fastest', position: 1 },
] as const;

interface PriorityBalanceBarProps {
  /**
   * Visual slider position: 0 = Cheapest (save money), 1 = Fastest.
   * Maps to SAW as fuelCost = 1 - value, travelTime = value.
   */
  value: number;
  onChange: (value: number) => void;
  /** Live recommended-mode fuel/fare cost, or null before optimize. */
  estimatedCost: number | null;
  /** Live recommended-mode travel time in minutes, or null before optimize. */
  estimatedTimeMinutes: number | null;
  costFormatter: (amount: number) => string;
  accessibilityLabel?: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function snapToStep(value: number): number {
  return Math.round(clamp01(value) / STEP) * STEP;
}

/**
 * Option A — one slider with live outcome cards for SAW cost vs time.
 * Presentation only; parent owns weights and live estimates.
 */
export default function PriorityBalanceBar({
  value,
  onChange,
  estimatedCost,
  estimatedTimeMinutes,
  costFormatter,
  accessibilityLabel = 'Balance between saving money and travel time',
}: PriorityBalanceBarProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const updateFromPageX = useCallback(
    (pageX: number) => {
      const width = trackWidthRef.current;
      if (width <= 0) return;
      const next = snapToStep((pageX - trackPageXRef.current) / width);
      if (Math.abs(next - valueRef.current) < 0.001) return;
      onChange(next);
    },
    [onChange],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          trackRef.current?.measureInWindow((x) => {
            trackPageXRef.current = x;
            updateFromPageX(event.nativeEvent.pageX);
          });
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          updateFromPageX(event.nativeEvent.pageX);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [updateFromPageX],
  );

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidthRef.current = width;
    setTrackWidth(width);
    trackRef.current?.measureInWindow((x) => {
      trackPageXRef.current = x;
    });
  }, []);

  const thumbLeft =
    trackWidth > 0 ? value * trackWidth - THUMB_SIZE / 2 : -THUMB_SIZE / 2;

  const savingsPercent = Math.round((1 - value) * 100);
  const timePercent = Math.round(value * 100);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: timePercent,
        text: `${savingsPercent}% savings, ${timePercent}% travel time`,
      }}>
      <View style={styles.labelsRow}>
        <Text style={[styles.endLabel, value <= 0.5 && styles.endLabelActive]}>
          Save money
        </Text>
        <Text style={[styles.endLabel, value >= 0.5 && styles.endLabelActive]}>
          Faster trip
        </Text>
      </View>

      <View
        ref={trackRef}
        onLayout={onTrackLayout}
        style={styles.trackHit}
        {...pan.panHandlers}>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${value * 100}%` }]} />
        </View>

        {MARKS.map((mark) => (
          <View
            key={mark.key}
            pointerEvents="none"
            style={[
              styles.markDot,
              trackWidth > 0 && {
                left: mark.position * trackWidth - 3,
              },
            ]}
          />
        ))}

        {trackWidth > 0 ? (
          <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft }]} />
        ) : null}
      </View>

      <View style={styles.marksRow}>
        {MARKS.map((mark) => {
          const selected = Math.abs(value - mark.position) < 0.06;
          return (
            <Pressable
              key={mark.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(mark.position)}
              style={styles.markPressable}>
              <Text style={[styles.markLabel, selected && styles.markLabelSelected]}>
                {mark.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.outcomeRow}>
        <View style={styles.outcomeCard}>
          <Text style={styles.outcomeLabel}>Estimated fuel cost</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={styles.outcomeValue}>
            {estimatedCost != null ? costFormatter(estimatedCost) : '—'}
          </Text>
        </View>
        <View style={styles.outcomeCard}>
          <Text style={styles.outcomeLabel}>Travel time</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={styles.outcomeValue}>
            {estimatedTimeMinutes != null
              ? `${Math.round(estimatedTimeMinutes)} min`
              : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  endLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: HomeColors.muted,
  },
  endLabelActive: {
    color: HomeColors.navy,
    fontWeight: '700',
  },
  trackHit: {
    height: THUMB_SIZE,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: HomeColors.border,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: HomeColors.primary,
    borderRadius: TRACK_HEIGHT / 2,
  },
  markDot: {
    position: 'absolute',
    top: (THUMB_SIZE - 6) / 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: HomeColors.muted,
    opacity: 0.45,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: GasTaColors.white,
    borderWidth: 3,
    borderColor: HomeColors.primary,
    shadowColor: HomeColors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  marksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  markPressable: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  markLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: HomeColors.muted,
  },
  markLabelSelected: {
    color: HomeColors.primaryDark,
    fontWeight: '800',
  },
  outcomeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  outcomeCard: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
  },
  outcomeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: HomeColors.muted,
    marginBottom: 6,
  },
  outcomeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: HomeColors.navy,
    letterSpacing: -0.4,
  },
});
