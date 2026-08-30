import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import AnimatedPressable from '@/components/auth/AnimatedPressable';
import { GasTaColors, GasTaRadius } from '@/constants/Theme';

type AuthButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  fontSize?: number;
};

const HOVER_DURATION = 180;

export default function AuthButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fontSize = 16,
}: AuthButtonProps) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const hoverProgress = useSharedValue(0);

  const animatedSurfaceStyle = useAnimatedStyle(() => {
    if (!isPrimary && !isSecondary) {
      return {};
    }

    if (isPrimary) {
      return {
        backgroundColor: interpolateColor(
          hoverProgress.value,
          [0, 1],
          [GasTaColors.forest, GasTaColors.forestDark],
        ),
      };
    }

    return {
      backgroundColor: interpolateColor(
        hoverProgress.value,
        [0, 1],
        ['rgba(248, 240, 229, 0.55)', 'rgba(1, 68, 33, 0.08)'],
      ),
    };
  });

  const handleHoverIn = () => {
    if (!disabled && !loading && Platform.OS === 'web') {
      hoverProgress.value = withTiming(1, { duration: HOVER_DURATION });
    }
  };

  const handleHoverOut = () => {
    if (Platform.OS === 'web') {
      hoverProgress.value = withTiming(0, { duration: HOVER_DURATION });
    }
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      hoverScale={1.01}
      pressScale={0.975}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPress={onPress}
      style={[
        styles.base,
        isPrimary && styles.primary,
        isSecondary && styles.secondary,
        variant === 'ghost' && styles.ghost,
        (disabled || loading) && styles.disabled,
      ]}>
      {(isPrimary || isSecondary) && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.surface,
            isPrimary && styles.primary,
            isSecondary && styles.secondary,
            animatedSurfaceStyle,
          ]}
        />
      )}
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={isPrimary ? GasTaColors.textOnForest : GasTaColors.forest} />
        ) : (
          <Text
            style={[
              styles.label,
              { fontSize },
              isPrimary && styles.primaryLabel,
              isSecondary && styles.secondaryLabel,
              variant === 'ghost' && styles.ghostLabel,
            ]}>
            {label}
          </Text>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    borderRadius: GasTaRadius.sm,
    minHeight: 52,
    overflow: 'hidden',
    position: 'relative',
  },
  surface: {
    borderRadius: GasTaRadius.sm,
  },
  content: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: GasTaColors.forest,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  secondary: {
    backgroundColor: 'rgba(248, 240, 229, 0.55)',
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  primaryLabel: {
    color: GasTaColors.textOnForest,
  },
  secondaryLabel: {
    color: GasTaColors.textPrimary,
  },
  ghostLabel: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
});
