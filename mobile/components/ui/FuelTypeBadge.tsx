import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { designSystem as D, GasTaColors, radii, type DesignAppearance } from '@/constants/Theme';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';

export default function FuelTypeBadge({ fuelCode, label, appearance = 'legacy' }: { fuelCode?: string | null; label?: string | null; appearance?: DesignAppearance }) {
  const fuel = getFuelTypePresentation(fuelCode, label);
  return (
    <View accessible accessibilityLabel={`Fuel type: ${fuel.label}`}
      style={[styles.badge, { backgroundColor: fuel.softBackground, borderColor: fuel.accent }, appearance === 'standard' && { borderRadius: D.radius.small }]}>
      <View style={[styles.dot, { backgroundColor: fuel.accent }]} />
      <Text style={[styles.label, appearance === 'standard' && { ...D.type.metadata, color: D.color.textPrimary }]}>{fuel.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '600', color: GasTaColors.forestDark },
});
