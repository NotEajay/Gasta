import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
// GasTa tokens keep the access panel on the vehicle card’s cream/forest canvas.
import { GasTaColors, GasTaRadius, GasTaSpacing, palette, typeScale } from '@/constants/Theme';
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

// Presentation accents only; role definitions remain in the domain constants.
const ROLE_VISUALS = {
  Member: {
    icon: 'people-outline', helper: 'Regular shared access',
    color: GasTaColors.forest, tint: '#EFF6EF', border: '#CBDECE', active: '#E1EEE3',
  },
  Driver: {
    icon: 'car-outline', helper: 'For vehicle drivers',
    color: '#216775', tint: '#EEF6F7', border: '#CBDFE3', active: '#DFEEF1',
  },
  Operator: {
    icon: 'build-outline', helper: 'Day-to-day operations',
    color: '#92621D', tint: '#FBF5E9', border: '#EADABD', active: '#F5EACC',
  },
  Viewer: {
    icon: 'eye-outline', helper: 'View information only',
    color: '#695581', tint: '#F4F1F8', border: '#DDD4E8', active: '#EAE3F2',
  },
} satisfies Record<VehicleShareRole, {
  icon: ComponentProps<typeof Ionicons>['name'];
  helper: string; color: string; tint: string; border: string; active: string;
}>;

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

