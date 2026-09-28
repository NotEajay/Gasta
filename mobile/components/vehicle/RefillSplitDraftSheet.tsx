import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { palette, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import type { SplitAllocationInput } from '@/lib/services/refillAllocations';
import type { VehicleMember } from '@/types';
import {
  buildSplitPayload,
  fromCents,
  parseDraftCents,
  sortEligibleMembers,
  splitSheetStyles as s,
  SplitMemberRow,
  toCents,
} from './refillSplitShared';

interface Props {
  /** The refill total already validated in the form, and not yet persisted. */
  totalAmount: number;
  vehicleLabel: string;
  currentUserId: string;
  /** Same member list the saved-refill sheet uses. */
  members: VehicleMember[];
  /** 'owner' may allocate for everyone; 'self' only for the signed-in user. */
  mode: 'owner' | 'self';
  saving: boolean;
  /** Creation / allocation failures, or an inline validation message. */
  error: string | null;
  /** Set when the refill exists but the allocation failed, to offer a way out. */
  recoveryLabel?: string | null;
  /**
   * Normally 'Cancel' -- back to the form with nothing written. Once the refill
   * has actually been created, Cancel can no longer mean that, so the caller
   * relabels it 'Close' to avoid promising a rollback that would not happen.
   */
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (payload: SplitAllocationInput[]) => void;
  onRecovery?: () => void;
}

/**
 * The split step that runs BEFORE the refill is created.
 *
 * This is deliberately not RefillSplitSheet. That sheet is built around a
 * persisted refill: it fetches allocations and a summary for a real refill id
 * and saves against one. There is no id here yet, and inventing a temporary row
 * just to delete it on cancel would leave a window where a half-built refill is
 * visible in history.
 *
 * So this is a local-only draft. It shares the member eligibility, the cents
 * math, the labels and the payload builder with the real sheet (see
 * refillSplitShared) but issues NO network calls while typing. Nothing is
 * persisted until Confirm, which is what lets Cancel mean "go back to my form
 * and keep editing" with an empty database.
 */
export default function RefillSplitDraftSheet({
  totalAmount,
  vehicleLabel,
  currentUserId,
  members,
  mode,
  saving,
  error,
  recoveryLabel,
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
  onRecovery,
}: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  /**
   * Owner sees every eligible person. A collaborator sees only themselves --
   * mirroring the server rule in save_refill_split, which never lets a
   * non-manager write anyone else's row.
   */
  const rows = useMemo(() => {
    const eligible = sortEligibleMembers(members);
    if (mode === 'owner') return eligible;
    return eligible.filter((m) => m.user_id === currentUserId);
  }, [members, mode, currentUserId]);

  const refillCents = toCents(totalAmount);
  const assignedCents = useMemo(
    () => rows.reduce((sum, m) => sum + parseDraftCents(draft[m.user_id]), 0),
    [rows, draft],
  );
  const unassignedCents = Math.max(refillCents - assignedCents, 0);
  const overBudget = assignedCents > refillCents;
  const hasPositive = rows.some((m) => parseDraftCents(draft[m.user_id]) > 0);

  const message = localError ?? error;

  const handleConfirm = useCallback(() => {
    if (saving) return; // blocks double taps
    if (overBudget) {
      setLocalError('The split is larger than this refill total.');
      return;
    }
    if (!hasPositive) {
      setLocalError(
        mode === 'self'
          ? 'Enter the amount you are taking responsibility for.'
          : 'Enter an amount for at least one person.',
      );
      return;
    }
    setLocalError(null);
    // Positive-only, and already in the real RPC shape.
    onConfirm(buildSplitPayload(draft, rows));
  }, [saving, overBudget, hasPositive, mode, onConfirm, draft, rows]);

  const setAmount = useCallback((userId: string, text: string) => {
    setDraft((prev) => ({ ...prev, [userId]: text }));
    setLocalError(null);
  }, []);

  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.sheetWrap}>
        <View style={s.sheet}>
          <View style={s.head}>
            <View style={s.titles}>
              {/* Same wording as the history sheet: this is the same feature,
                  just before it is saved. */}
              <Text style={s.title}>{mode === 'owner' ? 'Split expense' : 'Set my share'}</Text>
              <Text numberOfLines={1} style={s.subtitle}>
                {vehicleLabel}
              </Text>
            </View>
            <PrimaryButton
              disabled={saving}
              label="Close"
              onPress={onCancel}
              size="sm"
              variant="secondary"
            />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {/* Same tinted total card, same divider, same summary rows as the
                history sheet -- only the figures differ, because there are no
                server statuses to show yet. */}
            <View style={s.totalCard}>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Refill total</Text>
                <Text style={s.totalValue}>{formatCurrency(totalAmount)}</Text>
              </View>
              <View style={s.divider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Assigned</Text>
                <Text style={[s.summaryValue, overBudget && { color: palette.danger }]}>
                  {formatCurrency(fromCents(assignedCents))}
                </Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Unassigned</Text>
                <Text style={[s.summaryValue, overBudget && { color: palette.danger }]}>
                  {formatCurrency(fromCents(unassignedCents))}
                </Text>
              </View>
              <Text style={s.totalHint}>
                Unassigned stays unassigned. It is never charged to anyone unless an amount is
                entered for them.
              </Text>
            </View>

            {rows.length === 0 ? (
              <Text style={s.empty}>
                {mode === 'self'
                  ? 'You are not eligible to be charged for this refill.'
                  : 'No one is eligible to share this expense yet.'}
              </Text>
            ) : null}

            {/* No `statusText` here, and deliberately so: nothing is persisted
                yet, so there is no Accepted or Pending to claim. */}
            {rows.map((member) => (
              <SplitMemberRow
                key={member.user_id}
                isSelf={member.user_id === currentUserId}
                member={member}
                onChangeText={(text) => setAmount(member.user_id, text)}
                value={draft[member.user_id] ?? ''}
              />
            ))}

            {overBudget || message ? (
              <View style={s.errorBlock}>
                <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
                <Text style={s.errorBody}>
                  {overBudget ? 'The split is larger than this refill total.' : message}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            {recoveryLabel && onRecovery ? (
              <PrimaryButton
                label={recoveryLabel}
                onPress={onRecovery}
                style={styles.recoveryBtn}
                variant="secondary"
              />
            ) : null}
            <View style={s.actionRow}>
              <PrimaryButton
                disabled={saving}
                label={cancelLabel}
                onPress={onCancel}
                style={s.cancelBtn}
                variant="secondary"
              />
              <PrimaryButton
                disabled={saving || overBudget || rows.length === 0}
                label={saving ? 'Saving…' : mode === 'owner' ? 'Confirm split' : 'Confirm share'}
                onPress={handleConfirm}
                style={s.saveBtn}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  recoveryBtn: { marginBottom: spacing.sm },
});

