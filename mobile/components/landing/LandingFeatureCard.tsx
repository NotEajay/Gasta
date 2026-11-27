import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { GasTaColors, colors, radii, spacing } from '@/constants/Theme';

export interface LandingFeature {
  icon: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
  title: string;
  body: string;
}

export default function LandingFeatureCard({ feature }: { feature: LandingFeature }) {
  return (
    <View style={styles.card} testID="landing-feature-card">
      <View style={styles.iconWrap}>
        <Ionicons color={colors.primary} name={feature.icon} size={23} />
      </View>
      <Text style={styles.eyebrow}>{feature.eyebrow}</Text>
      <Text accessibilityRole="header" aria-level={3} style={styles.title}>
        {feature.title}
      </Text>
      <Text style={styles.body}>{feature.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: GasTaColors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: spacing.lg,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 46,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.navy,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 27,
  },
  body: {
    color: GasTaColors.textMuted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
  },
});
