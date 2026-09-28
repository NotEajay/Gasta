import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';
// Explicit GasTa tokens instead of the generic `useTheme()` palette, so the
// sharing panel sits on the same cream/forest canvas as the vehicle card it
// lives inside. Only the colour SOURCE changed — no behaviour, flow, or gating.
import { GasTaColors, GasTaRadius, GasTaSpacing, palette } from '@/constants/Theme';
import { fetchVehicleMembers } from '@/lib/services/vehicleRefills';
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
  type VehicleMember,
  type VehicleShare,
  type VehicleShareRole,
} from '@/types';

/** Faint forest tint, matching the vehicle card this panel lives inside. */
const TINT_BG = 'rgba(1, 68, 33, 0.06)';

/**
 * Collaborator display name.
 *
 * `profiles` is own-row-only under RLS ("Users can view own profile", using
 * auth.uid() = id), so reading a collaborator's row directly always failed and
 * every collaborator degraded to the "Shared user" fallback.
 *
 * The project already ships the narrow, vehicle-scoped exception:
 * `vehicle_members(uuid)` (migration 20240812000017) is SECURITY DEFINER,
 * returns only `user_id + full_name + role`, is gated on `has_vehicle_access()`,
 * and is revoked from public/anon. The refill UI already uses it. So the name
 * was available all along — this panel simply was not reading it. No backend
 * change, no new migration, no broader profile access.
 *
 * Email is deliberately NOT resolved here: `vehicle_members` returns no email,
 * and surfacing one would need a new RPC.
 */
function resolveName(members: VehicleMember[], userId: string): string | null {
  const match = members.find((m) => m.user_id === userId);
  const name = match?.full_name?.trim();
  return name ? name : null;
}

