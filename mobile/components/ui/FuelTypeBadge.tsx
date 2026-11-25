import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { DOE_FUEL_TYPES } from '@/constants/fuelTypes';
import { getFuelTypeColor } from '@/constants/fuelTypeColors';

export default function FuelTypeBadge({ code, label }: { code?: string | null; label?: string | null }) {
  const tone = getFuelTypeColor(code);
  const name = DOE_FUEL_TYPES.find((fuel) => fuel.code === code)?.name ?? label ?? 'Fuel';
  return <View accessible accessibilityLabel={`Fuel type: ${name}`}
    style={[styles.badge, { backgroundColor: tone.soft, borderColor: tone.border }]}>
    <View accessible={false} style={[styles.dot, { backgroundColor: tone.strong }]} />
    <Text style={[styles.label, { color: tone.text }]}>{name}</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', flexShrink: 1, gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderRadius: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
