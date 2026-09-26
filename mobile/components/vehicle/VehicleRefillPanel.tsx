import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency, formatDate } from '@/lib/format';
import PendingAllocationInbox from '@/components/vehicle/PendingAllocationInbox';
import RefillSplitSheet from '@/components/vehicle/RefillSplitSheet';
import {
  createVehicleRefill,
  fetchVehicleMembers,
  fetchVehicleRefills,
  voidVehicleRefill,
} from '@/lib/services/vehicleRefills';
import type { VehicleMember, VehicleRefill } from '@/types';

const todayInput = () => new Date().toISOString().slice(0, 10);

interface Props {
  vehicleId: string;
  vehicleLabel: string;
  currentUserId: string;
  /**
   * Ownership is decided by the CALLER from where the vehicle was rendered:
   * true in "Saved vehicles" (those rows come from fetchVehicles(user.id)),
   * false in "Shared with me". It is never inferred from logged_by, and the
   * server remains the authority — this only controls which affordances we offer.
   */
  isOwner: boolean;
  /** Fuel type is inherited from the vehicle; the user does not pick it. */
  vehicleFuelTypeId: string | null;
  onChanged?: () => void;
}

export default function VehicleRefillPanel({
  vehicleId,
  vehicleLabel,
  currentUserId,
  isOwner,
  vehicleFuelTypeId,
  onChanged,
}: Props) {
  const [refills, setRefills] = useState<VehicleRefill[]>([]);
  const [members, setMembers] = useState<VehicleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<VehicleRefill | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [totalAmount, setTotalAmount] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [liters, setLiters] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState(todayInput);
  const [notes, setNotes] = useState('');

  const nameOf = useCallback(
    (userId: string) => {
      const match = members.find((m) => m.user_id === userId);
      return match?.full_name?.trim() || 'Team member';
    },
    [members],
  );

  const memberOptions = useMemo<SelectOption<string>[]>(
    () =>
      members.map((m) => ({
        value: m.user_id,
        label: `${m.full_name?.trim() || 'Team member'}${m.role === 'Owner' ? ' · Owner' : ''}`,
      })),
    [members],
  );

  /**
   * Splitting is offered to every non-Viewer collaborator, mirroring the server
   * rule in can_manage_refill_allocations(). The server still enforces it, so
   * hiding the button is presentation only, never the control.
   */
  /**
   * One place that decides what the signed-in user may do, so the button label
   * and the sheet never disagree. Mirrors the server rules in migration 027:
   *
   *   Owner                   manages the whole split ("Split expense")
   *   Member/Driver/Operator  own share only ("Set my share")
   *   Viewer                  no allocation action at all
   */
  const viewer = useMemo(() => {
    const match = members.find((m) => m.user_id === currentUserId);
    const role = match?.role ?? null;
    const isOwner = role === 'Owner';
    const isViewer = role === 'Viewer';
    return {
      role,
      isOwner,
      /** No button for a Viewer, and nobody at all when members could not load. */
      canAllocate: role !== null && !isViewer,
      actionLabel: isOwner ? 'Split expense' : 'Set my share',
    };
  }, [members, currentUserId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Names and refills fail independently so one never hides the other.
      const [refillRows, memberRows] = await Promise.all([
        fetchVehicleRefills(vehicleId),
        fetchVehicleMembers(vehicleId).catch(() => [] as VehicleMember[]),
      ]);
      setRefills(refillRows);
      setMembers(memberRows);
    } catch (e) {
      setRefills([]);
      setError(e instanceof Error ? e.message : 'Unable to load refills.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening the history sheet re-reads the vehicle's members, so a collaborator
  // added through the sharing flow earlier in the session is picked up without
  // an app restart. The split sheet fetches its own copy as well.
  useEffect(() => {
    if (historyOpen) {
      void load();
    }
  }, [historyOpen, load]);

  // The signed-in user is always a valid member, so default to them.
  useEffect(() => {
    if (paidBy || members.length === 0) return;
    setPaidBy(
      members.some((m) => m.user_id === currentUserId) ? currentUserId : members[0].user_id,
    );
  }, [members, paidBy, currentUserId]);

  const derivedLiters = useMemo(() => {
    const total = Number.parseFloat(totalAmount);
    const price = Number.parseFloat(pricePerLiter);
    if (!Number.isFinite(total) || !Number.isFinite(price) || price <= 0) return null;
    return Math.round((total / price) * 100) / 100;
  }, [totalAmount, pricePerLiter]);

  const resetForm = useCallback(() => {
    setTotalAmount('');
    setPricePerLiter('');
    setLiters('');
    setOccurredAt(todayInput());
    setNotes('');
    setFormError(null);
  }, []);

  const activeRefills = useMemo(() => refills.filter((r) => r.voided_at === null), [refills]);

  const handleSave = useCallback(async () => {
    if (saving) return; // blocks double taps
    const total = Number.parseFloat(totalAmount);
    const price = Number.parseFloat(pricePerLiter);
    const literValue = liters.trim() ? Number.parseFloat(liters) : derivedLiters;

    if (!Number.isFinite(total) || total <= 0) {
      setFormError('Enter the total amount paid.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setFormError('Enter the price per liter.');
      return;
    }
    if (liters.trim() && (!Number.isFinite(literValue) || (literValue ?? 0) <= 0)) {
      setFormError('Liters must be greater than zero.');
      return;
    }
    if (!paidBy) {
      setFormError('Choose who paid.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt.trim())) {
      setFormError('Use the date format YYYY-MM-DD.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await createVehicleRefill({
        vehicleId,
        totalAmount: total,
        pricePerLiter: price,
        liters: literValue ?? null,
        fuelTypeId: vehicleFuelTypeId,
        loggedBy: currentUserId,
        paidBy,
        occurredAt: new Date(`${occurredAt.trim()}T12:00:00`).toISOString(),
        notes: notes.trim() || null,
        receiptRef: null,
      });
      resetForm();
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unable to save this refill.');
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    totalAmount,
    pricePerLiter,
    liters,
    derivedLiters,
    paidBy,
    occurredAt,
    notes,
    vehicleId,
    vehicleFuelTypeId,
    currentUserId,
    resetForm,
    load,
    onChanged,
  ]);

  const handleVoid = useCallback(
    async (refillId: string) => {
      try {
        await voidVehicleRefill(refillId);
        await load();
        onChanged?.();
      } catch {
        setError('Unable to void this refill.');
      }
    },
    [load, onChanged],
  );

  /** Confirmation before a destructive action. */
  const requestVoid = useCallback(
    (refillId: string) => {
      Alert.alert(
        'Void refill',
        'The record stays in history but stops counting as this vehicle’s latest refill. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Void refill',
            style: 'destructive',
            onPress: () => void handleVoid(refillId),
          },
        ],
      );
    },
    [handleVoid],
  );

  return (
    <>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityLabel={`Refill history for ${vehicleLabel}`}
          accessibilityRole="button"
          onPress={() => setHistoryOpen(true)}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          <Ionicons name="cash-outline" size={14} color={HomeColors.primary} />
          <Text style={styles.actionLabel}>
            Refills{loading ? '' : ` (${activeRefills.length})`}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Log refill for ${vehicleLabel}`}
          accessibilityRole="button"
          onPress={() => setFormOpen(true)}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
          <Ionicons name="add" size={14} color={HomeColors.primary} />
          <Text style={styles.actionLabel}>Log refill</Text>
        </Pressable>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
        transparent
        visible={historyOpen}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={styles.sheetTitles}>
                <Text style={styles.sheetTitle}>Refills</Text>
                <Text numberOfLines={1} style={styles.sheetSubtitle}>
                  {vehicleLabel}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setHistoryOpen(false)}>
                <Ionicons name="close" size={20} color={HomeColors.muted} />
              </Pressable>
            </View>

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            {loading ? (
              <View style={styles.state}>
                <ActivityIndicator color={HomeColors.primary} />
              </View>
            ) : error ? (
              <View style={styles.state}>
                <Text style={styles.stateText}>{error}</Text>
                <Pressable onPress={() => void load()} style={styles.retry}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : refills.length === 0 ? (
              <View style={styles.state}>
                <Text style={styles.stateText}>
                  No refills yet. Log the first one to start this vehicle&apos;s shared history.
                </Text>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={styles.listContent}
                data={refills}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={<PendingAllocationInbox onChanged={load} />}
                ListFooterComponent={
                  <PrimaryButton
                    label="Log refill"
                    onPress={() => {
                      setHistoryOpen(false);
                      setFormOpen(true);
                    }}
                    style={styles.footerBtn}
                  />
                }
                renderItem={({ item }) => (
                  <RefillRow
                    canAllocate={viewer.canAllocate}
                    actionLabel={viewer.actionLabel}
                    isOwnerAction={viewer.isOwner}
                    canVoid={isOwner || item.logged_by === currentUserId}
                    nameOf={nameOf}
                    onSplit={() => setSplitFor(item)}
                    onVoid={() => requestVoid(item.id)}
                    refill={item}
                  />
                )}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>

          {/*
            The split sheet lives INSIDE this already-presented modal on purpose.
            It used to be rendered as a sibling with its own <Modal>, but React
            Native cannot present a second modal while one is open, so the sheet
            mounted and never appeared -- the button looked dead. It is a plain
            overlay now, so it renders reliably on both platforms.
          */}
          {splitFor ? (
            <RefillSplitSheet
              currentUserId={currentUserId}
              mode={viewer.isOwner ? 'owner' : 'self'}
              onClose={() => setSplitFor(null)}
              onSaved={(message) => {
                setNotice(message);
                void load();
                onChanged?.();
              }}
              refill={splitFor}
              vehicleId={vehicleId}
              vehicleLabel={vehicleLabel}
            />
          ) : null}
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setFormOpen(false)}
        transparent
        visible={formOpen}>
        {/*
          The history sheet's own KeyboardAvoidingView is switched off while the
          split sheet is open. Two KeyboardAvoidingViews stacked inside a
          transparent Modal double-pad and fight each other; the split sheet
          measures the keyboard itself, so the parent must stay out of it.
        */}
        <KeyboardAvoidingView
          behavior={splitFor ? undefined : Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={styles.sheetTitles}>
                <Text style={styles.sheetTitle}>Log refill</Text>
                <Text numberOfLines={1} style={styles.sheetSubtitle}>
                  {vehicleLabel}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setFormOpen(false)}>
                <Ionicons name="close" size={20} color={HomeColors.muted} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <LabeledInput
                keyboardType="decimal-pad"
                label="Total amount paid (₱)"
                onChangeText={setTotalAmount}
                placeholder="e.g. 1500"
                value={totalAmount}
              />
              <LabeledInput
                keyboardType="decimal-pad"
                label="Price per liter (₱/L)"
                onChangeText={setPricePerLiter}
                placeholder="e.g. 64.20"
                value={pricePerLiter}
              />
              <LabeledInput
                keyboardType="decimal-pad"
                label="Liters (optional)"
                onChangeText={setLiters}
                placeholder={derivedLiters != null ? String(derivedLiters) : 'e.g. 23.36'}
                value={liters}
              />
              {derivedLiters != null && liters.trim() === '' ? (
                <Text style={styles.hint}>Calculated from total ÷ price per liter.</Text>
              ) : null}

              <SelectField
                label="Paid by"
                onChange={setPaidBy}
                options={memberOptions}
                placeholder="Choose who paid"
                value={paidBy ?? ''}
              />
              <LabeledInput
                autoCapitalize="none"
                autoCorrect={false}
                label="Date (YYYY-MM-DD)"
                onChangeText={setOccurredAt}
                placeholder="2026-09-26"
                value={occurredAt}
              />
              <LabeledInput
                label="Notes (optional)"
                onChangeText={setNotes}
                placeholder="Anything worth remembering"
                value={notes}
              />

              <Text style={styles.hint}>
                Logged by you automatically. Paid by can be any vehicle member.
              </Text>

              {formError ? <Text style={styles.formError}>{formError}</Text> : null}

              <PrimaryButton
                disabled={saving}
                label={saving ? 'Saving…' : 'Save refill'}
                onPress={() => void handleSave()}
                style={styles.footerBtn}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function RefillRow({
  refill,
  canVoid,
  canAllocate,
  actionLabel,
  isOwnerAction,
  nameOf,
  onVoid,
  onSplit,
}: {
  refill: VehicleRefill;
  canVoid: boolean;
  canAllocate: boolean;
  actionLabel: string;
  isOwnerAction: boolean;
  nameOf: (id: string) => string;
  onVoid: () => void;
  onSplit: () => void;
}) {
  const voided = refill.voided_at !== null;
  return (
    <View style={[styles.refillRow, voided && styles.refillRowVoided]}>
      <View style={styles.refillHead}>
        <Text style={styles.refillAmount}>{formatCurrency(refill.total_amount)}</Text>
        <Text style={styles.refillDate}>{formatDate(refill.occurred_at)}</Text>
      </View>
      <Text style={styles.refillMeta}>
        {formatCurrency(refill.price_per_liter)}/L
        {refill.liters != null ? ` · ${refill.liters} L` : ''}
      </Text>
      <Text style={styles.refillWho}>Paid by {nameOf(refill.paid_by)}</Text>
      <Text style={styles.refillWhoMuted}>Logged by {nameOf(refill.logged_by)}</Text>
      {voided ? (
        <Text style={styles.voidedTag}>Voided</Text>
      ) : (
        <View style={styles.rowActions}>
          {canVoid ? (
            <Pressable
              accessibilityLabel="Void refill"
              accessibilityRole="button"
              onPress={onVoid}
              style={({ pressed }) => [styles.voidBtn, pressed && styles.voidBtnPressed]}>
              <Ionicons name="close-circle-outline" size={15} color={palette.danger} />
              <Text style={styles.voidBtnText}>Void refill</Text>
            </Pressable>
          ) : null}

          {canAllocate ? (
            <Pressable
              accessibilityLabel={actionLabel}
              accessibilityRole="button"
              onPress={onSplit}
              style={({ pressed }) => [styles.splitBtn, pressed && styles.splitBtnPressed]}>
              <Ionicons
                name={isOwnerAction ? 'git-branch-outline' : 'wallet-outline'}
                size={15}
                color={HomeColors.primary}
              />
              <Text style={styles.splitBtnText}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  actionPressed: { backgroundColor: HomeColors.navySoft },
  actionLabel: {
    color: HomeColors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 42, 82, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: HomeColors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.md,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetTitles: { flex: 1, minWidth: 0 },
  sheetTitle: {
    color: HomeColors.navy,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },

  state: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  stateText: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
  },
  retryText: {
    color: HomeColors.primary,
    fontSize: 13,
    fontWeight: '700',
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  refillRow: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    marginBottom: spacing.sm,
  },
  refillRowVoided: { opacity: 0.55 },
  refillHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  refillAmount: {
    color: HomeColors.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  refillDate: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  refillMeta: {
    color: HomeColors.navy,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  refillWho: {
    color: HomeColors.navy,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  refillWhoMuted: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Compact but obvious destructive action — 40px tall, not a full-width block. */
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  voidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.danger,
    backgroundColor: 'rgba(220, 38, 38, 0.06)',
  },
  voidBtnPressed: {
    backgroundColor: 'rgba(220, 38, 38, 0.14)',
  },
  voidBtnText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  splitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.primary,
    backgroundColor: HomeColors.primarySoft,
  },
  splitBtnPressed: {
    backgroundColor: HomeColors.primarySoft,
    opacity: 0.7,
  },
  splitBtnText: {
    color: HomeColors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  voidedTag: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: spacing.sm,
  },

  notice: {
    color: HomeColors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  hint: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  formError: {
    color: GasTaColors.error,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  footerBtn: { marginTop: spacing.sm },
});
