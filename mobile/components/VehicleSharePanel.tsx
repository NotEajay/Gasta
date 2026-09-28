import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';
// Explicit GasTa tokens instead of the generic `useTheme()` palette, so the
// sharing panel sits on the same cream/forest canvas as the vehicle card it
// lives inside. Only the colour SOURCE changed — no behaviour, flow, or gating.
import { GasTaColors, GasTaRadius, GasTaSpacing, palette } from '@/constants/Theme';
import {
  createVehicleShare,
  fetchUserProfileById,
  fetchVehicleShares,
  findUserByEmail,
  restoreVehicleShare,
  revokeVehicleShare,
} from '@/lib/services/vehicles';
import {
  VEHICLE_SHARE_ROLE_DESCRIPTIONS,
  type UserProfile,
  type UserProfileLookup,
  type VehicleShare,
  type VehicleShareRole,
} from '@/types';

/** Faint forest tint, matching the vehicle card this panel lives inside. */
const TINT_BG = 'rgba(1, 68, 33, 0.06)';

type RoleValue = VehicleShareRole | '';

const roleOptions: readonly SelectOption<RoleValue>[] = [
  { value: 'Member', label: 'Member' },
  { value: 'Driver', label: 'Driver' },
  { value: 'Operator', label: 'Operator' },
  { value: 'Viewer', label: 'Viewer' },
];

interface VehicleSharePanelProps {
  vehicleId: string;
  ownerId: string;
  /**
   * Optional controlled expansion.
   *
   * The Vehicles card now hosts the share affordance in its header, so the panel
   * accepts the open state and a toggle. Passing `onToggle` switches it to
   * controlled mode: the panel then renders no default trigger of its own and
   * leaves the header button as the single entry point. The lookup, restore,
   * role selection and revoke logic are completely untouched — only the
   * affordance that opens them moved.
   */
  expanded?: boolean;
  onToggle?: () => void;
}

type PanelMessage = {
  kind: 'error' | 'success' | 'info';
  text: string;
};

/**
 * The one branch that decides INSERT vs RESTORE for the resolved account.
 * Derived from the full share list (active AND revoked), never from the
 * collaborators list, so a revoked row can never be mistaken for a new invite.
 */
type ShareMode =
  | 'unresolved' // nothing looked up yet
  | 'new' // never shared      -> createVehicleShare()
  | 'active' // already shared  -> no submission at all
  | 'restore' // previously revoked -> restoreVehicleShare()
  | 'self'; // the owner

