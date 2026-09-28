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
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency, formatDate } from '@/lib/format';
import PendingAllocationInbox from '@/components/vehicle/PendingAllocationInbox';
import RefillSplitDraftSheet from '@/components/vehicle/RefillSplitDraftSheet';
import RefillSplitSheet from '@/components/vehicle/RefillSplitSheet';
import {
  createVehicleRefill,
  fetchVehicleMembers,
  fetchVehicleRefills,
  voidVehicleRefill,
} from '@/lib/services/vehicleRefills';
import { saveRefillSplit, type SplitAllocationInput } from '@/lib/services/refillAllocations';
import type { VehicleMember, VehicleRefill } from '@/types';

/**
 * Today's date as a `YYYY-MM-DD` input value, in the user's LOCAL calendar.
 *
 * This deliberately does not use `toISOString()`, which converts to UTC first.
 * The app targets a UTC+8 audience, so between local midnight and 08:00 the UTC
 * date is still "yesterday" and the refill form would have defaulted to, and
 * then saved, the wrong day.
 *
 * Local components are zero-padded by hand rather than relying on
 * `toLocaleDateString`, whose output format is locale-dependent.
 */
const todayInput = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

/**
 * Who carries the personal-budget charge for a refill just logged.
 *
 *   mine   — the whole amount is this person's own responsibility
 *   split  — open the existing split sheet for the new refill afterwards
 *   owner  — create no allocation at all; leave it for the owner
 *
 * This is deliberately NOT derived from `paid_by`. Paying at the station and
 * being charged for it are two different facts.
 */
type Responsibility = 'mine' | 'split' | 'owner';

/**
 * The refill form's own fields, used to key the inline validation state.
 *
 * These are exactly the fields the form has always validated. No new rule is
 * introduced here -- this type only names them so each one can carry its own
 * error message instead of a single message at the bottom of the sheet.
 */
type FieldKey = 'total' | 'price' | 'liters' | 'paidBy' | 'date';

type FieldErrors = Partial<Record<FieldKey, string>>;

