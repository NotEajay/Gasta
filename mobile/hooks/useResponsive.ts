import { useWindowDimensions } from 'react-native';

const BASE_WIDTH = 390;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 360;
  const isTablet = width >= 768;
  const isLandscape = width > height;

  const scale = (size: number) => Math.round((width / BASE_WIDTH) * size);
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const contentMaxWidth = clamp(width * 0.92, 320, isTablet ? 440 : 400);
  const logoWidth = clamp(width * (isLandscape ? 0.28 : 0.55), 180, isTablet ? 320 : 280);
  const horizontalPadding = clamp(width * 0.06, 16, 32);
  const verticalPadding = clamp(height * 0.04, 16, 48);

  return {
    width,
    height,
    isCompact,
    isTablet,
    isLandscape,
    scale,
    contentMaxWidth,
    logoWidth,
    horizontalPadding,
    verticalPadding,
  };
}
