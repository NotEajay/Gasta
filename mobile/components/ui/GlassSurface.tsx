import type { ReactNode } from 'react';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, ViewProps } from 'react-native';

import { GasTaColors, GasTaRadius } from '@/constants/Theme';

type GlassSurfaceProps = ViewProps & {
  intensity?: number;
  borderRadius?: number;
  variant?: 'default' | 'strong' | 'input';
};

export default function GlassSurface({
  children,
  style,
  intensity = 55,
  borderRadius = GasTaRadius.lg,
  variant = 'default',
  ...props
}: GlassSurfaceProps) {
  const fill =
    variant === 'strong'
      ? GasTaColors.glassFillStrong
      : variant === 'input'
        ? 'rgba(248, 240, 229, 0.5)'
        : GasTaColors.glassFill;

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.shell,
          styles.webGlass,
          { borderRadius, backgroundColor: fill },
          style,
        ]}
        {...props}>
        <View style={[styles.topHighlight, { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }]} />
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { borderRadius }, style]} {...props}>
      <BlurView
        experimentalBlurMethod="dimezisBlurView"
        intensity={intensity}
        style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}
        tint="light"
      />
      <View style={[StyleSheet.absoluteFill, { borderRadius, backgroundColor: fill }]} />
      <View style={[styles.topHighlight, { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GasTaColors.glassBorder,
    position: 'relative',
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  webGlass: {
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  } as object,
  content: {
    position: 'relative',
    zIndex: 1,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: '8%',
    right: '8%',
    height: 1,
    backgroundColor: GasTaColors.glassHighlight,
    zIndex: 2,
  },
});

type AuthBackgroundProps = {
  children: ReactNode;
};

export function AuthBackground({ children }: AuthBackgroundProps) {
  return (
    <View style={bgStyles.root}>
      <LinearGradient
        colors={[GasTaColors.creamLight, GasTaColors.cream, GasTaColors.creamDark]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[bgStyles.orb, bgStyles.orbForestTop]} />
      <View style={[bgStyles.orb, bgStyles.orbForestBottom]} />
      <View style={[bgStyles.orb, bgStyles.orbPomelo]} />

      <LinearGradient
        colors={['rgba(248,240,229,0)', 'rgba(248,240,229,0.35)', GasTaColors.cream]}
        locations={[0, 0.7, 1]}
        style={bgStyles.vignette}
      />

      {children}
    </View>
  );
}

const bgStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GasTaColors.cream,
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
  },
  orbForestTop: {
    width: 300,
    height: 300,
    top: -100,
    right: -80,
    backgroundColor: GasTaColors.forestGlow,
    transform: [{ scaleX: 1.2 }],
  },
  orbForestBottom: {
    width: 240,
    height: 240,
    bottom: 80,
    left: -90,
    backgroundColor: 'rgba(1, 68, 33, 0.08)',
  },
  orbPomelo: {
    width: 200,
    height: 200,
    top: '35%',
    right: '15%',
    backgroundColor: 'rgba(248, 240, 229, 0.85)',
  },
  vignette: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
  },
});
