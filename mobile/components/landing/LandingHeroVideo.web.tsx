import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/constants/Theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { LandingHeroVideoProps } from './LandingHeroVideo';

const DEFAULT_SOURCE = '/landing/gasta-landing-hero.mp4';
const DEFAULT_POSTER = '/landing/gasta-landing-poster.jpg';

type NetworkInformation = {
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
};

function getConnection(): NetworkInformation | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const networkNavigator = navigator as NavigatorWithConnection;
  return networkNavigator.connection
    ?? networkNavigator.mozConnection
    ?? networkNavigator.webkitConnection;
}

export default function LandingHeroVideo({
  source = DEFAULT_SOURCE,
  poster = DEFAULT_POSTER,
}: LandingHeroVideoProps) {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [saveData, setSaveData] = useState(() => Boolean(getConnection()?.saveData));
  const [hasFrame, setHasFrame] = useState(false);
  const [hasError, setHasError] = useState(false);
  const autoplayBlocked = reducedMotion || saveData || hasError;
  const showPoster = autoplayBlocked || !hasFrame;

  useEffect(() => {
    const connection = getConnection();
    if (!connection?.addEventListener) return;
    const update = () => setSaveData(Boolean(connection.saveData));
    connection.addEventListener('change', update);
    return () => connection.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const syncPlayback = () => {
      const video = videoRef.current;
      if (!video) return;
      if (autoplayBlocked || document.visibilityState === 'hidden') {
        video.pause();
      } else {
        void video.play().catch(() => setHasFrame(false));
      }
    };

    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => document.removeEventListener('visibilitychange', syncPlayback);
  }, [autoplayBlocked]);

  return (
    <View style={styles.frame} testID="landing-video-frame">
      <img alt="" aria-hidden="true" src={poster} style={{ ...mediaStyle, opacity: showPoster ? 1 : 0 }} />
      {!hasError && (
        <video
          ref={videoRef}
          aria-hidden="true"
          autoPlay={!autoplayBlocked}
          controls={false}
          loop
          muted
          playsInline
          poster={poster}
          preload={autoplayBlocked ? 'none' : 'metadata'}
          src={source}
          tabIndex={-1}
          onPlaying={() => setHasFrame(true)}
          onError={() => setHasError(true)}
          style={{ ...mediaStyle, opacity: showPoster ? 0 : 1 }}
        />
      )}

      <View pointerEvents="none" style={styles.scrim} />
      <View pointerEvents="none" style={styles.caption}>
        <View style={styles.captionRule} />
        <Text style={styles.captionEyebrow}>A clearer view of every drive</Text>
        <Text style={styles.captionTitle}>Fuel context, trip choices, one place.</Text>
      </View>

      {hasError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fallbackText}>
          Video unavailable. Your fuel planning still works here.
        </Text>
      ) : null}
    </View>
  );
}

const mediaStyle = {
  borderRadius: radii.lg,
  height: '100%',
  inset: 0,
  objectFit: 'cover' as const,
  position: 'absolute' as const,
  transition: 'opacity 180ms ease',
  width: '100%',
};

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.navy,
    borderColor: 'rgba(220, 233, 181, 0.72)',
    borderRadius: radii.lg,
    borderWidth: 1,
    minHeight: 220,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    width: '100%',
  },
  scrim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: 'rgba(25, 45, 66, 0.24)',
  },
  caption: {
    bottom: spacing.lg,
    left: spacing.lg,
    maxWidth: 310,
    position: 'absolute',
    right: spacing.lg,
  },
  captionRule: {
    backgroundColor: colors.accent,
    borderRadius: 99,
    height: 4,
    marginBottom: 10,
    width: 42,
  },
  captionEyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  captionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.25,
    lineHeight: 25,
    marginTop: 4,
  },
  fallbackText: {
    backgroundColor: 'rgba(25, 45, 66, 0.82)',
    borderRadius: radii.sm,
    color: '#FFFFFF',
    fontSize: 12,
    left: spacing.md,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: 'absolute',
    top: spacing.md,
  },
});