export default function VehicleSharePanel({
  vehicleId,
  ownerId,
  expanded: expandedProp,
  onToggle,
}: VehicleSharePanelProps) {
  // Uncontrolled by default, so any other caller keeps the old behaviour.
  const [expandedLocal, setExpandedLocal] = useState(false);
  const controlled = onToggle !== undefined;
  const expanded = controlled ? (expandedProp ?? false) : expandedLocal;
  const toggleExpanded = useCallback(() => {
    setMessage(null);
    if (onToggle) {
      onToggle();
    } else {
      setExpandedLocal((current) => !current);
    }
  }, [onToggle]);
  const [email, setEmail] = useState('');
  const [lookedUpUser, setLookedUpUser] = useState<UserProfileLookup | null>(null);
  const [shareRole, setShareRole] = useState<RoleValue>('');
  const [shares, setShares] = useState<VehicleShare[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});
  const [loadingShares, setLoadingShares] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<UserProfile | null>(null);

  /** Only active collaborators are listed; revoked ones are hidden. */
  const activeShares = useMemo(() => shares.filter((s) => !s.revoked), [shares]);

  /**
   * Searched against `shares` (active AND revoked), NOT `activeShares`.
   *
   * The owner already holds every share row (the select policy admits
   * shared_by = auth.uid()), so this needs no extra query.
   */
  const existingShare = useMemo(
    () => shares.find((s) => s.shared_with === lookedUpUser?.id) ?? null,
    [shares, lookedUpUser],
  );

  const shareMode: ShareMode = useMemo(() => {
    if (!lookedUpUser) return 'unresolved';
    if (lookedUpUser.id === ownerId) return 'self';
    if (!existingShare) return 'new';
    return existingShare.revoked ? 'restore' : 'active';
  }, [existingShare, lookedUpUser, ownerId]);

  const canSubmit = shareMode === 'new' || shareMode === 'restore';
  const primaryLabel =
    sharing ? 'Saving…' : shareMode === 'restore' ? 'Restore access' : 'Share vehicle';

  const loadShares = useCallback(async () => {
    setLoadingShares(true);
    try {
      const nextShares = await fetchVehicleShares(vehicleId, ownerId);
      const nextProfiles: Record<string, UserProfile | null> = {};

      await Promise.all(
        nextShares.map(async (share) => {
          try {
            nextProfiles[share.shared_with] = await fetchUserProfileById(share.shared_with);
          } catch {
            nextProfiles[share.shared_with] = null;
          }
        }),
      );

      setShares(nextShares);
      setProfiles(nextProfiles);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to load shared access.',
      });
    } finally {
      setLoadingShares(false);
    }
  }, [ownerId, vehicleId]);

  useEffect(() => {
    if (expanded) {
      void loadShares();
      // The owner's own profile is always readable (own-row RLS).
      void fetchUserProfileById(ownerId)
        .then(setOwnerProfile)
        .catch(() => setOwnerProfile(null));
    }
  }, [expanded, loadShares, ownerId]);

  const handleLookup = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ kind: 'error', text: 'Enter an email address.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage({ kind: 'error', text: 'Enter a valid email address.' });
      return;
    }

    setLookingUp(true);
    setMessage(null);
    try {
      const profile = await findUserByEmail(normalizedEmail);
      if (!profile) {
        setLookedUpUser(null);
        setMessage({ kind: 'error', text: 'No GasTa account found with that email' });
        return;
      }

      setLookedUpUser(profile);
      setEmail(normalizedEmail);

      if (profile.id === ownerId) {
        setMessage({
          kind: 'error',
          text: 'That is your own account. You already own this vehicle.',
        });
        return;
      }

      const existing = shares.find((s) => s.shared_with === profile.id);
      if (existing && !existing.revoked) {
        setMessage({
          kind: 'info',
          text: `This user already has access to this vehicle as ${existing.role}.`,
        });
        return;
      }
      if (existing?.revoked) {
        setShareRole(existing.role);
        setMessage({
          kind: 'info',
          text: 'This user previously had access. You can restore it below.',
        });
        return;
      }

      setMessage({ kind: 'success', text: 'GasTa account found.' });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to look up that email.',
      });
    } finally {
      setLookingUp(false);
    }
  };

  const handleShare = async () => {
    if (!lookedUpUser) {
      setMessage({ kind: 'error', text: 'Look up the user before sharing.' });
      return;
    }
    if (!shareRole) {
      setMessage({ kind: 'error', text: 'Choose an access role.' });
      return;
    }
    // Self-share is blocked here for a clear message; the server also rejects it
    // (restore_vehicle_share and the prevent_self_vehicle_share trigger).
    if (shareMode === 'self') {
      setMessage({
        kind: 'error',
        text: 'That is your own account. You already own this vehicle.',
      });
      return;
    }
    // An already-active share is never resubmitted: no INSERT, no restore.
    if (shareMode === 'active') {
      setMessage({
        kind: 'error',
        text: `This user already has access to this vehicle as ${existingShare?.role}.`,
      });
      return;
    }
    // Past this point shareMode is 'new' or 'restore' only.
    if (!canSubmit) {
      setMessage({ kind: 'error', text: 'Look up the user before sharing.' });
      return;
    }

    const role = shareRole as VehicleShareRole;

    // A revoked share is reactivated on its EXISTING row. It must never reach
    // createVehicleShare(): unique (vehicleID, shared_with) would reject the
    // insert with 23505 "This vehicle is already shared with that user."
    const restoring = shareMode === 'restore';

    setSharing(true);
    setMessage(null);
    try {
      if (restoring) {
        // Reactivate the SAME row rather than inserting a duplicate.
        await restoreVehicleShare(vehicleId, lookedUpUser.id, role);
        setMessage({ kind: 'success', text: `Access restored as ${role}.` });
      } else {
        await createVehicleShare({
          vehicleId,
          sharedBy: ownerId,
          sharedWith: lookedUpUser.id,
          role,
        });
        setMessage({ kind: 'success', text: 'Vehicle shared successfully.' });
      }
      setEmail('');
      setLookedUpUser(null);
      setShareRole('');
      await loadShares();
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unable to share this vehicle.',
      });
    } finally {
      setSharing(false);
    }
  };

  const handleRemove = (share: VehicleShare) => {
    const profile = profiles[share.shared_with];
    const displayName = profile?.full_name?.trim() || profile?.email || 'this user';

    Alert.alert(
      'Remove access',
      `Remove access for ${displayName}?\n\nThey will no longer be able to view or add shared vehicle activity. Existing records will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove access',
          style: 'destructive',
          onPress: async () => {
            setRevokingId(share['ShareID']);
            try {
              await revokeVehicleShare(share['ShareID'], vehicleId, ownerId);
              setMessage({
                kind: 'success',
                text: `Access removed for ${displayName}.`,
              });
              await loadShares();
            } catch (error) {
              setMessage({
                kind: 'error',
                text: error instanceof Error ? error.message : 'Unable to remove access.',
              });
            } finally {
              setRevokingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      {controlled ? null : (
        <Pressable
          accessibilityLabel="Share vehicle"
          accessibilityRole="button"
          onPress={toggleExpanded}
          style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'share-social-outline'}
            size={14}
            color={palette.primary}
          />
          <Text style={styles.shareButtonLabel}>
            {expanded ? 'Hide sharing' : 'Share vehicle'}
          </Text>
        </Pressable>
      )}

      {expanded ? (
        <View style={[styles.panel, { borderTopColor: GasTaColors.glassBorderSubtle }]}>
          <Text style={[styles.panelTitle, { color: GasTaColors.forestDark }]}>Share vehicle</Text>
          <Text style={[styles.panelDescription, { color: GasTaColors.textMuted }]}>
            Invite another GasTa user to access and collaborate on this vehicle.
          </Text>
          <Text style={[styles.ownerNote, { color: GasTaColors.textMuted }]}>
            You are the Owner.
          </Text>

          <LabeledInput
            label="GasTa account email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setLookedUpUser(null);
              setShareRole('');
              setMessage(null);
            }}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            label={lookingUp ? 'Looking up…' : 'Look up account'}
            variant="secondary"
            size="sm"
            onPress={handleLookup}
            disabled={lookingUp}
            style={styles.lookupButton}
          />

          {lookedUpUser ? (
            <View style={[styles.foundCard, { backgroundColor: TINT_BG, borderColor: GasTaColors.glassBorderSubtle }]}>
              <View style={styles.sharedUserInfo}>
                <Text style={[styles.sharedUserName, { color: GasTaColors.forestDark }]}>
                  {lookedUpUser.full_name?.trim() || 'GasTa user'}
                </Text>
                <Text style={[styles.sharedUserMeta, { color: GasTaColors.textMuted }]}>
                  {email}
                </Text>
              </View>
              {shareMode === 'active' ? (
                <View style={[styles.stateTag, { backgroundColor: GasTaColors.creamDark }]}>
                  <Text style={[styles.stateTagLabel, { color: GasTaColors.textMuted }]}>
                    {existingShare?.role}
                  </Text>
                </View>
              ) : shareMode === 'restore' ? (
                <View style={[styles.stateTag, { backgroundColor: GasTaColors.creamDark }]}>
                  <Text style={[styles.stateTagLabel, { color: GasTaColors.textMuted }]}>
                    Previously {existingShare?.role}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <SelectField<RoleValue>
            label="Access role"
            value={shareRole}
            options={roleOptions}
            onChange={setShareRole}
            placeholder="Choose an access role"
          />
          <Text style={[styles.roleHint, { color: GasTaColors.textMuted }]}>
            {shareRole && shareRole in VEHICLE_SHARE_ROLE_DESCRIPTIONS
              ? VEHICLE_SHARE_ROLE_DESCRIPTIONS[shareRole as VehicleShareRole]
              : 'Select a role to see what this person can do.'}
          </Text>

          {message ? (
            <Text
              style={[
                styles.message,
                {
                  color:
                    message.kind === 'error'
                      ? palette.danger
                      : message.kind === 'info'
                        ? GasTaColors.textMuted
                        : palette.primary,
                },
              ]}>
              {message.text}
            </Text>
          ) : null}

          <PrimaryButton
            label={primaryLabel}
            onPress={handleShare}
            disabled={sharing || lookingUp || !lookedUpUser || !canSubmit || !shareRole}
          />

          <View style={styles.sharedHeader}>
            <Text style={[styles.sharedHeading, { color: GasTaColors.forestDark }]}>
              Collaborators ({activeShares.length})
            </Text>
          </View>

          {ownerProfile?.full_name?.trim() ? (
            <Text style={[styles.ownerRow, { color: GasTaColors.textMuted }]}>
              Owner · {ownerProfile.full_name.trim()}
            </Text>
          ) : null}

          {loadingShares ? (
            <Text style={[styles.sharedEmpty, { color: GasTaColors.textMuted }]}>
              Loading collaborators…
            </Text>
          ) : activeShares.length === 0 ? (
            <Text style={[styles.sharedEmpty, { color: GasTaColors.textMuted }]}>
              No collaborators yet. Share this vehicle to get started.
            </Text>
          ) : (
            activeShares.map((share) => {
              const profile = profiles[share.shared_with];
              const displayName = profile?.full_name?.trim() || profile?.email || 'Shared user';
              const isRevoking = revokingId === share['ShareID'];

              return (
                <View
                  key={share['ShareID']}
                  style={[styles.sharedUser, { backgroundColor: TINT_BG }]}>
                  <View style={styles.sharedUserInfo}>
                    <Text style={[styles.sharedUserName, { color: GasTaColors.forestDark }]}>
                      {displayName}
                    </Text>
                    <Text style={[styles.sharedUserMeta, { color: GasTaColors.textMuted }]}>
                      {share.role}
                    </Text>
                    {profile?.email ? (
                      <Text style={[styles.sharedUserEmail, { color: GasTaColors.textMuted }]}>
                        {profile.email}
                      </Text>
                    ) : null}
                  </View>
                  <PrimaryButton
                    label={isRevoking ? 'Removing…' : 'Remove access'}
                    variant="danger"
                    size="sm"
                    onPress={() => handleRemove(share)}
                    disabled={isRevoking}
                    style={styles.removeButton}
                  />
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: GasTaSpacing.md,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
  },
  shareButtonPressed: {
    backgroundColor: palette.primarySoft,
  },
  shareButtonLabel: {
    color: palette.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  panel: {
    borderTopWidth: 1,
    marginTop: GasTaSpacing.md,
    paddingTop: GasTaSpacing.md,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: GasTaSpacing.xs,
  },
  panelDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: GasTaSpacing.md,
  },
  lookupButton: {
    alignSelf: 'flex-start',
    marginBottom: GasTaSpacing.md,
  },
  foundCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },
  stateTag: {
    borderRadius: GasTaRadius.sm,
    paddingVertical: 3,
    paddingHorizontal: GasTaSpacing.xs,
  },
  stateTagLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  ownerNote: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: -GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },
  ownerRow: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: GasTaSpacing.sm,
  },
  roleHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },
  message: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: GasTaSpacing.md,
  },
  sharedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: GasTaSpacing.lg,
    marginBottom: GasTaSpacing.sm,
  },
  sharedHeading: {
    fontSize: 15,
    fontWeight: '800',
  },
  sharedEmpty: {
    fontSize: 13,
    marginBottom: GasTaSpacing.sm,
  },
  sharedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.sm,
  },
  sharedUserInfo: {
    flex: 1,
  },
  sharedUserName: {
    fontSize: 14,
    fontWeight: '700',
  },
  sharedUserMeta: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  sharedUserEmail: {
    fontSize: 12,
    marginTop: 1,
  },
  removeButton: {
    marginLeft: GasTaSpacing.sm,
  },
});
