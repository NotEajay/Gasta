import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import FormSection from '@/components/ui/FormSection';
import LoadingState from '@/components/ui/LoadingState';
import PageHero from '@/components/ui/PageHero';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { BrandColors, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';

function getDisplayName(user: NonNullable<ReturnType<typeof useAuth>['user']>): string {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }
  return user.email?.split('@')[0] || 'GasTa user';
}

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading, signOut } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const result = await signOut();
      if (result.error) {
        Alert.alert('Unable to sign out', result.error);
      }
    } finally {
      setSigningOut(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading) return <LoadingState message="Loading profile…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to view your GasTa profile."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  const displayName = getDisplayName(user);
  const email = user.email || 'No email available';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}>
      <PageHero
        module="profile"
        title="Profile"
        subtitle="Your GasTa account"
      />

      <FormSection
        title="Account"
        subtitle="Basic information from your active session"
        module="profile">
        <View style={styles.identityRow}>
          <View style={[styles.avatar, { backgroundColor: theme.overlay }]}>
            <Text style={[styles.avatarText, { color: theme.text }]}>{initials || 'G'}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: theme.text }]}>{displayName}</Text>
            <Text style={[styles.email, { color: theme.textSecondary }]}>{email}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Full name</Text>
        <Text style={[styles.fieldValue, { color: theme.text }]}>{displayName}</Text>

        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Email</Text>
        <Text style={[styles.fieldValue, { color: theme.text }]}>{email}</Text>
      </FormSection>

      <PrimaryButton
        label={signingOut ? 'Signing out…' : 'Sign out'}
        variant="danger"
        onPress={handleSignOut}
        disabled={signingOut}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
  },
  identityText: {
    flex: 1,
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  email: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  divider: {
    height: 1,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  fieldValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
});
