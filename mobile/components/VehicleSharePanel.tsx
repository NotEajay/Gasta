import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';
import { palette, radii, spacing } from '@/constants/Theme';
import {
  createVehicleShare,
  fetchUserProfileById,
  fetchVehicleShares,
  findUserByEmail,
  revokeVehicleShare,
} from '@/lib/services/vehicles';
import { useTheme } from '@/lib/useTheme';
import type { UserProfile, UserProfileLookup, VehicleShare, VehicleShareRole } from '@/types';

type RoleValue = VehicleShareRole | '';

const roleOptions: readonly SelectOption<RoleValue>[] = [
  { value: 'Driver', label: 'Driver' },
  { value: 'Operator', label: 'Operator' },
];

interface VehicleSharePanelProps {
  vehicleId: string;
  ownerId: string;
}

type PanelMessage = {
  kind: 'error' | 'success';
  text: string;
};

export default function VehicleSharePanel({ vehicleId, ownerId }: VehicleSharePanelProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
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
    }
  }, [expanded, loadShares]);

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
      setMessage({
        kind: 'success',
        text: `Found ${profile.full_name?.trim() || 'GasTa user'}.`,
      });
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
    if (shareRole !== 'Driver' && shareRole !== 'Operator') {
      setMessage({ kind: 'error', text: 'Choose a role before sharing.' });
      return;
    }

    setSharing(true);
    setMessage(null);
    try {
      await createVehicleShare({
        vehicleId,
        sharedBy: ownerId,
        sharedWith: lookedUpUser.id,
        role: shareRole,
      });
      setEmail('');
      setLookedUpUser(null);
      setShareRole('');
      setMessage({ kind: 'success', text: 'Vehicle access shared.' });
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

    Alert.alert('Remove access', `Remove this vehicle share for ${displayName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRevokingId(share['ShareID']);
          try {
            await revokeVehicleShare(share['ShareID'], vehicleId, ownerId);
            setMessage({ kind: 'success', text: 'Access removed.' });
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
    ]);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityLabel="Share vehicle"
        accessibilityRole="button"
        onPress={() => {
          setExpanded((current) => !current);
          setMessage(null);
        }}
        style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}>
        <Ionicons
          name={expanded ? 'chevron-up' : 'share-social-outline'}
          size={14}
          color={palette.primary}
        />
        <Text style={styles.shareButtonLabel}>{expanded ? 'Hide sharing' : 'Share'}</Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.panel, { borderTopColor: theme.border }]}>
          <Text style={[styles.panelTitle, { color: theme.text }]}>Share profile</Text>
          <Text style={[styles.panelDescription, { color: theme.textSecondary }]}>
            Invite an existing GasTa user to access trips for this vehicle.
          </Text>

          <LabeledInput
            label="User email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setLookedUpUser(null);
              setMessage(null);
            }}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            label={lookingUp ? 'Finding user…' : 'Find user'}
            variant="secondary"
            size="sm"
            onPress={handleLookup}
            disabled={lookingUp}
            style={styles.lookupButton}
          />

          {lookedUpUser ? (
            <Text style={[styles.foundUser, { color: theme.textSecondary }]}>
              Selected: {lookedUpUser.full_name?.trim() || 'GasTa user'}
            </Text>
          ) : null}

          <SelectField<RoleValue>
            label="Role"
            value={shareRole}
            options={roleOptions}
            onChange={setShareRole}
            placeholder="Choose a role"
          />

          {message ? (
            <Text
              style={[
                styles.message,
                { color: message.kind === 'error' ? palette.danger : palette.primary },
              ]}>
              {message.text}
            </Text>
          ) : null}

          <PrimaryButton
            label={sharing ? 'Sharing…' : 'Share'}
            onPress={handleShare}
            disabled={sharing || lookingUp || !lookedUpUser}
          />

          <View style={styles.sharedHeader}>
            <Text style={[styles.sharedHeading, { color: theme.text }]}>Shared with</Text>
            <Text style={[styles.sharedCount, { color: theme.textSecondary }]}>
              {shares.length}
            </Text>
          </View>

          {loadingShares ? (
            <Text style={[styles.sharedEmpty, { color: theme.textSecondary }]}>
              Loading shared access…
            </Text>
          ) : shares.length === 0 ? (
            <Text style={[styles.sharedEmpty, { color: theme.textSecondary }]}>
              No shared access yet.
            </Text>
          ) : (
            shares.map((share) => {
              const profile = profiles[share.shared_with];
              const displayName = profile?.full_name?.trim() || profile?.email || 'Shared user';
              const isRevoking = revokingId === share['ShareID'];

              return (
                <View
                  key={share['ShareID']}
                  style={[styles.sharedUser, { backgroundColor: theme.overlay }]}>
                  <View style={styles.sharedUserInfo}>
                    <Text style={[styles.sharedUserName, { color: theme.text }]}>
                      {displayName}
                    </Text>
                    <Text style={[styles.sharedUserMeta, { color: theme.textSecondary }]}>
                      {profile?.email || 'Email unavailable'} · {share.role}
                    </Text>
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
    marginTop: spacing.md,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
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
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  panelDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  lookupButton: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  foundUser: {
    fontSize: 12,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  message: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  sharedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sharedHeading: {
    fontSize: 15,
    fontWeight: '800',
  },
  sharedCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  sharedEmpty: {
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  sharedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
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
    marginTop: 2,
  },
  removeButton: {
    marginLeft: spacing.sm,
  },
});
