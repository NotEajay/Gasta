import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import { GasTaColors as C, radii, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';

type Props = {
  company: string;
  slug: string;
  sourceLabel: string;
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
  company, slug, sourceLabel, price, unavailableLabel, subtitle, expanded: controlledExpanded,
  onToggle, onViewStations, onReport, children,
}: Props) {
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!expanded) { reveal.setValue(0); return; }
    const animation = Animated.timing(reveal, { toValue: 1, duration: 180, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [expanded, reveal]);

  return <View style={styles.card}>
    <Pressable accessibilityRole="button"
      accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${company} actions`}
      accessibilityState={{ expanded }}
      onPress={onToggle ?? (() => setLocalExpanded((value) => !value))}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
      <BrandMark brand={company} slug={slug} size="sm" />
      <View style={styles.copy}>
        <Text style={styles.company}>{company}</Text>
        <Text style={styles.source}>{sourceLabel}</Text>
        {!hasPrice && unavailableLabel ? <Text style={styles.secondary}>{unavailableLabel}</Text> : null}
        {subtitle ? <Text style={styles.secondary}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right}>
        {hasPrice ? <Text accessibilityLabel={`DOE estimate ${formatCurrency(price)} per liter`} style={styles.price}>{formatCurrency(price)}<Text style={styles.unit}>/L</Text></Text> : null}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.forest} />
      </View>
    </Pressable>
    {expanded ? <Animated.View style={[styles.details, { opacity: reveal }]}>
      {children}
      <View style={styles.actions}>
        {onViewStations ? <Pressable accessibilityRole="button" onPress={onViewStations} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="location-outline" size={15} color={C.forest} /><Text style={styles.buttonText}>View stations</Text>
        </Pressable> : null}
        {onReport ? <Pressable accessibilityRole="button" onPress={onReport} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={15} color={C.forest} /><Text style={styles.buttonText}>Report station price</Text>
        </Pressable> : null}
      </View>
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, backgroundColor: C.cream, borderWidth: StyleSheet.hairlineWidth, borderColor: C.forestBorder, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, minHeight: 54 },
  copy: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: 6 },
  company: { fontSize: 14, fontWeight: '700', lineHeight: 19, color: C.textPrimary },
  source: { fontSize: 11, lineHeight: 15, color: C.textSoft, marginTop: 3, marginBottom: 6 },
  secondary: { color: C.forestMuted, fontSize: 12, lineHeight: 18 },
  price: { fontSize: 16, fontWeight: '800', color: C.forestDark },
  unit: { fontSize: 10, fontWeight: '700', opacity: 0.7 },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.forestBorder, padding: spacing.md, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill, backgroundColor: C.forestGlow, paddingHorizontal: 10, paddingVertical: 8 },
  buttonText: { fontSize: 11, fontWeight: '700', color: C.forest },
  pressed: { opacity: 0.75 },
});
