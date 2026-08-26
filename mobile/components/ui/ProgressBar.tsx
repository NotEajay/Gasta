import { StyleSheet, View } from 'react-native';

interface ProgressBarProps {
  /** 0–1 */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
}

export default function ProgressBar({
  progress,
  color = '#2563eb',
  trackColor = '#e2e8f0',
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
