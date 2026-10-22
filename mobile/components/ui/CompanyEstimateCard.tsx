import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import FuelTypeBadge from '@/components/ui/FuelTypeBadge';
import { designSystem as D } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = {
  company: string;
  slug: string;
  sourceLabel: string;
  fuelCode?: string;
  price?: number | null;
  unavailableLabel?: string;
  subtitle?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onViewStations?: () => void;
  onReport?: () => void;
  children: ReactNode;
};

/** Shared presentation for DOE company estimates; no station/price fetching. */
export default function CompanyEstimateCard({
  company, slug, sourceLabel, fuelCode, price, unavailableLabel, subtitle, expanded: controlledExpanded,
  onToggle, onViewStations, onReport, children,
}: Props) {
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const reduced = useReducedMotion();
  const reveal = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || !expanded) { reveal.setValue(1); return; }
    reveal.setValue(0.96);
    const animation = Animated.timing(reveal, { toValue: 1, duration: D.motion.content, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [expanded, reveal, reduced]);

  return <View testID="doe-company-row" style={styles.card}>
    <Pressable accessibilityRole="button"
      accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${company} actions`}
      accessibilityState={{ expanded }} accessibilityHint={subtitle}
      onPress={onToggle ?? (() => setLocalExpanded((value) => !value))}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
      <BrandMark brand={company} slug={slug} size="sm" />
      <View style={styles.copy}>
        <Text style={styles.company}>{company}</Text>
        <Text accessibilityLabel={sourceLabel} style={styles.source}>{sourceLabel.startsWith('DOE') ? 'DOE estimate' : sourceLabel}</Text>
        {!hasPrice && unavailableLabel ? <Text style={styles.secondary}>{unavailableLabel}</Text> : null}
      </View>
      <View style={styles.right}>
        {hasPrice ? <Text accessibilityLabel={`DOE estimate ${formatCurrency(price)} per liter`} style={styles.price}>{formatCurrency(price)}<Text style={styles.unit}>/L</Text></Text> : null}
        {fuelCode ? <FuelTypeBadge appearance="standard" fuelCode={fuelCode} /> : null}
      </View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={D.color.textSecondary} accessible={false} />
    </Pressable>
    {expanded ? <Animated.View style={[styles.details, { opacity: reduced ? 1 : reveal }]}>
      {children}
      <View style={styles.actions}>
        {onViewStations ? <Pressable accessibilityRole="button" onPress={onViewStations} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="location-outline" size={15} color={D.color.action} /><Text style={styles.buttonText}>View stations</Text>
        </Pressable> : null}
        {onReport ? <Pressable accessibilityRole="button" onPress={onReport} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={15} color={D.color.action} /><Text style={styles.buttonText}>Report station price</Text>
        </Pressable> : null}
      </View>
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: D.color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: D.color.borderSubtle },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, minHeight: 80 },
  copy: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: 4 },
  company: { ...D.type.bodyDense, fontSize: 15, lineHeight: 20, fontWeight: '600', color: D.color.textPrimary },
  source: { ...D.type.metadata, color: D.color.textTertiary, fontWeight: '400' },
  secondary: { ...D.type.metadata, color: D.color.textSecondary, fontWeight: '400' },
  price: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: D.color.textPrimary, fontVariant: ['tabular-nums'] },
  unit: { ...D.type.metadata, color: D.color.textSecondary, fontWeight: '400' },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: D.color.borderSubtle, padding: 12, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, backgroundColor: D.color.actionSoft, paddingHorizontal: 10, paddingVertical: 8 },
  buttonText: { ...D.type.supporting, fontWeight: '600', color: D.color.action, flexShrink: 1 },
  pressed: { opacity: 0.88 },
});