/** Faint forest tint, matching the vehicle card and the auth surfaces. */
const TINT_BG = 'rgba(1, 68, 33, 0.06)';

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
  /**
   * Per-field validation, populated only after a Save attempt so untouched
   * fields are never red before the user has tried. `formError` stays reserved
   * for failures the form cannot attach to a field: RPC errors, network
   * failures, and anything raised while creating the refill.
   */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [splitFor, setSplitFor] = useState<VehicleRefill | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The PRE-SAVE split step, held while the user is still deciding.
   *
   * `null` means the flow is not in the split step. When set, no refill row
   * exists yet: the refill form has already validated, but persistence has NOT
   * started. That is what makes Cancel able to mean "back to my form, keep
   * editing" against an empty database.
   *
   * Deliberately separate from `splitFor`, which points at an ALREADY SAVED
   * refill and drives the real RefillSplitSheet from history. The two are never
   * mixed: see §14 of the change request.
   */
  const [splitDraft, setSplitDraft] = useState<{ totalAmount: number } | null>(null);
  const [splitDraftError, setSplitDraftError] = useState<string | null>(null);
  /**
   * Set only after the refill was created but its allocation failed. The refill
   * row exists at that point, so the split step is no longer "pre-save" and the
   * recovery has to reuse the real id rather than create anything again.
   */
  const [splitRecoveryRefill, setSplitRecoveryRefill] = useState<VehicleRefill | null>(null);

  const [totalAmount, setTotalAmount] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [liters, setLiters] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState(todayInput);
  const [notes, setNotes] = useState('');
  /** Defaults to "Mine" for every role, and is always visible before Save. */
  const [responsibility, setResponsibility] = useState<Responsibility>('mine');

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
    setFieldErrors({});
    setResponsibility('mine');
  }, []);

  /**
   * Every required-field rule the form has always applied, collected in one pass.
   *
   * It deliberately returns a map rather than reporting the first problem, so a
   * single Save marks every offending field at once instead of making the user
   * discover them one tap at a time. The messages are the existing ones,
   * unchanged, and no rule is new here:
   *
   *   total     required, must parse and be > 0
   *   price     required, must parse and be > 0
   *   liters    OPTIONAL -- only flagged when it was filled in with a bad value
   *   paidBy    required
   *   date      required, must be YYYY-MM-DD
   */
  const validateForm = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    const total = Number.parseFloat(totalAmount);
    const price = Number.parseFloat(pricePerLiter);
    const literValue = liters.trim() ? Number.parseFloat(liters) : derivedLiters;

    if (!Number.isFinite(total) || total <= 0) {
      next.total = 'Enter the total amount paid.';
    }
    if (!Number.isFinite(price) || price <= 0) {
      next.price = 'Enter the price per liter.';
    }
    if (liters.trim() && (!Number.isFinite(literValue) || (literValue ?? 0) <= 0)) {
      next.liters = 'Liters must be greater than zero.';
    }
    if (!paidBy) {
      next.paidBy = 'Choose who paid.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt.trim())) {
      next.date = 'Use the date format YYYY-MM-DD.';
    }
    return next;
  }, [totalAmount, pricePerLiter, liters, derivedLiters, paidBy, occurredAt]);

  /**
   * Drops a single field's error as soon as the user edits it, so a field that
   * has just been corrected stops looking invalid while the ones they have not
   * reached yet stay marked. Returns the same object identity when nothing
   * changes, which keeps this a no-op re-render in the common case.
   */
  const clearFieldError = useCallback((key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** Opening the form always starts clean, so no stale red fields reappear. */
  const openForm = useCallback(() => {
    setFieldErrors({});
    setFormError(null);
    setFormOpen(true);
  }, []);

  const activeRefills = useMemo(() => refills.filter((r) => r.voided_at === null), [refills]);

  /**
   * Whether this person owns the vehicle. The prop is what the CALLER decided
   * from where the panel was rendered; the member list is the fallback. Using
   * both keeps the option set and the split-sheet mode in agreement even if the
   * members query failed.
   */
  const ownerContext = isOwner || viewer.isOwner;

  const responsibilityHelper =
    responsibility === 'mine'
      ? 'The full amount will count toward your budget.'
      : responsibility === 'split'
        ? ownerContext
          ? 'Choose how the expense is divided. You will confirm the split before anything is saved.'
          : 'Choose how much you are responsible for. You will confirm it before anything is saved.'
        : 'No one is charged yet. You can set your share from refill history.';

  const saveLabel = saving
    ? 'Saving…'
    : responsibility === 'split'
      ? ownerContext
        ? 'Continue to split'
        : 'Continue to set my share'
      : 'Save refill';

  const handleSave = useCallback(async () => {
    if (saving) return; // blocks double taps

    // Validate everything first and show all of it at once. Nothing below this
    // runs unless the form is valid, so no partial save is possible.
    const invalid = validateForm();
    setFieldErrors(invalid);
    if (Object.keys(invalid).length > 0) return;

    const total = Number.parseFloat(totalAmount);
    const price = Number.parseFloat(pricePerLiter);
    const literValue = liters.trim() ? Number.parseFloat(liters) : derivedLiters;

    // `validateForm` has already proven the payer is set, but TypeScript cannot
    // see across the helper, so the value is re-bound and narrowed here at the
    // point of use. Same condition as the rule above -- not a second rule -- and
    // it still routes the user back to the field rather than throwing.
    const payer = paidBy;
    if (!payer) {
      setFieldErrors({ paidBy: 'Choose who paid.' });
      return;
    }

    setSaving(true);
    setFormError(null);

    // Read the choice before anything can reset the form.
    const chosen = responsibility;

    // --- the split step runs BEFORE anything is persisted -------------------
    // Splitting is the one responsibility that must NOT create the refill yet.
    // Creating it first is what made Cancel meaningless: the row already
    // existed, so backing out could only mean "keep the refill, drop the
    // split". Going to a local draft instead is what lets Cancel mean "go back
    // to my form and keep editing" with nothing written.
    //
    // The form is deliberately NOT reset and NOT cleared here -- every value
    // stays in component state so Cancel can reopen it exactly as it was, and
    // `responsibility` is still 'split' when the user comes back.
    if (chosen === 'split') {
      setSplitDraftError(null);
      setSplitRecoveryRefill(null);
      setSplitDraft({ totalAmount: total });
      setFormOpen(false);
      setSaving(false);
      return;
    }

    // --- stage 1: create the refill -----------------------------------------
    // Only reachable for 'mine' and 'owner'. Only a failure HERE is a real save
    // failure: the form stays open and nothing needs recovering.
    let created: VehicleRefill;
    try {
      created = await createVehicleRefill({
        vehicleId,
        totalAmount: total,
        pricePerLiter: price,
        liters: literValue ?? null,
        fuelTypeId: vehicleFuelTypeId,
        loggedBy: currentUserId,
        paidBy: payer,
        occurredAt: new Date(`${occurredAt.trim()}T12:00:00`).toISOString(),
        notes: notes.trim() || null,
        receiptRef: null,
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unable to save this refill.');
      setSaving(false);
      return;
    }

    // --- the refill now EXISTS ---------------------------------------------
    // Nothing below may delete it or re-run the create, or we would duplicate
    // the row. Every later failure degrades to an inline notice instead.
    resetForm();
    setFormOpen(false);

    if (chosen === 'owner') {
      // No allocation at all. The amount stays genuinely unassigned; nothing
      // is auto-assigned to the owner.
      void load();
      onChanged?.();
      setSaving(false);
      return;
    }

    // chosen === 'mine': assign the full amount to ourselves through the
    // existing RPC. The server already accepts a self-allocation immediately
    // (migration 20240812000026), so no new endpoint and no new permission.
    try {
      await saveRefillSplit(created.id, [{ userId: currentUserId, amount: total }]);
      setNotice('Refill saved and added to your budget.');
    } catch {
      // Partial success: the refill is saved and stays. The history row keeps
      // its Split expense / Set my share action, which is the recovery path.
      setNotice(
        "Refill saved, but we couldn't add it to your budget. You can set the expense from refill history.",
      );
    }
    setHistoryOpen(true);
    void load();
    onChanged?.();
    setSaving(false);
  }, [
    saving,
    validateForm,
    totalAmount,
    pricePerLiter,
    liters,
    derivedLiters,
    paidBy,
    occurredAt,
    notes,
    responsibility,
    vehicleId,
    vehicleFuelTypeId,
    currentUserId,
    resetForm,
    load,
    onChanged,
  ]);

  /**
   * Confirm the split. This is the FIRST moment anything is written.
   *
   * Order matters and is not retried: create the refill, then attach the
   * allocations to the id that came back. A failure at the first step leaves
   * nothing behind; a failure at the second leaves exactly one refill row and
   * hands the user the real split sheet for it, so there is never a duplicate
   * and never a split that exists without its refill.
   */
  const handleConfirmSplit = useCallback(
    async (payload: SplitAllocationInput[]) => {
      if (saving) return; // blocks double taps
      setSaving(true);
      setSplitDraftError(null);
      setSplitRecoveryRefill(null);

      const total = Number.parseFloat(totalAmount);
      const price = Number.parseFloat(pricePerLiter);
      const literValue = liters.trim() ? Number.parseFloat(liters) : derivedLiters;
      const payer = paidBy;
      if (!payer) {
        // Unreachable: the form validated this before entering the split step.
        // Bail back to the form rather than sending a bad request.
        setSplitDraft(null);
        setFormOpen(true);
        setFieldErrors({ paidBy: 'Choose who paid.' });
        setSaving(false);
        return;
      }

      // --- stage 1: create the refill ---------------------------------------
      let created: VehicleRefill;
      try {
        created = await createVehicleRefill({
          vehicleId,
          totalAmount: total,
          pricePerLiter: price,
          liters: literValue ?? null,
          fuelTypeId: vehicleFuelTypeId,
          loggedBy: currentUserId,
          paidBy: payer,
          occurredAt: new Date(`${occurredAt.trim()}T12:00:00`).toISOString(),
          notes: notes.trim() || null,
          receiptRef: null,
        });
      } catch (e) {
        // Case A: nothing was written. Stay in the split step with the draft
        // intact so the user can fix it or retry; no allocation is attempted.
        setSplitDraftError(
          e instanceof Error ? e.message : 'Unable to save this refill.',
        );
        setSaving(false);
        return;
      }

      // --- stage 2: attach the allocation to the id we just got -------------
      // The refill EXISTS from here on. There is deliberately no retry of the
      // create above, in this branch or in the recovery path.
      try {
        await saveRefillSplit(created.id, payload);
      } catch (e) {
        // Case B: partial success. The refill is saved and stays. Keep the step
        // open, remember the created row, and offer the real split sheet for
        // that exact id so the allocation can be finished without duplicating.
        setSplitRecoveryRefill(created);
        setSplitDraftError(
          `${e instanceof Error ? e.message : 'The split could not be saved.'} The refill is saved.`,
        );
        void load();
        onChanged?.();
        setSaving(false);
        return;
      }

      // --- both succeeded ---------------------------------------------------
      resetForm();
      setSplitDraft(null);
      setNotice(
        ownerContext
          ? 'Refill saved and the split is set.'
          : 'Refill saved and your share is set.',
      );
      setHistoryOpen(true);
      void load();
      onChanged?.();
      setSaving(false);
    },
    [
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
      ownerContext,
      resetForm,
      load,
      onChanged,
    ],
  );

  /**
   * Back out of the split step with nothing written.
   *
   * `splitDraft` was purely local, so discarding it is all that is needed. No
   * refill was ever created, no allocation exists, and every form value is
   * still in component state -- reopening the form shows exactly what the user
   * typed, with `responsibility` still on Split so they can confirm or change
   * it.
   */
  const handleCancelSplit = useCallback(() => {
    if (saving) return;
    const alreadyCreated = splitRecoveryRefill;

    setSplitDraft(null);
    setSplitDraftError(null);
    setSplitRecoveryRefill(null);

    if (alreadyCreated) {
      // The refill was created before its allocation failed, so it EXISTS.
      // Returning to the form here would invite a second, duplicate refill if
      // the user pressed save again, so Cancel ends the flow at history instead,
      // where the saved row still has its Split expense action.
      resetForm();
      setNotice('Refill saved, but the split could not be saved.');
      setHistoryOpen(true);
      void load();
      onChanged?.();
      return;
    }

    // Nothing was written. Straight back to the form, values intact.
    setFormOpen(true);
  }, [saving, splitRecoveryRefill, resetForm, load, onChanged]);

  /**
   * Abandon the split step once the refill has already been created, by
   * handing the real RefillSplitSheet the same id.
   *
   * From here the refill exists, so this is genuinely a history split: Cancel
   * from there means "keep the refill, drop the allocation edits", which is the
   * correct semantics for an already-saved refill.
   */
  const handleSplitRecovery = useCallback(() => {
    if (!splitRecoveryRefill) return;
    setSplitDraft(null);
    setSplitDraftError(null);
    setSplitRecoveryRefill(null);
    setSplitFor(splitRecoveryRefill);
    setHistoryOpen(true);
  }, [splitRecoveryRefill]);

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
        {/* Secondary: viewing history is always allowed, for every role. */}
        <Pressable
          accessibilityLabel={`Refill history for ${vehicleLabel}`}
          accessibilityRole="button"
          onPress={() => setHistoryOpen(true)}
          style={({ pressed }) => [
            styles.action,
            styles.actionSecondary,
            pressed && styles.actionSecondaryPressed,
          ]}>
          <Ionicons name="cash-outline" size={14} color={GasTaColors.forest} />
          <Text style={styles.actionSecondaryLabel}>
            Refills{loading ? '' : ` (${activeRefills.length})`}
          </Text>
        </Pressable>

        {/* Primary: logging a refill.
            A Viewer is a read-only role (it is deliberately absent from
            REFUILL_WRITE_ROLES and from the server's can_manage rules), so the
            affordance is hidden rather than left as a control that cannot
            succeed. This mirrors the existing `viewer.canAllocate` gate used
            inside the history sheet — it hides a button, it never grants one.
            Fails open when the member list could not load, so an owner whose
            members query failed does not lose the action. */}
        {viewer.role === 'Viewer' ? null : (
          <Pressable
            accessibilityLabel={`Log refill for ${vehicleLabel}`}
            accessibilityRole="button"
            onPress={openForm}
            style={({ pressed }) => [
              styles.action,
              styles.actionPrimary,
              pressed && styles.actionPrimaryPressed,
            ]}>
            <Ionicons name="add" size={14} color={GasTaColors.textOnForest} />
            <Text style={styles.actionPrimaryLabel}>Log refill</Text>
          </Pressable>
        )}
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
                <Ionicons name="close" size={20} color={GasTaColors.textSoft} />
              </Pressable>
            </View>

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            {loading ? (
              <View style={styles.state}>
                <ActivityIndicator color={GasTaColors.forest} />
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
                      openForm();
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
                <Ionicons name="close" size={20} color={GasTaColors.textSoft} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <LabeledInput
                error={fieldErrors.total}
                keyboardType="decimal-pad"
                label="Total amount paid (₱)"
                onChangeText={(text) => {
                  setTotalAmount(text);
                  clearFieldError('total');
                }}
                placeholder="e.g. 1500"
                value={totalAmount}
              />
              <LabeledInput
                error={fieldErrors.price}
                keyboardType="decimal-pad"
                label="Price per liter (₱/L)"
                onChangeText={(text) => {
                  setPricePerLiter(text);
                  clearFieldError('price');
                }}
                placeholder="e.g. 64.20"
                value={pricePerLiter}
              />
              <LabeledInput
                error={fieldErrors.liters}
                keyboardType="decimal-pad"
                label="Liters (optional)"
                onChangeText={(text) => {
                  setLiters(text);
                  clearFieldError('liters');
                }}
                placeholder={derivedLiters != null ? String(derivedLiters) : 'e.g. 23.36'}
                value={liters}
              />
              {derivedLiters != null && liters.trim() === '' ? (
                <Text style={styles.hint}>Calculated from total ÷ price per liter.</Text>
              ) : null}

              <SelectField
                error={fieldErrors.paidBy}
                label="Paid by"
                onChange={(next) => {
                  setPaidBy(next);
                  clearFieldError('paidBy');
                }}
                options={memberOptions}
                placeholder="Choose who paid"
                value={paidBy ?? ''}
              />
              <LabeledInput
                autoCapitalize="none"
                autoCorrect={false}
                error={fieldErrors.date}
                label="Date (YYYY-MM-DD)"
                onChangeText={(text) => {
                  setOccurredAt(text);
                  clearFieldError('date');
                }}
                placeholder="2026-09-26"
                value={occurredAt}
              />
              <LabeledInput
                label="Notes (optional)"
                onChangeText={setNotes}
                placeholder="Anything worth remembering"
                value={notes}
              />

              {/* ---- budget responsibility -------------------------------
                  The common case is a refill that belongs entirely to the
                  person who logged it, so that is a one-tap default rather
                  than a trip through refill history. The choice is always
                  visible before Save, so nothing is charged silently.

                  This is a real block with its own vertical space, not a bare
                  run of siblings. The label, the pills, the tertiary row and
                  the helper each get their own margin, so the helper can never
                  be pulled up into the control above it. */}
              <View style={styles.respSection}>
                <Text style={styles.respLabel}>Budget responsibility</Text>
                <View style={styles.respRow}>
                  <ResponsibilityPill
                    label="Mine"
                    onPress={() => setResponsibility('mine')}
                    selected={responsibility === 'mine'}
                  />
                  <ResponsibilityPill
                    label={ownerContext ? 'Split' : 'Set my share'}
                    onPress={() => setResponsibility('split')}
                    selected={responsibility === 'split'}
                  />
                </View>

                {/* Quiet tertiary option: create the refill with no allocation
                    at all and let the owner decide from refill history. */}
                {!ownerContext ? (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel="Leave for owner to split"
                    accessibilityState={{ selected: responsibility === 'owner' }}
                    hitSlop={8}
                    onPress={() => setResponsibility('owner')}
                    style={styles.respQuietRow}>
                    <Ionicons
                      name={responsibility === 'owner' ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={GasTaColors.textSoft}
                    />
                    <Text
                      style={[
                        styles.respQuietText,
                        responsibility === 'owner' && styles.respQuietTextOn,
                      ]}>
                      Leave for owner to split
                    </Text>
                  </Pressable>
                ) : null}

                <Text style={styles.respHelper}>{responsibilityHelper}</Text>
              </View>

              {formError ? <Text style={styles.formError}>{formError}</Text> : null}

              <PrimaryButton
                disabled={saving}
                label={saveLabel}
                onPress={() => void handleSave()}
                style={styles.formSaveBtn}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/*
        The PRE-SAVE split step, shown only after the form has validated and only
        while no refill row exists yet.

        It is a sibling of the form modal rather than a child, so the form keeps
        its state and this sheet gets its own KeyboardAvoidingView instead of
        nesting two of them -- the same double-padding problem the history sheet
        had to work around. Closing it returns to the form untouched.
      */}
      {splitDraft ? (
        <RefillSplitDraftSheet
          currentUserId={currentUserId}
          error={splitDraftError}
          members={members}
          mode={ownerContext ? 'owner' : 'self'}
          onCancel={handleCancelSplit}
          onConfirm={(payload) => void handleConfirmSplit(payload)}
          onRecovery={handleSplitRecovery}
          recoveryLabel={
            splitRecoveryRefill ? 'Finish the split in refill history' : null
          }
          cancelLabel={splitRecoveryRefill ? 'Close' : 'Cancel'}
          saving={saving}
          totalAmount={splitDraft.totalAmount}
          vehicleLabel={vehicleLabel}
        />
      ) : null}
    </>
  );
}

function ResponsibilityPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.respPill, selected && styles.respPillOn]}>
      {selected ? <Ionicons name="checkmark" size={13} color={GasTaColors.textOnForest} /> : null}
      <Text style={[styles.respPillText, selected && styles.respPillTextOn]}>{label}</Text>
    </Pressable>
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
                color={GasTaColors.forest}
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
    borderTopColor: GasTaColors.glassBorderSubtle,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  // Primary "Log refill": the one filled forest action on the card.
  actionPrimary: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: GasTaColors.forest,
  },
  actionPrimaryPressed: {
    backgroundColor: GasTaColors.forestDark,
  },
  actionPrimaryLabel: {
    color: GasTaColors.textOnForest,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  // Secondary "Refills (N)": a quiet outlined peer that never competes.
  actionSecondary: {
    backgroundColor: GasTaColors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  actionSecondaryPressed: {
    backgroundColor: TINT_BG,
  },
  actionSecondaryLabel: {
    color: GasTaColors.forest,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  actionPressed: { backgroundColor: TINT_BG },
  actionLabel: {
    color: GasTaColors.forest,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },

  backdrop: {
    flex: 1,
    // Was the old navy `rgba(14, 42, 82, 0.35)`. Replaced with a forestDark scrim
    // so the scrim belongs to the GasTa canvas. Opacity kept restrained, and the
    // modal's size, maxHeight, animation and keyboard handling are untouched.
    backgroundColor: 'rgba(1, 48, 25, 0.38)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: GasTaColors.cream,
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
    color: GasTaColors.forestDark,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: GasTaColors.textSoft,
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
    color: GasTaColors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: TINT_BG,
  },
  retryText: {
    color: GasTaColors.forest,
    fontSize: 13,
    fontWeight: '700',
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  // ---- budget responsibility control ---------------------------------------
  respLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: GasTaColors.textMuted,
    marginTop: spacing.sm,
  },
  respRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  respPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    flex: 1,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  respPillOn: {
    backgroundColor: GasTaColors.forest,
    borderColor: GasTaColors.forest,
  },
  respPillText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  respPillTextOn: {
    color: GasTaColors.textOnForest,
    fontWeight: '700',
  },
  respQuietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  respQuietText: {
    fontSize: 12,
    lineHeight: 16,
    color: GasTaColors.textSoft,
  },
  respQuietTextOn: {
    color: GasTaColors.forest,
    fontWeight: '700',
  },

  refillRow: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
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
    color: GasTaColors.forest,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  refillDate: {
    color: GasTaColors.textSoft,
    fontSize: 12,
    lineHeight: 16,
  },
  refillMeta: {
    color: GasTaColors.forestDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  refillWho: {
    color: GasTaColors.forestDark,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  refillWhoMuted: {
    color: GasTaColors.textSoft,
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
    borderColor: GasTaColors.forest,
    backgroundColor: TINT_BG,
  },
  splitBtnPressed: {
    backgroundColor: TINT_BG,
    opacity: 0.7,
  },
  splitBtnText: {
    color: GasTaColors.forest,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  voidedTag: {
    color: GasTaColors.textSoft,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: spacing.sm,
  },

  notice: {
    color: GasTaColors.forest,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    // Extra tail room so the last content (the responsibility helper) always
    // scrolls clear of the Save button, and so a validation message appearing
    // under the lowest field is never pinned under it.
    paddingBottom: spacing.xl * 2,
  },
  hint: {
    color: GasTaColors.textSoft,
    fontSize: 11,
    lineHeight: 15,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  /**
   * The budget-responsibility block owns its own vertical space.
   *
   * The helper text used to share the `hint` style, whose negative `marginTop`
   * is a tightening hack that only makes sense after a LabeledInput (which has
   * its own bottom margin). Reused here, where the pills above carry no bottom
   * margin, it dragged the helper up into the control and left the Save button
   * with almost no breathing room -- which is what the overlap was. Every part
   * of the block now spaces itself positively instead.
   */
  respSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  respHelper: {
    color: GasTaColors.textSoft,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  formError: {
    color: GasTaColors.error,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  footerBtn: { marginTop: spacing.sm },
  /** The form's primary action sits a full step below the responsibility block. */
  formSaveBtn: { marginTop: spacing.lg },
});
