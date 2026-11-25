import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { getFuelTypeColor } from '@/constants/fuelTypeColors';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import { designSystem as D, type DesignAppearance } from '@/constants/Theme';

export default function FuelTypeBadge({ fuelCode, label, appearance = 'legacy' }: { fuelCode?: string | null; label?: string | null; appearance?: DesignAppearance }) {
  const tone = getFuelTypeColor(fuelCode);
  const name = getFuelTypePresentation(fuelCode, label).label;
  return <View accessible accessibilityLabel={`Fuel type: ${name}`}
    style={[styles.badge, { backgroundColor: tone.soft, borderColor: tone.border }, appearance === 'standard' && { borderRadius: D.radius.small }]}>
    <View accessible={false} style={[styles.dot, { backgroundColor: tone.strong }]} />
    <Text style={[styles.label, appearance === 'standard' && D.type.metadata, { color: tone.text }]}>{name}</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', flexShrink: 1, gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderRadius: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