/** Restrained initials for the row avatar. No photos, no invented names. */
function initialsOf(name: string | null): string {
  if (!name) return '?';
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}


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
  // Collaborator names, read through the vehicle-scoped `vehicle_members` RPC
  // instead of the own-row-only `profiles` table.
  const [members, setMembers] = useState<VehicleMember[]>([]);
  const [rowMenuFor, setRowMenuFor] = useState<VehicleShare | null>(null);
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
      // Shares and members are independent: a member-lookup failure must never
      // hide the collaborator list, it only costs the names.
      const [nextShares, nextMembers] = await Promise.all([
        fetchVehicleShares(vehicleId, ownerId),
        fetchVehicleMembers(vehicleId).catch(() => [] as VehicleMember[]),
      ]);

      setShares(nextShares);
      setMembers(nextMembers);
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
    // Same real name the row shows, via the same vehicle-scoped source.
    const displayName = resolveName(members, share.shared_with) ?? 'this user';

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
                <Text style={[styles.sharedUserEmail, { color: GasTaColors.textSoft }]}>
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
              // Real name via the vehicle-scoped members RPC. The email is only
              // shown when this is the account the owner just looked up, since
              // that string is already in memory and typed by them. No other
              // source may safely expose a collaborator's email today.
              const name = resolveName(members, share.shared_with);
              const displayName = name ?? 'Shared user';
              const knownEmail =
                lookedUpUser?.id === share.shared_with && email ? email : null;
              const isViewer = share.role === 'Viewer';

              return (
                <View key={share['ShareID']} style={styles.sharedUser}>
                  <View style={styles.rowAvatar}>
                    <Text style={styles.rowAvatarText}>{initialsOf(name)}</Text>
                  </View>

                  <View style={styles.sharedUserInfo}>
                    <Text
                      numberOfLines={2}
                      style={[styles.sharedUserName, { color: GasTaColors.forestDark }]}>
                      {displayName}
                    </Text>
                    {knownEmail ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.sharedUserEmail, { color: GasTaColors.textSoft }]}>
                        {knownEmail}
                      </Text>
                    ) : null}
                  </View>

                  <View style={[styles.rowRole, isViewer && styles.rowRoleNeutral]}>
                    <Text
                      style={[styles.rowRoleText, isViewer && styles.rowRoleTextNeutral]}>
                      {share.role}
                    </Text>
                  </View>

                  <Pressable
                    accessibilityLabel={`More actions for ${displayName}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setRowMenuFor(share)}
                    style={({ pressed }) => [styles.rowMore, pressed && styles.rowMorePressed]}>
                    <Ionicons
                      name="ellipsis-vertical"
                      size={16}
                      color={GasTaColors.textSoft}
                    />
                  </Pressable>
                </View>
              );
            })
          )}

          {/* Contextual per-row menu. The destructive confirmation Alert and the
              revoke handler below are used exactly as they were — only the
              affordance that reaches them moved. */}
          <Modal
            animationType="fade"
            transparent
            visible={rowMenuFor !== null}
            onRequestClose={() => setRowMenuFor(null)}>
            <Pressable
              style={styles.rowMenuBackdrop}
              accessibilityLabel="Close menu"
              onPress={() => setRowMenuFor(null)}>
              <View pointerEvents="box-none" style={styles.rowMenuWrap}>
                <View style={styles.rowMenu}>
                  <Text style={styles.rowMenuHeading}>
                    {rowMenuFor
                      ? resolveName(members, rowMenuFor.shared_with) ?? 'this collaborator'
                      : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel={
                      rowMenuFor
                        ? `Remove access for ${
                            resolveName(members, rowMenuFor.shared_with) ?? 'this collaborator'
                          }`
                        : 'Remove access'
                    }
                    // Keeps the busy state the old inline button had: the
                    // confirmation Alert is still what does the work, so this
                    // only reflects the in-flight request.
                    disabled={revokingId !== null}
                    onPress={() => {
                      const target = rowMenuFor;
                      setRowMenuFor(null);
                      if (target) handleRemove(target);
                    }}
                    style={({ pressed }) => [
                      styles.rowMenuItem,
                      pressed && styles.rowMenuItemPressed,
                    ]}>
                    <Ionicons
                      name={rowMenuFor && revokingId === rowMenuFor['ShareID']
                        ? 'hourglass-outline'
                        : 'close-circle-outline'}
                      size={16}
                      color={palette.danger}
                    />
                    <Text style={styles.rowMenuItemDanger}>
                      {rowMenuFor && revokingId === rowMenuFor['ShareID']
                        ? 'Removing…'
                        : 'Remove access'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
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
  // ---- collaborator row ----------------------------------------------------
  // Flat row, no tint fill, no always-red button. Identity on the left, role
  // as a chip on the right, one quiet contextual control.
  sharedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    paddingVertical: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.xs,
    borderRadius: GasTaRadius.sm,
  },
  rowAvatar: {
    width: 34,
    height: 34,
    borderRadius: GasTaRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TINT_BG,
  },
  rowAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  sharedUserInfo: {
    flex: 1,
    minWidth: 0,
  },
  sharedUserName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  sharedUserEmail: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  // Member / Driver / Operator: soft forest tint.
  rowRole: {
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 2,
    borderRadius: GasTaRadius.pill,
    backgroundColor: TINT_BG,
  },
  // Viewer: deliberately quieter, and never colour-only — the role text is
  // always present and readable.
  rowRoleNeutral: {
    backgroundColor: GasTaColors.creamDark,
  },
  rowRoleText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  rowRoleTextNeutral: {
    color: GasTaColors.textMuted,
  },
  rowMore: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GasTaRadius.sm,
  },
  rowMorePressed: {
    backgroundColor: TINT_BG,
  },
  rowMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 48, 25, 0.28)',
  },
  rowMenuWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: GasTaSpacing.lg,
  },
  rowMenu: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    paddingVertical: GasTaSpacing.xs,
    paddingHorizontal: GasTaSpacing.sm,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  rowMenuHeading: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: GasTaColors.textSoft,
    paddingHorizontal: GasTaSpacing.sm,
    paddingTop: GasTaSpacing.xs,
    paddingBottom: GasTaSpacing.xs,
  },
  rowMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    paddingVertical: 12,
    paddingHorizontal: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
  },
  rowMenuItemPressed: {
    backgroundColor: TINT_BG,
  },
  rowMenuItemDanger: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.danger,
  },
});
