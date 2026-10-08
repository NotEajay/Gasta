import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { radii } from '@/constants/Theme';
import { getFuelBrandVisual } from '@/lib/fuelBrand';

type Props = {
  brand?: string | null;
  slug?: string | null;
  stationName?: string | null;
  size?: 'sm' | 'md';
};

export default function BrandMark({ brand, slug, stationName, size = 'md' }: Props) {
  const visual = getFuelBrandVisual(brand ?? stationName, slug);
  const compact = size === 'sm';

  return (
    <View
      accessibilityLabel={`${visual.label} brand`}
      style={[
        styles.mark,
        compact ? styles.markSm : styles.markMd,
        { borderColor: `${visual.color}35`, backgroundColor: `${visual.color}12` },
      ]}>
      {visual.logo ? (
        <Image
          source={visual.logo}
          style={compact ? styles.logoSm : styles.logoMd}
          resizeMode="contain"
        />
      ) : (
        <>
          <Text
            style={[
              styles.initials,
              compact ? styles.initialsSm : styles.initialsMd,
              { color: visual.color },
            ]}>
            {visual.initials}
          </Text>
          <MaterialCommunityIcons
            name="gas-station-outline"
            size={compact ? 9 : 11}
            color={visual.color}
            style={styles.icon}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
  },
  markSm: { width: 34, height: 34, borderRadius: radii.sm },
  markMd: { width: 44, height: 44, borderRadius: radii.md },
  logoSm: { width: 25, height: 25 },
  logoMd: { width: 33, height: 33 },
  initials: { fontWeight: '800', letterSpacing: -0.4 },
  initialsSm: { fontSize: 11 },
  initialsMd: { fontSize: 14 },
  icon: { position: 'absolute', right: 3, bottom: 3 },
});
