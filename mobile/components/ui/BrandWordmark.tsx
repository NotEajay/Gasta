import { Image, View } from 'react-native';

/**
 * `gastanew.png` is the horizontal GasTa wordmark used across the app.
 *
 * IMPORTANT: the file is a 1254x1254 SQUARE, but the wordmark inside it only
 * occupies 1128x338 (measured from its alpha channel) with large transparent
 * padding above and below. Sizing the Image box by the FILE's 1:1 aspect would
 * therefore render the wordmark itself only ~35px tall -- which is exactly the
 * "too small to read" problem this asset was added to fix.
 *
 * So the box is sized by the CONTENT aspect (3.34:1) instead. That keeps the
 * wordmark crisp, uncropped and at its intended height at every breakpoint.
 */
const gastaNewLogo = require('@/assets/images/gastanew.png');

/**
 * Measured geometry of gastanew.png, from its alpha channel.
 *
 * The file is a 1254x1254 SQUARE, but the wordmark only occupies a
 * 1128x338 region at (84, 456) -- i.e. roughly 36% transparent padding above
 * and 37% below, and almost none at the sides.
 *
 * That is why simply widening the Image did not help: `resizeMode="contain"`
 * fits the SQUARE source into the box by its SMALLER dimension, so a 135x40 box
 * shrank the whole 1254px canvas to 40x40 and the visible wordmark came out
 * ~36px wide -- unreadable, and leaving the rest of the row empty.
 *
 * So the square is rendered at full size inside a box exactly the size of the
 * visible artwork, offset by the padding. The source is square and the box is
 * square, so `contain` is a 1:1 fit and nothing is stretched or distorted --
 * the transparent margin is simply cropped away.
 */
const GASTANEW_FILE = 1254;
const GASTANEW_PAD_X = 84;
const GASTANEW_PAD_Y = 456;
const GASTANEW_CONTENT_W = 1128;
const GASTANEW_CONTENT_H = 338;

/** The wordmark at a given VISIBLE width, cropped to its real bounds. */
export default function BrandWordmark({ width }: { width: number }) {
  const scale = width / GASTANEW_CONTENT_W;
  const imageSize = GASTANEW_FILE * scale;
  return (
    // Pinned so surrounding copy can never squeeze the wordmark: it is the
    // brand, and it is already at its minimum useful size.
    <View style={{ width, height: GASTANEW_CONTENT_H * scale, overflow: 'hidden', flexShrink: 0 }}>
      <Image
        accessibilityLabel="GasTa"
        accessibilityRole="image"
        resizeMode="contain"
        source={gastaNewLogo}
        style={{
          position: 'absolute',
          width: imageSize,
          height: imageSize,
          left: -GASTANEW_PAD_X * scale,
          top: -GASTANEW_PAD_Y * scale,
        }}
      />
    </View>
  );
}