const roleOptions: readonly { value: VehicleShareRole; label: string }[] = [
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
  /** Reveal a native view using the screen's existing scroll container. */
  onRequestKeyboardReveal?: (target: View | null) => void;
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
  onRequestKeyboardReveal,
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
  const [showAddForm, setShowAddForm] = useState(true);
  const [lookupFocused, setLookupFocused] = useState(false);
  const lookupCardRef = useRef<View>(null);
  const collaboratorCardRef = useRef<View>(null);
  const accessActionRef = useRef<View>(null);

  useEffect(() => () => onRequestKeyboardReveal?.(null), [onRequestKeyboardReveal]);
  const [lookedUpUser, setLookedUpUser] = useState<UserProfileLookup | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const isSelected = lookedUpUser !== null && selectedUserId === lookedUpUser.id;
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
  const removalInFlight = useRef(false);
  const [pendingRemoval, setPendingRemoval] = useState<{
    shareId: string;
    name: string;
    role: VehicleShareRole;
  } | null>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [accessResultModal, setAccessResultModal] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'confirm';
    message: string;
    role?: VehicleShareRole;
    title?: string;
    operation?: 'remove';
  }>({ visible: false, type: 'success', message: '' });
  const [ownerProfile, setOwnerProfile] = useState<UserProfile | null>(null);
  const resultAnimation = useRef(new Animated.Value(0)).current;
  const collaboratorAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!lookedUpUser) return;
    collaboratorAnimation.setValue(0);
    const animation = Animated.timing(collaboratorAnimation, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [lookedUpUser?.id, collaboratorAnimation]);

  useEffect(() => {
    if (!accessResultModal.visible) return;
    resultAnimation.setValue(0);
    const animation = Animated.timing(resultAnimation, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [accessResultModal.visible, accessResultModal.type, resultAnimation]);

  const dismissAccessResult = () => {
    if (removalInFlight.current) return;
    if (accessResultModal.operation === 'remove' && accessResultModal.type === 'error' && pendingRemoval) {
      showRemovalConfirmation(pendingRemoval);
      return;
    }
    if (accessResultModal.type === 'success') {
      onRequestKeyboardReveal?.(null);
      setEmail('');
      setLookedUpUser(null);
      setSelectedUserId(null);
      setShareRole('');
      setMessage(null);
      setShowAddForm(false);
    }
    // Keep the result content intact during the native dismissal animation.
    setAccessResultModal((current) => ({ ...current, visible: false }));
    if (accessResultModal.operation === 'remove') setPendingRemoval(null);
  };

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
  const accessActionDisabled = sharing || lookingUp || !isSelected || !canSubmit || !shareRole;
  const primaryLabel =
    sharing ? 'Saving…' : shareMode === 'restore' ? 'Restore access' : 'Give access';

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
    setLookedUpUser(null);
    setSelectedUserId(null);
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
    if (!lookedUpUser || !isSelected) {
      setMessage({ kind: 'error', text: 'Select the user before sharing.' });
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
      setMessage(null);
      setAccessResultModal({
        visible: true,
        type: 'error',
        message: 'This user already has access to this vehicle.',
      });
      return;
    }
    // Past this point shareMode is 'new' or 'restore' only.
    if (!canSubmit) {
      setMessage({ kind: 'error', text: 'Look up the user before sharing.' });
      return;
    }

    const role = shareRole as VehicleShareRole;
    const grantedName = lookedUpUser.full_name?.trim() || 'This user';

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
      } else {
        await createVehicleShare({
          vehicleId,
          sharedBy: ownerId,
          sharedWith: lookedUpUser.id,
          role,
        });
      }
      // Both actions share the result lifecycle; only Done clears the form.
      await loadShares();
      setAccessResultModal({
        visible: true,
        type: 'success',
        message: `${grantedName} can now access this vehicle as ${role}.`,
        role,
      });
    } catch (error) {
      const alreadyShared =
        (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') ||
        (error instanceof Error && /already shared|already has access/i.test(error.message));
      setAccessResultModal({
        visible: true,
        type: 'error',
        message: alreadyShared
          ? 'This user already has access to this vehicle.'
          : 'We couldn’t grant access right now. Please try again.',
      });
    } finally {
      setSharing(false);
    }
  };

  const showRemovalConfirmation = (target: NonNullable<typeof pendingRemoval>) => {
    setAccessResultModal({
      visible: true,
      type: 'confirm',
      operation: 'remove',
      title: 'Remove access?',
      message: `${target.name} will no longer be able to access this vehicle.`,
    });
  };

  const handleRemove = (share: VehicleShare) => {
    if (removalInFlight.current) return;
    const target = {
      shareId: share['ShareID'],
      name: resolveName(members, share.shared_with) ?? 'This user',
      role: share.role,
    };
    setPendingRemoval(target);
    showRemovalConfirmation(target);
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval || removalInFlight.current) return;
    const target = pendingRemoval;
    removalInFlight.current = true;
    setRevokingId(target.shareId);
    setMessage(null);
    try {
      await revokeVehicleShare(target.shareId, vehicleId, ownerId);
      await loadShares();
      setAccessResultModal({
        visible: true,
        type: 'success',
        operation: 'remove',
        title: 'Access removed',
        message: `${target.name} no longer has access to this vehicle.`,
      });
    } catch {
      setAccessResultModal({
        visible: true,
        type: 'error',
        operation: 'remove',
        title: "Couldn't remove access",
        message: "We couldn't remove access right now. Please try again.",
      });
    } finally {
      removalInFlight.current = false;
      setRevokingId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {controlled ? null : (
        <Pressable
          accessibilityLabel="Manage access"
          accessibilityRole="button"
          onPress={toggleExpanded}
          style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'people-outline'}
            size={14}
            color={palette.primary}
          />
          <Text style={styles.shareButtonLabel}>
            {expanded ? 'Hide access' : 'Manage access'}
          </Text>
        </Pressable>
      )}

      {expanded ? (
        <View style={[styles.panel, { borderTopColor: GasTaColors.glassBorderSubtle }]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderIcon}>
              <Ionicons name="people" size={22} color={GasTaColors.forest} />
            </View>
            <View style={styles.sharedUserInfo}>
              <Text style={styles.panelTitle}>Vehicle access</Text>
              <Text style={[styles.panelDescription, { color: GasTaColors.textMuted }]}>
                Manage who can view or help manage this vehicle.
              </Text>
            </View>
          </View>
          <Text style={[styles.ownerNote, { color: GasTaColors.textMuted }]}>
            You are the Owner.
          </Text>

          {showAddForm ? (
            <>
              <View ref={lookupCardRef} collapsable={false} style={[styles.lookupCard, lookupFocused && styles.lookupCardFocused]}>
                <View style={styles.lookupHeading}>
                  <View style={styles.lookupIcon}>
                    <Ionicons name="mail-outline" size={18} color={GasTaColors.forest} />
                  </View>
                  <Text style={styles.lookupTitle}>Find a GasTa user</Text>
                </View>
                <LabeledInput
                  label="GasTa account email"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setLookedUpUser(null);
                    setSelectedUserId(null);
                    setShareRole('');
                    setMessage(null);
                  }}
                  placeholder="name@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => {
                    setLookupFocused(true);
                    onRequestKeyboardReveal?.(lookupCardRef.current);
                  }}
                  onBlur={() => {
                    setLookupFocused(false);
                    onRequestKeyboardReveal?.(null);
                  }}
                  style={[styles.lookupInput, lookupFocused && styles.lookupInputFocused]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={lookingUp ? 'Looking up…' : 'Look up account'}
                  accessibilityState={{ disabled: lookingUp, busy: lookingUp }}
                  onPress={handleLookup}
                  disabled={lookingUp}
                  style={({ pressed }) => [
                    styles.lookupButton,
                    pressed && !lookingUp && styles.lookupButtonPressed,
                    lookingUp && styles.lookupButtonLoading,
                  ]}>
                  {lookingUp ? (
                    <ActivityIndicator size="small" color={GasTaColors.white} />
                  ) : (
                    <Ionicons name="search-outline" size={20} color={GasTaColors.white} />
                  )}
                  <Text style={styles.lookupButtonLabel}>
                    {lookingUp ? 'Looking up…' : 'Look up account'}
                  </Text>
                </Pressable>
              </View>

              {lookedUpUser ? (
                <Animated.View
                  ref={collaboratorCardRef}
                  collapsable={false}
                  onLayout={() => onRequestKeyboardReveal?.(collaboratorCardRef.current)}
                  style={{
                  opacity: collaboratorAnimation,
                  transform: [{ translateY: collaboratorAnimation.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
                }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${lookedUpUser.full_name?.trim() || email}`}
                    accessibilityState={{ selected: isSelected, disabled: lookingUp || sharing }}
                    disabled={lookingUp || sharing}
                    onPress={() => {
                      setSelectedUserId(lookedUpUser.id);
                      onRequestKeyboardReveal?.(collaboratorCardRef.current);
                    }}
                    style={({ pressed }) => [
                      styles.foundCard,
                      isSelected && styles.foundCardSelected,
                      pressed && styles.foundCardPressed,
                    ]}>
                    <View style={[styles.rowAvatar, styles.foundAvatar, isSelected && styles.foundAvatarSelected]}>
                      <Text style={[styles.rowAvatarText, isSelected && styles.foundAvatarTextSelected]}>
                        {initialsOf(lookedUpUser.full_name?.trim() || null)}
                      </Text>
                    </View>
                    <View style={styles.sharedUserInfo}>
                      <Text numberOfLines={2} style={[styles.sharedUserName, { color: GasTaColors.forestDark }]}>
                        {lookedUpUser.full_name?.trim() || 'GasTa user'}
                      </Text>
                      <Text numberOfLines={1} style={[styles.sharedUserEmail, { color: GasTaColors.textSoft }]}>
                        {email}
                      </Text>
                    </View>
                    <View style={styles.foundCardStatus}>
                      {isSelected ? (
                        <View style={styles.selectedIndicator}>
                          <Ionicons name="checkmark-circle" size={22} color={GasTaColors.forest} />
                          <View style={styles.selectedBadge}>
                            <Text style={styles.selectedLabel}>Selected</Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.selectPrompt}>Tap to select</Text>
                      )}
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
                  </Pressable>
                </Animated.View>
              ) : null}

              <Text style={styles.roleLabel}>Choose role</Text>
              <View style={styles.roleGrid} accessibilityRole="radiogroup" accessibilityLabel="Access role">
                {roleOptions.map((option) => {
                  const selected = shareRole === option.value;
                  const visual = ROLE_VISUALS[option.value];
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        setShareRole(option.value);
                        onRequestKeyboardReveal?.(accessActionRef.current);
                      }}
                      style={({ pressed }) => [
                        styles.roleOption,
                        { backgroundColor: selected ? visual.active : visual.tint, borderColor: selected ? visual.color : visual.border },
                        selected && styles.roleOptionSelected,
                        pressed && styles.foundCardPressed,
                      ]}>
                      <View style={styles.roleOptionHeader}>
                        <View style={[styles.roleIcon, { backgroundColor: visual.active }]}>
                          <Ionicons name={visual.icon} size={18} color={visual.color} />
                        </View>
                        <Text style={[styles.roleOptionLabel, { color: visual.color }, selected && styles.roleOptionLabelSelected]}>
                          {option.label}
                        </Text>
                        {selected ? (
                          <Ionicons name="checkmark-circle" size={16} color={visual.color} />
                        ) : null}
                      </View>
                      <Text numberOfLines={2} style={styles.roleOptionHelper}>{visual.helper}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.roleHint, { color: GasTaColors.textMuted }]}>
                {shareRole && shareRole in VEHICLE_SHARE_ROLE_DESCRIPTIONS
                  ? VEHICLE_SHARE_ROLE_DESCRIPTIONS[shareRole as VehicleShareRole]
                  : 'Select a role to see what this person can do.'}
              </Text>
            </>
          ) : null}

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

          {showAddForm ? (
            <View ref={accessActionRef} collapsable={false}>
              <PrimaryButton
                label={primaryLabel}
                onPress={handleShare}
                disabled={accessActionDisabled}
                style={accessActionDisabled ? { ...styles.primaryAction, opacity: 0.62 } : styles.primaryAction}
              />
            </View>
          ) : null}

          <View style={styles.sharedHeader}>
            <Text style={[styles.sharedHeading, { color: GasTaColors.forestDark }]}>
              People with access ({activeShares.length})
            </Text>
            {!showAddForm ? (
              <PrimaryButton
                label="Add person"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setMessage(null);
                  setShowAddForm(true);
                }}
              />
            ) : null}
          </View>

          {ownerProfile?.full_name?.trim() ? (
            <Text style={[styles.ownerRow, { color: GasTaColors.textMuted }]}>
              Owner · {ownerProfile.full_name.trim()}
            </Text>
          ) : null}

          {loadingShares ? (
            <Text style={[styles.sharedEmpty, { color: GasTaColors.textMuted }]}>
              Loading people with access…
            </Text>
          ) : activeShares.length === 0 ? (
            <Text style={[styles.sharedEmpty, { color: GasTaColors.textMuted }]}>
              No one has access yet. Give access to get started.
            </Text>
          ) : (
            activeShares.map((share) => {
              // Real name via the vehicle-scoped members RPC. The email is only
              // shown when this is the account the owner just looked up, since
              // that string is already in memory and typed by them. No other
              // source may safely expose a collaborator's email today.
              const name = resolveName(members, share.shared_with);
              const displayName = name ?? 'GasTa user';
              const knownEmail =
                lookedUpUser?.id === share.shared_with && email ? email : null;
              const roleVisual = ROLE_VISUALS[share.role];

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

                  <View style={[styles.rowRole, { backgroundColor: roleVisual.tint, borderColor: roleVisual.border }]}>
                    <Text
                      style={[styles.rowRoleText, { color: roleVisual.color }]}>
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

          {/* The contextual action opens confirmation before any revoke call. */}
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
                    // The confirmation dialog performs the revoke after approval.
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
      {/* The result host must survive changes to expansion and form/list state. */}
      <Modal
        animationType="fade"
        transparent
        visible={accessResultModal.visible}
        onRequestClose={() => {
          if (removalInFlight.current) return;
          if (accessResultModal.operation === 'remove' && accessResultModal.type === 'error') {
            setAccessResultModal((current) => ({ ...current, visible: false }));
            setPendingRemoval(null);
          } else {
            dismissAccessResult();
          }
        }}>
        <View style={styles.accessResultBackdrop}>
          <Animated.View
            style={[
              styles.accessResultCard,
              accessResultModal.type !== 'success' && styles.accessResultCardError,
              {
                opacity: resultAnimation,
                transform: [{ scale: resultAnimation.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
              },
            ]}
            accessibilityViewIsModal>
            <View style={[
              styles.accessResultIcon,
              accessResultModal.type !== 'success' && styles.accessResultIconError,
            ]}>
              <Ionicons
                name={accessResultModal.type === 'success' ? 'checkmark-circle' : accessResultModal.type === 'confirm' ? 'person-remove-outline' : 'alert-circle-outline'}
                size={38}
                color={accessResultModal.type === 'success' ? GasTaColors.forest : palette.warning}
              />
            </View>
            <Text style={styles.accessResultTitle} accessibilityRole="header">
              {accessResultModal.title ?? (accessResultModal.type === 'success' ? 'Access granted' : 'Couldn’t grant access')}
            </Text>
            <Text style={styles.accessResultMessage}>{accessResultModal.message}</Text>
            {accessResultModal.type === 'success' && accessResultModal.role ? (
              <View style={[
                styles.resultRole,
                { backgroundColor: ROLE_VISUALS[accessResultModal.role].tint, borderColor: ROLE_VISUALS[accessResultModal.role].border },
              ]}>
                <Ionicons name={ROLE_VISUALS[accessResultModal.role].icon} size={15} color={ROLE_VISUALS[accessResultModal.role].color} />
                <Text style={[styles.rowRoleText, { color: ROLE_VISUALS[accessResultModal.role].color }]}>
                  {accessResultModal.role}
                </Text>
              </View>
            ) : null}
            {accessResultModal.type === 'confirm' ? (
              <View style={styles.removalActions}>
                {pendingRemoval ? (
                  <Text style={styles.removalRole}>Current role: {pendingRemoval.role}</Text>
                ) : null}
                <PrimaryButton
                  label={revokingId ? 'Removing…' : 'Remove access'}
                  variant="danger"
                  onPress={confirmRemoval}
                  disabled={revokingId !== null}
                  style={styles.removeAction}
                />
                <PrimaryButton
                  label="Cancel"
                  variant="secondary"
                  onPress={dismissAccessResult}
                  disabled={revokingId !== null}
                  style={styles.removalCancel}
                />
              </View>
            ) : (
              <PrimaryButton
                label={accessResultModal.type === 'success' ? 'Done' : 'Try again'}
                onPress={dismissAccessResult}
                style={styles.primaryAction}
              />
            )}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  removalActions: {
    width: '100%',
    gap: GasTaSpacing.sm,
  },
  removalRole: {
    color: GasTaColors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: GasTaSpacing.sm,
  },
  removeAction: {
    width: '100%',
    minHeight: 50,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs,
    backgroundColor: '#A34F3F',
    borderColor: '#A34F3F',
    shadowOpacity: 0,
    elevation: 0,
  },
  removalCancel: {
    width: '100%',
    minHeight: 48,
    borderColor: GasTaColors.glassBorderSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
  accessResultBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 48, 25, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: GasTaSpacing.lg,
  },
  accessResultCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FCFEFC',
    borderRadius: GasTaRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.forestBorder,
    padding: GasTaSpacing.lg,
    alignItems: 'center',
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  accessResultCardError: {
    backgroundColor: '#FFFDFA',
    borderColor: ROLE_VISUALS.Operator.border,
  },
  accessResultIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.forestGlow,
    marginBottom: GasTaSpacing.md,
  },
  accessResultIconError: {
    backgroundColor: ROLE_VISUALS.Operator.active,
  },
  accessResultTitle: {
    ...typeScale.pageTitle,
    color: GasTaColors.forestDark,
    textAlign: 'center',
  },
  accessResultMessage: {
    fontSize: 14,
    lineHeight: 21,
    color: GasTaColors.textMuted,
    textAlign: 'center',
    marginTop: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.lg,
  },
  resultRole: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.xs,
    borderWidth: 1,
    borderRadius: GasTaRadius.pill,
    paddingHorizontal: GasTaSpacing.sm + GasTaSpacing.xs,
    paddingVertical: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.lg,
  },
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
    ...typeScale.sectionHeading,
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.xs,
  },
  panelDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    backgroundColor: GasTaColors.forestGlow,
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.md,
    marginBottom: GasTaSpacing.sm,
  },
  panelHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GasTaColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupButton: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs,
    backgroundColor: GasTaColors.forest,
  },
  lookupButtonPressed: {
    backgroundColor: GasTaColors.forestDark,
  },
  lookupButtonLoading: {
    opacity: 0.82,
  },
  lookupButtonLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: GasTaColors.white,
  },
  lookupCard: {
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: ROLE_VISUALS.Member.tint,
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.md,
    marginBottom: GasTaSpacing.md,
  },
  lookupCardFocused: {
    borderColor: GasTaColors.forest,
  },
  lookupInput: {
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.white,
  },
  lookupInputFocused: {
    borderColor: GasTaColors.forest,
  },
  lookupHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },
  lookupIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TINT_BG,
  },
  lookupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  primaryAction: {
    width: '100%',
    minHeight: 50,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs,
    backgroundColor: GasTaColors.forest,
    borderColor: GasTaColors.forest,
    shadowOpacity: 0,
    elevation: 0,
  },
  roleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.sm,
  },
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.sm,
  },
  roleOption: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 80,
    alignItems: 'stretch',
    gap: GasTaSpacing.xs,
    padding: GasTaSpacing.sm + GasTaSpacing.xs / 2,
    borderWidth: 1,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs / 2,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.white,
  },
  roleOptionSelected: {
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  roleOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.xs,
  },
  roleIcon: {
    width: 24,
    height: 24,
    borderRadius: GasTaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleOptionHelper: {
    fontSize: 11,
    lineHeight: 14,
    color: GasTaColors.textMuted,
  },
  roleOptionLabel: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: GasTaColors.textMuted,
  },
  roleOptionLabelSelected: {
    fontWeight: '700',
  },
  foundCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: GasTaColors.white,
    borderColor: GasTaColors.glassBorderSubtle,
    gap: GasTaSpacing.sm,
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.md,
    marginBottom: GasTaSpacing.md,
  },
  foundCardSelected: {
    backgroundColor: ROLE_VISUALS.Member.active,
    borderColor: GasTaColors.forest,
  },
  foundAvatar: {
    width: 36,
    height: 36,
  },
  foundAvatarSelected: {
    backgroundColor: GasTaColors.forest,
  },
  foundAvatarTextSelected: {
    color: GasTaColors.white,
  },
  foundCardPressed: {
    opacity: 0.8,
  },
  foundCardStatus: {
    alignItems: 'flex-end',
    gap: GasTaSpacing.xs,
  },
  selectedIndicator: {
    alignItems: 'flex-end',
    gap: 4,
  },
  selectedBadge: {
    backgroundColor: GasTaColors.forestGlow,
    borderRadius: GasTaRadius.pill,
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 3,
  },
  selectedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  selectPrompt: {
    fontSize: 11,
    color: GasTaColors.textMuted,
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
    gap: GasTaSpacing.sm,
    marginTop: GasTaSpacing.lg,
    marginBottom: GasTaSpacing.sm,
  },
  sharedHeading: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  sharedEmpty: {
    fontSize: 13,
    marginBottom: GasTaSpacing.sm,
  },
  // ---- collaborator row ----------------------------------------------------
  // Identity, role tint and one quiet contextual control.
  sharedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    paddingVertical: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    marginBottom: GasTaSpacing.sm,
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
  rowRole: {
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 4,
    borderRadius: GasTaRadius.pill,
    borderWidth: 1,
  },
  rowRoleText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: GasTaColors.forest,
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
