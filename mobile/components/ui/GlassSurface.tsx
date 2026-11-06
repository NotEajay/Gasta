import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, radii } from '@/constants/Theme';

type GlassSurfaceProps = ViewProps & {
  intensity?: number;
  borderRadius?: number;
  variant?: 'default' | 'strong' | 'input';
};

/** Solid surfaces keep forms and financial data readable on every platform.
 * The public props remain compatible with existing auth and form screens.
 */
export default function GlassSurface({
  children,
  style,
  intensity: _intensity,
  borderRadius = radii.lg,
  variant = 'default',
  ...props
}: GlassSurfaceProps) {
  return (
    <View
      style={[
        styles.shell,
        { borderRadius },
        variant === 'strong' && styles.elevated,
        variant === 'input' && { backgroundColor: colors.background },
        style,
      ]}
      {...props}>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

export function AuthBackground({ children, canvas = 'cream' }: {
  children: ReactNode;
  canvas?: 'cream' | 'white';
}) {
  return (
    <View style={[styles.background, canvas === 'white' && { backgroundColor: colors.surface }]}>
      {canvas !== 'white' ? (
        <LinearGradient
          pointerEvents="none"
          colors={['#E8EEFF', colors.background, '#F0F5E5']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: colors.background },
  shell: {
    position: 'relative',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elevated: {
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 2,
  },
  content: { width: '100%' },
});
