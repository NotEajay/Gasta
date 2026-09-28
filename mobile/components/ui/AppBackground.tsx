import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { GasTaColors, GasTaRadius } from '@/constants/Theme';

/**
 * `AppBackground` — the authenticated-app counterpart to `AuthBackground`.
 *
 * DESIGN PROVENANCE
 * The Sign In screen feels cohesive because its atmosphere is built entirely in
 * code — a warm cream gradient field, a shallow forest glow at the top, and two
 * very faint orbs — with one strong surface floating above it. This component
 * reuses that exact visual language for in-app screens.
 *
 * DELIBERATE DIFFERENCES FROM `AuthBackground`
 * `AuthBackground` is the reference and is NOT modified. This version adapts it:
 *
 * 1. No vignette gradient. Auth has a single vertically-centred card, so a
 *    bottom vignette helps. App screens scroll and end at a floating tab bar,
 *    so darkening the lower third would fight the content and the nav. The
 *    lower area is left clean.
 * 2. Fainter orbs, and positioned clear of dense list content.
 * 3. No canvas="white" variant — there is only one app canvas.
 * 4. No BlurView, no images, no fixed pixel dimensions, so it is identical on
 *    iOS, Android and web and scales with the viewport.
 */
export default function AppBackground({ children }: { children?: ReactNode }) {
  return (
    <View style={styles.root}>
      {/* Base warm wash */}
      <LinearGradient
        colors={[GasTaColors.creamLight, GasTaColors.cream, GasTaColors.creamDark]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Shallow forest glow, top only — the app equivalent of the auth top glow */}
      <LinearGradient
        colors={['rgba(1, 68, 33, 0)', GasTaColors.forestGlow, 'rgba(1, 68, 33, 0)']}
        locations={[0, 0.46, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.topGlow}
      />

      {/*
        Two ambient orbs. Deliberately extremely faint, and pushed to the
        screen edges / upper area so they sit behind the header and identity
        surface rather than behind dense settings rows.
      */}
      <View style={styles.orbTopRight} pointerEvents="none" />
      <View style={styles.orbBottomLeft} pointerEvents="none" />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GasTaColors.cream,
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Shallow: the auth version is 280px, which is too deep for scrolling
    // app content.
    height: 180,
    pointerEvents: 'none',
  },
  orbTopRight: {
    position: 'absolute',
    top: -40,
    right: -50,
    width: 190,
    height: 190,
    borderRadius: GasTaRadius.pill,
    backgroundColor: GasTaColors.forest,
    // Lower than auth's 0.08 — this sits behind real content.
    opacity: 0.045,
  },
  orbBottomLeft: {
    position: 'absolute',
    // Pushed low and off-canvas so it reads as ambience, not content.
    bottom: -70,
    left: -60,
    width: 210,
    height: 210,
    borderRadius: GasTaRadius.pill,
    backgroundColor: GasTaColors.forest,
    opacity: 0.035,
  },
});