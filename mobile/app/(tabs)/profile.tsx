import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import AnimatedPressable from '@/components/auth/AnimatedPressable';
import HideWhenBlurred from '@/components/navigation/HideWhenBlurred';
import InlineNotice from '@/components/ui/InlineNotice';
import LoadingState from '@/components/ui/LoadingState';
// NOTE: Profile deliberately uses the AUTH palette (cream + forest) for this
// design experiment, not the canonical navy/green `colors` object.
import { GasTaColors, GasTaRadius, GasTaSpacing, typeScale } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatDate } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * Profile is re-themed onto the Sign In screen's visual language (warm cream
 * canvas, one forest accent, code-built background) WITHOUT touching the global
 * canonical palette or the auth screens themselves.
 *
 * The previous `gastabg.png` photographic background was removed from this
 * screen — the asset file is left in place, unused.
 */

function getDisplayName(user: NonNullable<ReturnType<typeof useAuth>['user']>): string {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }
  return user.email?.split('@')[0] || 'GasTa user';
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [signingOut, setSigningOut] = useState(false);
  /**
   * Sign-out failures were previously raised in a modal `Alert`, which
   * interrupts the screen for a problem the user did not cause. It is now an
   * inline notice in the layout. The sign-out call itself is unchanged.
   */
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.error) {
        // `signOut` resolves to `{ error: string | null }`, so the error is
        // already a message — no `.message` unwrapping.
        setSignOutError(result.error);
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
    // No background of its own. The cream canvas is painted by `TabCanvas` in
    // `app/(tabs)/_layout.tsx`, which sits above this scene's two insets — the
    // `SafeAreaView edges={['top']}` padding and the `sceneStyle` bottom padding
    // for the floating tab bar. A scene-level background cannot cover either
    // strip, which is why it used to stop short of the status bar and the
    // bottom edge. Everything here is transparent so the canvas shows through:
    // this root, the ScrollView, and the content container.
    <HideWhenBlurred>
    <View style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.padding}
        onScroll={tabBarScrollHandler}
        scrollEventThrottle={16}>
      {/* Compact page title only. No subtitle — it restated the screen's own
          purpose, and dropping it removes a label without removing hierarchy.
          Generous spacing below so the cream canvas stays visible. */}
      <Text style={styles.headerTitle}>Profile</Text>

      {/* ---- identity surface ----
          The screen's single strong surface and its only noticeably elevated
          one. It borrows the auth card's white-over-warm-field feel but stops
          short of being an auth card: opaque white, a soft static shadow, no
          blur, no glass, no glossy gradient, no decorative blobs.
          Stacked and centered — a portrait plate, not a settings row — so the
          identity reads as a subject rather than as another list.
          Depth rule from Sign In: background creates atmosphere, ONE surface
          creates depth. Everything below this card stays flat. */}
      <View style={styles.summary}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            {initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <Ionicons
                name="person-outline"
                size={26}
                color={GasTaColors.creamLight}
              />
            )}
          </View>
        </View>

        <Text numberOfLines={2} style={styles.name}>
          {displayName}
        </Text>
        <Text numberOfLines={1} style={styles.email}>
          {email}
        </Text>
        {/* Tiny, optional supporting detail. Reads off `email_confirmed_at`
            only — no new data and no invented state. */}
        {user.email_confirmed_at ? (
          <View style={styles.verifiedPill}>
            <Ionicons
              name="checkmark-circle"
              size={12}
              color={GasTaColors.forest}
            />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        ) : null}
      </View>

      {/* ---- account facts ----
          One clean grouped white surface, 48px rows, hairline dividers, and a
          restrained 30px forest-tinted icon container. One accent hue only.
          These rows are read-only, so they carry no press state, no chevron,
          and no button semantics. */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.detailBlock}>
        <View style={styles.detailRow}>
          <View style={styles.iconBox}>
            <Ionicons
              name="shield-checkmark-outline"
              size={16}
              color={GasTaColors.forest}
            />
          </View>
          <Text style={styles.detailLabel}>Email verified</Text>
          <View style={styles.detailValueGroup}>
            <Text
              style={[
                styles.detailValue,
                user.email_confirmed_at ? styles.detailValueOk : styles.detailValuePending,
              ]}>
              {user.email_confirmed_at ? 'Yes' : 'Not yet'}
            </Text>
          </View>
        </View>
        <View style={styles.detailDivider} />
        <View style={styles.detailRow}>
          <View style={styles.iconBox}>
            <Ionicons
              name="calendar-outline"
              size={16}
              color={GasTaColors.forest}
            />
          </View>
          <Text style={styles.detailLabel}>Member since</Text>
          <Text style={styles.detailValue}>
            {user.created_at ? formatDate(user.created_at) : '—'}
          </Text>
        </View>
        <View style={styles.detailDivider} />
        <View style={styles.detailRow}>
          <View style={styles.iconBox}>
            <Ionicons
              name="log-in-outline"
              size={16}
              color={GasTaColors.forest}
            />
          </View>
          <Text style={styles.detailLabel}>Last sign-in</Text>
          <Text style={styles.detailValue}>
            {user.last_sign_in_at ? formatDate(user.last_sign_in_at) : '—'}
          </Text>
        </View>
      </View>

      {signOutError ? (
        <InlineNotice
          variant="error"
          title="Couldn't sign out"
          message={signOutError}
        />
      ) : null}

      {/* ---- sign out ----
          A compact centered pill, not a full-width settings row and not a
          filled red button. The "SESSION" heading and the white card are gone:
          one action does not need a section label or a surface of its own, and
          removing both lets the identity card stay the screen's only hero.
          Press feedback is still the shared auth spring animation, so no local
          pressed-background style is needed. `handleSignOut` is untouched. */}
      <View style={styles.signOutWrap}>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityState={{ disabled: signingOut, busy: signingOut }}
          disabled={signingOut}
          pressScale={0.96}
          hoverScale={1.02}
          onPress={handleSignOut}
          style={styles.signOutButton}>
          <Ionicons
            name="log-out-outline"
            size={16}
            color={GasTaColors.error}
          />
          <Text style={styles.signOutLabel}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Text>
        </AnimatedPressable>
      </View>
      </ScrollView>
    </View>
    </HideWhenBlurred>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  padding: {
    paddingHorizontal: GasTaSpacing.lg,
    paddingTop: GasTaSpacing.lg,
    // Room for the floating tab bar plus the sign-out row. Unchanged.
    paddingBottom: 120,
  },

  // ---- compact page title (no subtitle) ------------------------------------
  // Sign In gets its breathing room from a large logo hero; an authenticated
  // settings screen doesn't need one. Title only, and the margin below it does
  // the hierarchy work the removed subtitle used to do.
  headerTitle: {
    ...typeScale.pageTitle,
    color: GasTaColors.forestDark,
    // Centred over the identity card and the centred sign-out pill below it.
    textAlign: 'center',
    marginBottom: GasTaSpacing.lg,
  },

  // ---- identity surface ----------------------------------------------------
  // The screen's ONLY noticeably elevated surface. Sign In works because the
  // background makes atmosphere and one card makes depth; this card is that one
  // strong object, and the surfaces below it stay flat.
  // Opaque warm white — related to the auth card's white fill but deliberately
  // NOT glass: no blur, no transparency, no glossy gradient.
  // Stacked + centered, so it reads as a portrait plate rather than a row.
  summary: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.lg,
    alignItems: 'center',
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: GasTaSpacing.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    marginBottom: GasTaSpacing.xl,
    // Restrained forest-tinted shadow rather than the previous navy shadow.
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 2,
  },

  // ---- avatar --------------------------------------------------------------
  // Forest disc with cream initials, plus one very subtle outer ring for the
  // "sits on a surface" read. No glow, no shadow.
  avatarRing: {
    width: 68,
    height: 68,
    borderRadius: GasTaRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    marginBottom: GasTaSpacing.md,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: GasTaRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.forest,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: GasTaColors.textOnForest,
    letterSpacing: 0.2,
  },
  name: {
    ...typeScale.cardTitle,
    fontSize: 17,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    textAlign: 'center',
  },
  email: {
    ...typeScale.bodySmall,
    color: GasTaColors.textMuted,
    marginTop: 3,
    textAlign: 'center',
  },
  // Very small verified treatment. Only rendered when `email_confirmed_at` is
  // already present — no new data, no invented state.
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'center',
    marginTop: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 3,
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
  },
  verifiedText: {
    ...typeScale.label,
    fontSize: 11,
    letterSpacing: 0.2,
    color: GasTaColors.forest,
  },

  // ---- grouped settings rows: flat white, no elevation ---------------------
  // Deliberately shadow-free. The identity card above carries the depth; these
  // surfaces stay flat white with a hairline border so they read as grouped
  // data, not as competing cards.
  sectionLabel: {
    ...typeScale.label,
    color: GasTaColors.textSoft,
    textTransform: 'uppercase',
    marginTop: 0,
    marginBottom: GasTaSpacing.sm,
  },
  detailBlock: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: GasTaSpacing.md,
    // Slightly tighter than before so three rows read as one compact group.
    minHeight: 48,
  },
  // Extremely faint forest-tinted 30px icon container. Not a colored bubble —
  // the auth screens use bare small icons, so this is only a whisper of a fill.
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: GasTaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
  },
  detailLabel: {
    ...typeScale.body,
    color: GasTaColors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  detailValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  // Right-hand values sit a step lighter than the labels, so the label column
  // leads and the values read as supporting data.
  detailValue: {
    ...typeScale.bodySmall,
    color: GasTaColors.textSoft,
    flexShrink: 1,
  },
  // Status emphasis via colour only — no badge.
  detailValueOk: { color: GasTaColors.forest, fontWeight: '700' },
  detailValuePending: { color: GasTaColors.error, fontWeight: '700' },
  detailDivider: {
    height: 1,
    backgroundColor: GasTaColors.glassBorderSubtle,
  },

  // ---- sign out: compact centered pill -------------------------------------
  // A quiet bordered pill, not a settings row and not a filled red button. The
  // faint red wash keeps the danger read at a glance while staying light enough
  // that the identity card above it remains the loudest thing on the screen.
  signOutWrap: {
    alignItems: 'center',
    // Breathing room below the account group without opening a large gap.
    marginTop: GasTaSpacing.xl,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // Sized to the content, but bounded so the pill never looks adrift on a
    // wide screen and never stretches to a full-width banner.
    minWidth: 150,
    paddingHorizontal: GasTaSpacing.lg,
    height: 42,
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(220, 38, 38, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  signOutLabel: {
    ...typeScale.body,
    fontWeight: '600',
    color: GasTaColors.error,
  },
});
