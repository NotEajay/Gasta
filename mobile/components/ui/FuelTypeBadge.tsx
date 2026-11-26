import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import { designSystem as D, type DesignAppearance } from '@/constants/Theme';

export default function FuelTypeBadge({ fuelCode, label, appearance = 'legacy' }: { fuelCode?: string | null; label?: string | null; appearance?: DesignAppearance }) {
  const fuel = getFuelTypePresentation(fuelCode, label);
  return <View accessible accessibilityLabel={`Fuel type: ${fuel.primaryLabel}${fuel.subtitle ? `, ${fuel.subtitle}` : ''}`}
    style={[styles.badge, { backgroundColor: D.color.neutralSoft, borderColor: D.color.borderSubtle }, appearance === 'standard' && { borderRadius: D.radius.small }]}>
    <View accessible={false} style={[styles.dot, { backgroundColor: D.color.textSecondary }]} />
    <View style={styles.copy}>
      <Text style={[styles.label, appearance === 'standard' && D.type.metadata, { color: D.color.textSecondary }]}>{fuel.primaryLabel}</Text>
      {fuel.subtitle ? <Text style={styles.subtitle}>{fuel.subtitle}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', flexShrink: 1, gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderRadius: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  copy: { flexShrink: 1 },
  subtitle: { fontSize: 10, lineHeight: 13, color: D.color.textSecondary },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
