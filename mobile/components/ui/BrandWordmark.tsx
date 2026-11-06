import { Image, View } from 'react-native';

const logo = require('@/assets/images/gasta-wordmark.png');
const IMAGE_WIDTH = 2172;
const IMAGE_HEIGHT = 724;

// Crop only the export's transparent padding. The compact variant displays
// the symbol from the same artwork so both placements keep identical colors.
const BOUNDS = {
  wordmark: { x: 110, y: 24, width: 1930, height: 676 },
  symbol: { x: 110, y: 24, width: 534, height: 676 },
} as const;

export default function BrandWordmark({
  width,
  variant = 'wordmark',
}: {
  width: number;
  variant?: keyof typeof BOUNDS;
}) {
  const bounds = BOUNDS[variant];
  const scale = width / bounds.width;

  return (
    <View style={{ width, height: bounds.height * scale, overflow: 'hidden', flexShrink: 0 }}>
      <Image
        accessibilityLabel="GasTa"
        accessibilityRole="image"
        resizeMode="contain"
        source={logo}
        style={{
          position: 'absolute',
          width: IMAGE_WIDTH * scale,
          height: IMAGE_HEIGHT * scale,
          left: -bounds.x * scale,
          top: -bounds.y * scale,
        }}
      />
    </View>
  );
}
