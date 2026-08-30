import { useWindowDimensions } from 'react-native';

const BASE_WIDTH = 390;
const MIN_SCALE = 0.88;
const MAX_SCALE = 1.12;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 360;
  const isTablet = width >= 768;
  const isDesktop = width >= 1024;
  const isLandscape = width > height;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  // Scale down on small phones; slight bump on tablet; fixed size on desktop.
  const scaleFactor = isDesktop
    ? 1
    : clamp(width / BASE_WIDTH, MIN_SCALE, MAX_SCALE);
  const scale = (size: number) => Math.round(scaleFactor * size);

  const contentMaxWidth = clamp(
    width * 0.92,
    320,
    isDesktop ? 480 : isTablet ? 440 : 400,
  );
  const logoWidth = clamp(
    width * (isLandscape ? 0.28 : isDesktop ? 0.22 : 0.55),
    180,
    isDesktop ? 260 : isTablet ? 320 : 280,
  );
  const horizontalPadding = clamp(width * 0.06, 16, isDesktop ? 48 : 32);
  const verticalPadding = clamp(height * 0.04, 16, isDesktop ? 40 : 48);

  return {
    width,
    height,
    isCompact,
    isTablet,
    isDesktop,
    isLandscape,
    scale,
    contentMaxWidth,
    logoWidth,
    horizontalPadding,
    verticalPadding,
  };
}
