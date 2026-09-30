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
  /**
   * Which surface this bar sits on.
   *
   * 'light' is the default and is unchanged. 'dark' is for the forest panel on
   * Trip, where the light track, grey end labels and white outcome cards would
   * all disappear against the fill. Only colours change -- geometry, snapping
   * and the accessibility wiring are identical in both tones.
   */
  tone?: 'light' | 'dark';
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
  tone = 'light',
}: PriorityBalanceBarProps) {
  const dark = tone === 'dark';
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
        <Text
          style={[
            styles.endLabel,
            dark && styles.endLabelDark,
            value <= 0.5 && styles.endLabelActive,
            dark && value <= 0.5 && styles.endLabelActiveDark,
          ]}>
          Save money
        </Text>
        <Text
          style={[
            styles.endLabel,
            dark && styles.endLabelDark,
            value >= 0.5 && styles.endLabelActive,
            dark && value >= 0.5 && styles.endLabelActiveDark,
          ]}>
          Faster trip
        </Text>
      </View>

      <View
        ref={trackRef}
        onLayout={onTrackLayout}
        style={styles.trackHit}
        {...pan.panHandlers}>
        <View style={[styles.track, dark && styles.trackDark]}>
          <View style={[styles.trackFill, dark && styles.trackFillDark, { width: `${value * 100}%` }]} />
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
              style={[
                styles.markPressable,
                dark && styles.markPressableDark,
                dark && selected && styles.markPressableDarkSelected,
              ]}>
              <Text
                style={[
                  styles.markLabel,
                  dark && styles.markLabelDark,
                  selected && styles.markLabelSelected,
                  dark && selected && styles.markLabelSelectedDark,
                ]}>
                {mark.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.outcomeRow}>
        <View style={[styles.outcomeCard, dark && styles.outcomeCardDark]}>
          <Text style={[styles.outcomeLabel, dark && styles.outcomeLabelDark]}>
            Estimated fuel cost
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.outcomeValue, dark && styles.outcomeValueDark]}>
            {estimatedCost != null ? costFormatter(estimatedCost) : '—'}
          </Text>
        </View>
        <View style={[styles.outcomeCard, dark && styles.outcomeCardDark]}>
          <Text style={[styles.outcomeLabel, dark && styles.outcomeLabelDark]}>
            Travel time
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.outcomeValue, dark && styles.outcomeValueDark]}>
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
  /* ---- dark tone (forest panel) ----
     Every colour is a translucent white over the forest fill, so the slider
     keeps the same geometry and the same contrast logic in both tones. */
  endLabelDark: {
    color: 'rgba(255, 255, 255, 0.72)',
  },
  endLabelActiveDark: {
    color: '#FFFFFF',
  },
  trackDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  markLabelDark: {
    color: 'rgba(255, 255, 255, 0.62)',
  },
  markLabelSelectedDark: {
    color: GasTaColors.creamLight,
    fontWeight: '800',
  },
  outcomeCardDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  outcomeLabelDark: {
    color: 'rgba(255, 255, 255, 0.68)',
  },
  /*
   * Dark-tone outcome value. `outcomeValue` is HomeColors.navy, which on the
   * forest fill rendered as near-black on near-black and was the least legible
   * number on the screen. Warm cream rather than pure white so the two cards
   * stay softer than the pure-white thumb and the selected preset pill.
   */
  outcomeValueDark: {
    color: GasTaColors.creamLight,
  },
  /*
   * Dark-tone track fill. HomeColors.primary sat too close to the forest fill to
   * read as "how far the slider is set", so the fill goes cream and the unfilled
   * track stays translucent white.
   */
  trackFillDark: {
    backgroundColor: GasTaColors.creamLight,
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
  /*
   * Dark-tone marker chips. A slightly lighter forest surface with pale text,
   * and a stronger fill for the selected one -- readable without the bright
   * white pill row the light tone uses.
   */
  markPressableDark: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  markPressableDarkSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    borderColor: 'rgba(255, 255, 255, 0.34)',
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
