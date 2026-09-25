import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/Theme';

interface ProgressBarProps {
  /** 0–1 */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
}

export default function ProgressBar({
  progress,
  color = palette.primary,
  trackColor = palette.primarySoft,
  height = 8,
}: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View style={[styles.track, { backgroundColor: trackColor, height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          backgroundColor: color,
          height,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
});
