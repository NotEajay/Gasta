import type { ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressableComponent = Animated.createAnimatedComponent(Pressable);

type AnimatedPressableProps = PressableProps & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressScale?: number;
  hoverScale?: number;
};

const springConfig = {
  damping: 18,
  stiffness: 420,
  mass: 0.6,
};

export default function AnimatedPressable({
  children,
  style,
  disabled,
  pressScale = 0.97,
  hoverScale = 1.015,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  ...props
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);
  const isHovered = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 1 - isHovered.value * 0.04,
  }));

  return (
    <AnimatedPressableComponent
      {...props}
      disabled={disabled}
      onHoverIn={(event) => {
        if (!disabled && Platform.OS === 'web') {
          isHovered.value = 1;
          scale.value = withSpring(hoverScale, springConfig);
        }
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        if (Platform.OS === 'web') {
          isHovered.value = 0;
          scale.value = withSpring(1, springConfig);
        }
        onHoverOut?.(event);
      }}
      onPressIn={(event) => {
        if (!disabled) {
          scale.value = withSpring(pressScale, springConfig);
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(isHovered.value ? hoverScale : 1, springConfig);
        onPressOut?.(event);
      }}
      style={[animatedStyle, style]}>
      {children}
    </AnimatedPressableComponent>
  );
}
