import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { Text } from '@/components/Themed';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SelectField, { type SelectOption } from '@/components/ui/SelectField';
import { GasTaColors, GasTaRadius, GasTaSpacing, colors, palette, radii, shadow, spacing, typeScale } from '@/constants/Theme';
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
import { fetchAllocationsForRefills, splitErrorMessage, saveRefillSplit, type SplitAllocationInput } from '@/lib/services/refillAllocations';
import { currentRefillShare, splitSuccessResult, type SplitResult } from './refillSplitShared';
import type { RefillAllocation, VehicleMember, VehicleRefill } from '@/types';

type HistoryFilter = 'all' | 'this-month' | 'last-month' | 'choose-month';
type HistoryMonth = { year: number; month: number };

function calendarMonth(date = new Date()): HistoryMonth {
  return { year: date.getFullYear(), month: date.getMonth() };
}

function shiftMonth(value: HistoryMonth, offset: number): HistoryMonth {
  return calendarMonth(new Date(value.year, value.month + offset, 1));
}

function monthLabel(value: HistoryMonth): string {
  return new Date(value.year, value.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Local occurred_at calendar months; filter preserves the service's existing order. */
function filterRefillHistory(rows: VehicleRefill[], month: HistoryMonth | null): VehicleRefill[] {
  if (!month) return rows;
  return rows.filter((row) => {
    const occurred = new Date(row.occurred_at);
    return occurred.getFullYear() === month.year && occurred.getMonth() === month.month;
  });
}

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

type RefillResult = {
  visible: boolean;
  type: 'success' | 'error';
  summary?: string;
  showHistory?: boolean;
};

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
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [chosenHistoryMonth, setChosenHistoryMonth] = useState<HistoryMonth>(() => calendarMonth());
  const [draftHistoryMonth, setDraftHistoryMonth] = useState<HistoryMonth>(() => calendarMonth());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const formScrollRef = useRef<ScrollView>(null);
  const formScrollOffset = useRef(0);
  const focusedFieldRef = useRef<View | null>(null);
  const fieldScrollFrame = useRef<number | null>(null);
  const revealFormField = useCallback((target: View | null) => {
    focusedFieldRef.current = target;
    if (fieldScrollFrame.current !== null) cancelAnimationFrame(fieldScrollFrame.current);
    if (!target || !Keyboard.isVisible()) return;
    fieldScrollFrame.current = requestAnimationFrame(() => {
      fieldScrollFrame.current = null;
      const scroll = formScrollRef.current;
      if (!scroll || focusedFieldRef.current !== target) return;
      scroll.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        target.measureInWindow((_fieldX, fieldTop, _fieldWidth, fieldHeight) => {
          if (focusedFieldRef.current !== target || !Keyboard.isVisible()) return;
          const bottom = Math.min(top + height, Keyboard.metrics()?.screenY ?? top + height) - GasTaSpacing.md;
          const overflow = fieldTop + fieldHeight - bottom;
          if (overflow > 0) scroll.scrollTo({ y: formScrollOffset.current + overflow, animated: true });
        });
      });
    });
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    const shown = Keyboard.addListener('keyboardDidShow', () => revealFormField(focusedFieldRef.current));
    const hidden = Keyboard.addListener('keyboardDidHide', () => { focusedFieldRef.current = null; });
    return () => {
      shown.remove();
      hidden.remove();
      focusedFieldRef.current = null;
      if (fieldScrollFrame.current !== null) cancelAnimationFrame(fieldScrollFrame.current);
    };
  }, [formOpen, revealFormField]);
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Per-field validation, populated only after a Save attempt so untouched
   * fields are never red before the user has tried. `formError` stays reserved
   * for failures the form cannot attach to a field: RPC errors, network
   * failures, and anything raised while creating the refill.
   */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [historyAllocations, setHistoryAllocations] = useState<RefillAllocation[] | null>(null);
  const [splitFor, setSplitFor] = useState<VehicleRefill | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refillResult, setRefillResult] = useState<RefillResult>({ visible: false, type: 'success' });
  const pendingSplitRef = useRef<{ totalAmount: number } | null>(null);
  const pendingResultRef = useRef<RefillResult | null>(null);
  const formModalPresentedRef = useRef(false);
  const afterResultDismissRef = useRef<'form' | 'history' | null>(null);
  const resultAnimation = useRef(new Animated.Value(0)).current;

  const showPendingResult = useCallback(() => {
    const pending = pendingResultRef.current;
    if (!pending) return;
    pendingResultRef.current = null;
    setRefillResult({ ...pending, visible: true });
  }, []);

  const finishResultDismiss = useCallback(() => {
    const next = afterResultDismissRef.current;
    afterResultDismissRef.current = null;
    if (next === 'form') setFormOpen(true);
    if (next === 'history') setHistoryOpen(true);
  }, []);

  const queueRefillResult = useCallback((result: Omit<RefillResult, 'visible'>) => {
    Keyboard.dismiss();
    setFormOpen(false);
    if (Platform.OS === 'ios' && !formModalPresentedRef.current) {
      setRefillResult({ ...result, visible: true });
    } else {
      pendingResultRef.current = { ...result, visible: true };
      setRefillResult({ ...result, visible: false });
    }
  }, []);

  // iOS waits for native onDismiss. Android/web unmount the hidden Modal;
  // present the next one on the frame after that React commit.
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    let frame: number | undefined;
    if (!formOpen && pendingResultRef.current) {
      frame = requestAnimationFrame(showPendingResult);
    } else if (!refillResult.visible && afterResultDismissRef.current) {
      frame = requestAnimationFrame(finishResultDismiss);
    }
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [formOpen, refillResult, showPendingResult, finishResultDismiss]);

  useEffect(() => {
    if (!refillResult.visible) return;
    resultAnimation.setValue(0);
    const animation = Animated.timing(resultAnimation, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [refillResult.visible, resultAnimation]);

  /**
   * The PRE-SAVE split step, held while the user is still deciding.
   *
   * `null` means the flow is not in the split step. Initially no refill row
   * exists: the refill form has already validated, but persistence has NOT
   * started. That is what makes Cancel able to mean "back to my form, keep
   * editing" against an empty database.
   *
   * Deliberately separate from `splitFor`, which points at an ALREADY SAVED
   * refill and drives the real RefillSplitSheet from history. The two are never
   * mixed: see §14 of the change request.
   */
  const [splitDraft, setSplitDraft] = useState<{ totalAmount: number } | null>(null);
  const splitSubmitLock = useRef(false);
  const createdSplitRefill = useRef<VehicleRefill | null>(null);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [splitDraftVisible, setSplitDraftVisible] = useState(false);
  const afterSplitDismiss = useRef<(() => void) | null>(null);
  const finishSplitDismiss = useCallback(() => {
    const action = afterSplitDismiss.current;
    if (!action) return;
    afterSplitDismiss.current = null;
    setSplitDraft(null);
    action();
  }, []);
  const closeSplitDraft = useCallback((action: () => void) => {
    afterSplitDismiss.current = action;
    setSplitDraftVisible(false);
  }, []);
  const showPendingSplit = useCallback(() => {
    const pending = pendingSplitRef.current;
    if (!pending) return;
    pendingSplitRef.current = null;
    setSplitDraft(pending);
    setSplitDraftVisible(true);
  }, []);
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    let frame: number | undefined;
    if (!formOpen && pendingSplitRef.current) frame = requestAnimationFrame(showPendingSplit);
    else if (!splitDraftVisible && afterSplitDismiss.current) frame = requestAnimationFrame(finishSplitDismiss);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [formOpen, splitDraftVisible, showPendingSplit, finishSplitDismiss]);
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
      const allocationRows = await fetchAllocationsForRefills(refillRows.filter((row) => row.voided_at === null).map((row) => row.id)).catch(() => null);
      setHistoryAllocations(allocationRows);
      setRefills(refillRows);
      setMembers(memberRows);
    } catch (e) {
      setHistoryAllocations(null);
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

  const dismissRefillResult = useCallback(() => {
    if (refillResult.type === 'success') {
      resetForm();
      afterResultDismissRef.current = refillResult.showHistory ? 'history' : null;
    } else {
      afterResultDismissRef.current = 'form';
    }
    // Freeze the content throughout the native dismissal animation.
    setRefillResult((current) => ({ ...current, visible: false }));
  }, [refillResult.type, refillResult.showHistory, resetForm]);

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

  const currentHistoryMonth = calendarMonth();
  const filterMonth = historyFilter === 'all' ? null
    : historyFilter === 'this-month' ? currentHistoryMonth
      : historyFilter === 'last-month' ? shiftMonth(currentHistoryMonth, -1)
        : chosenHistoryMonth;
  const filteredRefills = useMemo(
    () => filterRefillHistory(refills, filterMonth),
    [refills, historyFilter, filterMonth?.year, filterMonth?.month],
  );

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
      if (splitSubmitLock.current) return;
      splitSubmitLock.current = true;
      // The panel's member list may predate a sharing change. Refresh only
      // when entering the split, before presenting selectable recipients.
      try {
        const currentMembers = await fetchVehicleMembers(vehicleId);
        setMembers(currentMembers);
      } catch {
        setFormError('We couldn’t load the people for this split. Please try again.');
        splitSubmitLock.current = false;
        setSaving(false);
        return;
      }
      createdSplitRefill.current = null;
      setSplitResult(null);
      setSplitDraftError(null);
      setSplitRecoveryRefill(null);
      pendingSplitRef.current = { totalAmount: total };
      if (Platform.OS === 'ios' && !formModalPresentedRef.current) showPendingSplit();
      setFormOpen(false);
      splitSubmitLock.current = false;
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
    } catch {
      queueRefillResult({ type: 'error' });
      setSaving(false);
      return;
    }

    // --- the refill now EXISTS ---------------------------------------------
    // Nothing below may delete it or re-run the create, or we would duplicate
    // the row. Every later failure degrades to an inline notice instead.
    // Capture the already-validated saved figures before Done resets the form.
    const savedSummary = `${formatCurrency(total)}${literValue != null && Number.isFinite(literValue) ? ` • ${literValue.toFixed(2)} L` : ''}`;

    if (chosen === 'owner') {
      // No allocation at all. The amount stays genuinely unassigned; nothing
      // is auto-assigned to the owner.
      await load();
      onChanged?.();
      queueRefillResult({ type: 'success', summary: savedSummary, showHistory: false });
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
    await load();
    onChanged?.();
    queueRefillResult({ type: 'success', summary: savedSummary, showHistory: true });
    setSaving(false);
  }, [
    saving,
    showPendingSplit,
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
    queueRefillResult,
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
      if (splitSubmitLock.current || saving || splitResult || !splitDraft) return;
      splitSubmitLock.current = true;
      setSaving(true);
      setSplitDraftError(null);
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
        splitSubmitLock.current = false;
        setSaving(false);
        return;
      }

      // --- stage 1: create the refill ---------------------------------------
      let created: VehicleRefill;
      try {
        created = createdSplitRefill.current ?? await createVehicleRefill({
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
        createdSplitRefill.current = created;
      } catch (e) {
        // Case A: nothing was written. Stay in the split step with the draft
        // intact so the user can fix it or retry; no allocation is attempted.
        setSplitResult({ type: 'error', message: splitErrorMessage(e) });
        setSaving(false);
        return;
      }

      // --- stage 2: attach the allocation to the id we just got -------------
      // The refill EXISTS from here on. There is deliberately no retry of the
      // create above, in this branch or in the recovery path.
      let savedAllocations: RefillAllocation[];
      try {
        savedAllocations = await saveRefillSplit(created.id, payload);
      } catch (e) {
        // Case B: partial success. The refill is saved and stays. Keep the step
        // open, remember the created row, and offer the real split sheet for
        // that exact id so the allocation can be finished without duplicating.
        setSplitRecoveryRefill(created);
        setSplitResult({ type: 'error', message: splitErrorMessage(e) });
        await load();
        setSaving(false);
        return;
      }

      // Keep the draft and native sheet mounted until Done. A parent reload
      // can unmount this panel, so notify it only after the popup is dismissed.
      await load();
      setSplitResult(splitSuccessResult(savedAllocations, currentUserId, Number(created.total_amount)));
      setSaving(false);
    },
    [
      saving,
      splitDraft,
      splitResult,
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
    if (splitSubmitLock.current || saving || splitResult) return;
    const alreadyCreated = splitRecoveryRefill;

    setSplitDraftError(null);
    setSplitRecoveryRefill(null);
    createdSplitRefill.current = null;

    if (alreadyCreated) {
      // The refill was created before its allocation failed, so it EXISTS.
      // Returning to the form here would invite a second, duplicate refill if
      // the user pressed save again, so Cancel ends the flow at history instead,
      // where the saved row still has its Split expense action.
      resetForm();
      setNotice('Refill saved, but the split could not be saved.');
      closeSplitDraft(() => { setHistoryOpen(true); void load(); onChanged?.(); });
      return;
    }

    // Nothing was written. Wait for the native split sheet to dismiss first.
    closeSplitDraft(() => setFormOpen(true));
  }, [saving, splitResult, splitRecoveryRefill, resetForm, load, onChanged, closeSplitDraft]);

  /**
   * Abandon the split step once the refill has already been created, by
   * handing the real RefillSplitSheet the same id.
   *
   * From here the refill exists, so this is genuinely a history split: Cancel
   * from there means "keep the refill, drop the allocation edits", which is the
   * correct semantics for an already-saved refill.
   */
  const handleSplitRecovery = useCallback(() => {
    if (splitSubmitLock.current || splitResult || !splitRecoveryRefill) return;
    createdSplitRefill.current = null;
    setSplitDraftError(null);
    setSplitRecoveryRefill(null);
    closeSplitDraft(() => { setSplitFor(splitRecoveryRefill); setHistoryOpen(true); });
  }, [splitRecoveryRefill, splitResult, closeSplitDraft]);

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
        onRequestClose={() => { if (monthPickerOpen) setMonthPickerOpen(false); else if (!splitFor) setHistoryOpen(false); }}
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

            <View style={styles.historyFilters}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyFilterChips}>
                {([
                  ['all', 'All'], ['this-month', 'This month'],
                  ['last-month', 'Last month'], ['choose-month', 'Choose month'],
                ] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: historyFilter === value }}
                    onPress={() => {
                      if (value === 'choose-month') {
                        setDraftHistoryMonth(filterMonth ?? calendarMonth());
                        setMonthPickerOpen(true);
                      } else setHistoryFilter(value);
                    }}
                    style={({ pressed }) => [styles.historyFilterChip, historyFilter === value && styles.historyFilterChipSelected, pressed && styles.historyFilterChipPressed]}>
                    <Text style={[styles.historyFilterText, historyFilter === value && styles.historyFilterTextSelected]}>{label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {!loading && !error ? (
                <Text accessibilityLiveRegion="polite" style={styles.historyFilterCount}>
                  {filteredRefills.length} {filteredRefills.length === 1 ? 'refill' : 'refills'}{filterMonth ? ` · ${monthLabel(filterMonth)}` : ''}
                </Text>
              ) : null}
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
            ) : refills.length === 0 && historyFilter === 'all' ? (
              <View style={styles.state}>
                <Text style={styles.stateText}>
                  No refills yet. Log the first one to start this vehicle&apos;s shared history.
                </Text>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={styles.listContent}
                data={filteredRefills}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={refills.length > 0 ? <PendingAllocationInbox onChanged={load} /> : null}
                ListEmptyComponent={
                  <View style={styles.state}>
                    <Text style={styles.historyEmptyTitle}>No refills found</Text>
                    <Text style={styles.stateText}>No refill records for this month.</Text>
                    <PrimaryButton label="Show all" variant="secondary" size="sm" onPress={() => setHistoryFilter('all')} />
                  </View>
                }
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
                    allocations={historyAllocations?.filter((row) => row.refill_id === item.id) ?? null}
                    currentUserId={currentUserId}
                    refill={item}
                  />
                )}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>

          {monthPickerOpen ? (
            <View accessibilityViewIsModal style={[styles.rowMenuBackdrop, styles.monthPickerOverlay]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel month selection" onPress={() => setMonthPickerOpen(false)} style={styles.monthPickerDismissArea} />
              <View style={styles.monthPickerCard}>
                <Text accessibilityRole="header" style={styles.historyEmptyTitle}>Choose month</Text>
                <View style={styles.monthPickerNavigation}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setDraftHistoryMonth((month) => shiftMonth(month, -1))} style={styles.monthPickerArrow}>
                    <Ionicons name="chevron-back" size={20} color={GasTaColors.forest} />
                  </Pressable>
                  <Text accessibilityLiveRegion="polite" style={styles.monthPickerLabel}>{monthLabel(draftHistoryMonth)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setDraftHistoryMonth((month) => shiftMonth(month, 1))} style={styles.monthPickerArrow}>
                    <Ionicons name="chevron-forward" size={20} color={GasTaColors.forest} />
                  </Pressable>
                </View>
                <View style={styles.monthPickerActions}>
                  <PrimaryButton label="Cancel" variant="secondary" onPress={() => setMonthPickerOpen(false)} style={styles.monthPickerButton} />
                  <PrimaryButton label="Apply" onPress={() => {
                    setChosenHistoryMonth(draftHistoryMonth);
                    setHistoryFilter('choose-month');
                    setMonthPickerOpen(false);
                  }} style={styles.monthPickerButton} />
                </View>
              </View>
            </View>
          ) : null}

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
        onShow={() => { formModalPresentedRef.current = true; }}
        onDismiss={() => {
          formModalPresentedRef.current = false;
          showPendingResult();
          showPendingSplit();
        }}
        transparent
        visible={formOpen}>
        {/*
          The history sheet's own KeyboardAvoidingView is switched off while the
          split sheet is open. Two KeyboardAvoidingViews stacked inside a
          transparent Modal double-pad and fight each other; the split sheet
          measures the keyboard itself, so the parent must stay out of it.
        */}
        <KeyboardAvoidingView
          behavior={splitFor ? undefined : Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
          style={styles.backdrop}>
          <View style={[styles.sheet, styles.refillFormSheet]}>
            <View style={[styles.sheetHead, styles.refillFormHead]}>
              <View style={styles.refillFormIcon}>
                <Ionicons name="water" size={22} color={GasTaColors.white} />
              </View>
              <View style={styles.sheetTitles}>
                <Text style={styles.sheetTitle}>Log refill</Text>
                <Text style={styles.refillFormIntro}>
                  Record this vehicle's latest fuel purchase.
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
              ref={formScrollRef}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScroll={(event) => { formScrollOffset.current = event.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
              onLayout={() => revealFormField(focusedFieldRef.current)}
              onContentSizeChange={() => revealFormField(focusedFieldRef.current)}
              showsVerticalScrollIndicator={false}>
              <View style={styles.vehicleSummary}>
                <View style={styles.vehicleSummaryIcon}>
                  <Ionicons name="car-outline" size={20} color={GasTaColors.forest} />
                </View>
                <View style={styles.sheetTitles}>
                  <Text style={styles.summaryLabel}>Refilling</Text>
                  <Text numberOfLines={2} style={styles.summaryVehicle}>{vehicleLabel}</Text>
                </View>
              </View>

              <View style={[styles.formSection, styles.fuelSection]}>
                <View style={styles.formSectionHead}>
                  <Ionicons name="water-outline" size={18} color={GasTaColors.forest} style={styles.sectionIcon} />
                  <Text style={styles.formSectionTitle}>Fuel amount</Text>
                </View>
                <View style={styles.totalCard}>
                <RefillFormField
                  error={fieldErrors.total}
                  onReveal={revealFormField}
                  amount
                  unit="₱"
                  keyboardType="decimal-pad"
                  label="Total amount paid (₱)"
                  onChangeText={(text) => {
                    setTotalAmount(text);
                    clearFieldError('total');
                  }}
                  placeholder="e.g. 1500"
                  value={totalAmount}
                />
                </View>
                <View style={styles.fuelInputRow}>
                <RefillFormField
                  error={fieldErrors.price}
                  compact
                  onReveal={revealFormField}
                  unit="₱/L"
                  keyboardType="decimal-pad"
                  label="Price per liter"
                  onChangeText={(text) => {
                    setPricePerLiter(text);
                    clearFieldError('price');
                  }}
                  placeholder="e.g. 64.20"
                  value={pricePerLiter}
                />
                <RefillFormField
                  error={fieldErrors.liters}
                  compact
                  onReveal={revealFormField}
                  unit="L"
                  keyboardType="decimal-pad"
                  label="Liters (optional)"
                  onChangeText={(text) => {
                    setLiters(text);
                    clearFieldError('liters');
                  }}
                  placeholder={derivedLiters != null ? String(derivedLiters) : 'e.g. 23.36'}
                  value={liters}
                />
                </View>
                {derivedLiters != null && liters.trim() === '' ? (
                  <Text style={styles.hint}>Calculated from total ÷ price per liter.</Text>
                ) : null}
              </View>

              <View style={styles.formSection}>
                <View style={styles.formSectionHead}>
                  <Ionicons name="calendar-outline" size={18} color={GasTaColors.forest} style={styles.sectionIcon} />
                  <Text style={styles.formSectionTitle}>Refill details</Text>
                </View>
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
                <RefillFormField
                  onReveal={revealFormField}
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
              </View>

              <View style={styles.formSection}>
                <View style={styles.formSectionHead}>
                  <Ionicons name="document-text-outline" size={18} color={GasTaColors.forest} style={styles.sectionIcon} />
                  <Text style={styles.formSectionTitle}>Notes</Text>
                </View>
                <RefillFormField
                  onReveal={revealFormField}
                  label="Notes (optional)"
                  onChangeText={setNotes}
                  placeholder="Anything worth remembering"
                  value={notes}
                />
              </View>

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

              {formError ? (
                <Text style={styles.formError}>We couldn’t save this refill right now. Please try again.</Text>
              ) : null}

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
          visible={splitDraftVisible}
          onDismiss={finishSplitDismiss}
          result={splitResult}
          onDismissResult={() => {
            const success = splitResult?.type === 'success';
            splitSubmitLock.current = false;
            setSplitResult(null);
            if (success) {
              resetForm();
              createdSplitRefill.current = null;
              setSplitRecoveryRefill(null);
              setNotice('Refill saved and the split is set.');
              closeSplitDraft(() => { setHistoryOpen(true); onChanged?.(); });
            }
          }}
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

      {/* Stable result host, independent of the form/history/split subtrees. */}
      <Modal
        animationType="fade"
        transparent
        visible={refillResult.visible}
        onRequestClose={dismissRefillResult}
        onDismiss={finishResultDismiss}>
        <View style={styles.resultBackdrop}>
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.resultCard,
              refillResult.type === 'error' && styles.resultCardError,
              {
                opacity: resultAnimation,
                transform: [{ scale: resultAnimation.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
              },
            ]}>
            <View style={[styles.resultIcon, refillResult.type === 'error' && styles.resultIconError]}>
              <Ionicons
                name={refillResult.type === 'success' ? 'checkmark-circle' : 'alert-circle-outline'}
                size={38}
                color={refillResult.type === 'success' ? GasTaColors.forest : palette.warning}
              />
            </View>
            <Text accessibilityRole="header" style={styles.resultTitle}>
              {refillResult.type === 'success' ? 'Refill saved' : "Couldn't save refill"}
            </Text>
            <Text style={styles.resultMessage}>
              {refillResult.type === 'success'
                ? 'Your refill has been recorded successfully.'
                : "We couldn't save this refill right now. Please try again."}
            </Text>
            {refillResult.type === 'success' && refillResult.summary ? (
              <Text style={styles.resultSummary}>{refillResult.summary}</Text>
            ) : null}
            <PrimaryButton
              label={refillResult.type === 'success' ? 'Done' : 'Try again'}
              onPress={dismissRefillResult}
              style={styles.formSaveBtn}
            />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

/** Form-only presentation; values, keyboards and validation stay with the caller. */
function RefillFormField({
  label, error, unit, amount = false, compact = false, onReveal, ...inputProps
}: TextInputProps & {
  label: string;
  error?: string;
  unit?: string;
  amount?: boolean;
  compact?: boolean;
  onReveal: (target: View | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const fieldRef = useRef<View>(null);
  return (
    <View ref={fieldRef} collapsable={false} style={[styles.formField, compact && styles.formFieldCompact]}>
      <Text style={[styles.formFieldLabel, focused && styles.formFieldLabelFocused]}>
        {amount ? <><Ionicons name="receipt-outline" size={14} color={GasTaColors.forest} />{' '}</> : null}
        {label}
      </Text>
      <View style={[
        styles.formInputSurface,
        amount && styles.formInputAmount,
        focused && styles.formInputFocused,
        error && styles.formInputInvalid,
      ]}>
        {amount && unit ? <Text style={styles.amountUnit}>{unit}</Text> : null}
        <TextInput
          {...inputProps}
          accessibilityLabel={label}
          placeholderTextColor={GasTaColors.textSoft}
          onFocus={() => {
            setFocused(true);
            onReveal(fieldRef.current);
          }}
          onBlur={() => {
            setFocused(false);
            onReveal(null);
          }}
          style={[styles.formInput, amount && styles.formAmountInput]}
        />
        {!amount && unit ? <Text style={styles.formUnit}>{unit}</Text> : null}
      </View>
      {error ? <Text style={styles.formFieldError}>{error}</Text> : null}
    </View>
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
      {selected ? <Ionicons name="checkmark" size={13} color={GasTaColors.forest} /> : null}
      <Text style={[styles.respPillText, selected && styles.respPillTextOn]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One saved refill, shared by owned and shared vehicle history.
 *
 * Personal responsibility leads; the full transaction and fuel metadata stay
 * visible underneath. `Paid by` and `Logged by` stay distinct facts on one line,
 * and the second
 * identity is only spelled out when it differs from the first, since for most
 * refills the person who paid is the person who logged it.
 *
 * The destructive action lives in an overflow menu rather than beside the
 * normal one, so a row of ordinary refills is not mostly buttons. The
 * confirmation Alert and the void handler itself are unchanged.
 */
function RefillRow({
  refill,
  allocations,
  currentUserId,
  canVoid,
  canAllocate,
  actionLabel,
  isOwnerAction,
  nameOf,
  onVoid,
  onSplit,
}: {
  refill: VehicleRefill;
  allocations: RefillAllocation[] | null;
  currentUserId: string;
  canVoid: boolean;
  canAllocate: boolean;
  actionLabel: string;
  isOwnerAction: boolean;
  nameOf: (id: string) => string;
  onVoid: () => void;
  onSplit: () => void;
}) {
  const voided = refill.voided_at !== null;
  const share = allocations ? currentRefillShare(allocations, currentUserId, voided) : null;
  const showShare = !voided && share?.hasAllocations;
  const splitRefill = showShare && (share.amount !== Number(refill.total_amount) || (allocations?.filter((row) => row.status === 'accepted' || row.status === 'pending').length ?? 0) > 1);
  const pendingShare = share?.status === 'pending';
  const [menuOpen, setMenuOpen] = useState(false);

  const dateLabel = formatDate(refill.occurred_at);
  const payer = nameOf(refill.paid_by);
  const logger = nameOf(refill.logged_by);
  // "Paid by Danna" reads "Paid by Danna · Logged by Marc" only when the two
  // really are different people.
  const samePerson = refill.paid_by === refill.logged_by;

  // No contextual action means no menu at all, rather than a menu holding a
  // disabled Void.
  const showOverflow = canVoid && !voided;
  const showSplit = canAllocate && !voided;

  return (
    <View style={[styles.refillRow, voided && styles.refillRowVoided]}>
      <View style={styles.refillHead}>
        <View style={[styles.refillFuelIcon, voided && styles.refillFuelIconVoided]}>
          <Ionicons name="water-outline" size={18} color={voided ? GasTaColors.forestMuted : GasTaColors.forest} />
        </View>
        <View style={styles.refillHeaderTitles}>
          <Text style={[styles.refillTitle, voided && styles.refillTitleVoided]}>Fuel refill</Text>
          <Text style={styles.refillDate}>{dateLabel}</Text>
        </View>
        {voided ? (
          <View style={styles.voidedChip}>
            <Text style={styles.voidedChipText}>Voided</Text>
          </View>
        ) : null}
      </View>

      <View style={[
        styles.refillAmountGroup,
        showShare && styles.refillShareSurface,
        pendingShare && styles.refillPendingSurface,
      ]}>
        <Text style={[styles.refillAmountLabel, showShare && styles.refillShareLabel, pendingShare && styles.refillPendingLabel]}>
          {showShare ? pendingShare ? 'Your proposed share' : 'Your share' : 'Total refill'}
        </Text>
        <Text style={[styles.refillAmount, pendingShare && styles.refillPendingAmount, voided && styles.refillAmountVoided]}>
          {formatCurrency(showShare ? share.amount : refill.total_amount)}
        </Text>
        {showShare ? (
          <>
            {pendingShare ? (
              <View style={styles.refillPendingRow}>
                <View style={styles.refillPendingBadge}><Text style={styles.refillPendingLabel}>Pending</Text></View>
                <Text style={styles.refillContext}>Not counted in budget</Text>
              </View>
            ) : null}
            <Text style={styles.refillContext}>Total refill: {formatCurrency(refill.total_amount)}</Text>
          </>
        ) : !voided ? (
          <Text style={styles.refillContext}>{allocations === null ? 'Share unavailable' : 'No responsibility assigned'}</Text>
        ) : null}
      </View>

      <View style={styles.refillMetadata}>
        {refill.liters != null ? (
          <View style={styles.refillMetaChip}>
            <Text style={styles.refillMeta}>{refill.liters} L</Text>
          </View>
        ) : null}
        <View style={styles.refillMetaChip}>
          <Text style={styles.refillMeta}>{formatCurrency(refill.price_per_liter)}/L</Text>
        </View>
        {showShare ? (
          <View style={styles.refillSplitChip}>
            <Text style={styles.refillSplitBadge}>{splitRefill ? 'Split refill' : 'Your responsibility'}</Text>
          </View>
        ) : null}
      </View>

      <Text numberOfLines={1} style={styles.refillWho}>
        Paid by {payer}
        {samePerson ? '' : ` · Logged by ${logger}`}
      </Text>

      {showSplit || showOverflow ? (
        <View style={styles.rowActions}>
          {showSplit ? (
            <Pressable
              accessibilityLabel={`${actionLabel} for the refill on ${dateLabel}`}
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

          {showOverflow ? (
            <Pressable
              accessibilityLabel={`More actions for refill on ${dateLabel}`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setMenuOpen(true)}
              style={({ pressed }) => [styles.rowMore, pressed && styles.rowMorePressed]}>
              <Ionicons
                name="ellipsis-vertical"
                size={16}
                color={GasTaColors.textSoft}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/*
        Per-row overflow. The confirmation Alert below is still what actually
        voids the refill; this only moves the affordance that reaches it.
      */}
      <Modal
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
        transparent
        visible={menuOpen}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={() => setMenuOpen(false)}
          style={styles.rowMenuBackdrop}>
          <View pointerEvents="box-none" style={styles.rowMenuWrap}>
            <View style={styles.rowMenu}>
              <Text style={styles.rowMenuHeading}>Refill on {dateLabel}</Text>
              <Pressable
                accessibilityLabel={`Void refill from ${dateLabel}`}
                accessibilityRole="menuitem"
                onPress={() => {
                  setMenuOpen(false);
                  onVoid();
                }}
                style={({ pressed }) => [
                  styles.rowMenuItem,
                  pressed && styles.rowMenuItemPressed,
                ]}>
                <Ionicons name="trash-outline" size={16} color={palette.danger} />
                <Text style={[styles.rowMenuItemText, styles.rowMenuItemDanger]}>
                  Void refill
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  resultBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 48, 25, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: GasTaSpacing.lg,
  },
  resultCard: {
    width: '100%',
    maxWidth: 360,
    padding: GasTaSpacing.lg,
    borderRadius: GasTaRadius.lg,
    backgroundColor: GasTaColors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.forestBorder,
    alignItems: 'center',
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  resultCardError: {
    borderColor: colors.warningBorder,
  },
  resultIcon: {
    ...shadow('light', 'sm'),
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: GasTaColors.forestGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: GasTaSpacing.md,
  },
  resultIconError: {
    backgroundColor: colors.warningSoft,
  },
  resultTitle: {
    ...typeScale.pageTitle,
    color: GasTaColors.forestDark,
    textAlign: 'center',
  },
  resultMessage: {
    fontSize: 14,
    lineHeight: 21,
    color: GasTaColors.textMuted,
    textAlign: 'center',
    marginTop: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },
  resultSummary: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.forest,
    backgroundColor: TINT_BG,
    paddingHorizontal: GasTaSpacing.sm + GasTaSpacing.xs,
    paddingVertical: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    marginBottom: GasTaSpacing.md,
  },
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
    color: GasTaColors.forestDark,
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
    backgroundColor: palette.primarySoft,
    borderColor: GasTaColors.forest,
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: GasTaColors.forest, inset: true }],
  },
  respPillText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  respPillTextOn: {
    color: GasTaColors.forest,
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

  historyFilters: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
  historyFilterChips: { gap: spacing.xs, paddingVertical: spacing.xs },
  historyFilterChip: { paddingHorizontal: spacing.sm + spacing.xs, minHeight: 34, justifyContent: 'center', borderRadius: GasTaRadius.pill, backgroundColor: GasTaColors.creamLight, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle },
  historyFilterChipSelected: { backgroundColor: GasTaColors.forest, borderColor: GasTaColors.forest },
  historyFilterChipPressed: { opacity: 0.8 },
  historyFilterText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '600' },
  historyFilterTextSelected: { color: GasTaColors.white },
  historyFilterCount: { color: GasTaColors.textMuted, fontSize: 11 },
  historyEmptyTitle: { color: GasTaColors.forestDark, fontSize: 16, fontWeight: '700' },
  monthPickerOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  monthPickerDismissArea: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  monthPickerCard: { ...shadow('light', 'sm'), width: '100%', maxWidth: 360, backgroundColor: GasTaColors.white, borderRadius: GasTaRadius.lg, borderWidth: 1, borderColor: GasTaColors.forestBorder, padding: spacing.md, gap: spacing.md },
  monthPickerNavigation: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  monthPickerArrow: { width: 40, height: 40, borderRadius: GasTaRadius.sm, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  monthPickerLabel: { flex: 1, textAlign: 'center', color: GasTaColors.forestDark, fontSize: 16, fontWeight: '700' },
  monthPickerActions: { flexDirection: 'row', gap: spacing.sm },
  monthPickerButton: { flex: 1 },

  // One shared renderer for owned/shared history; transaction and personal share remain distinct.
  refillRow: {
    ...shadow('light', 'sm'),
    padding: spacing.sm + spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.glassFillStrong,
    marginBottom: spacing.sm + spacing.xs,
  },
  refillRowVoided: {
    backgroundColor: GasTaColors.creamLight,
    borderColor: GasTaColors.glassBorderSubtle,
    shadowOpacity: 0,
    elevation: 0,
  },
  refillHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  refillFuelIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: GasTaColors.forestGlow,
    alignItems: 'center', justifyContent: 'center',
  },
  refillFuelIconVoided: { backgroundColor: GasTaColors.creamDark },
  refillHeaderTitles: { flex: 1, minWidth: 0, gap: 2 },
  refillTitle: { color: GasTaColors.forestDark, fontSize: 13, fontWeight: '700' },
  refillTitleVoided: { color: GasTaColors.forestMuted },
  refillDate: { color: GasTaColors.textMuted, fontSize: 11, lineHeight: 15 },
  refillAmountGroup: { minWidth: 0, gap: 4, marginTop: spacing.sm },
  refillShareSurface: {
    backgroundColor: palette.primarySoft,
    borderRadius: GasTaRadius.sm,
    padding: spacing.sm + spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.forestBorder,
  },
  refillPendingSurface: { backgroundColor: GasTaColors.creamLight, borderColor: colors.warningBorder },
  refillAmountLabel: { color: GasTaColors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  refillShareLabel: { color: GasTaColors.forestMuted },
  refillContext: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 17 },
  refillPendingAmount: { color: GasTaColors.forestMuted },
  refillPendingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  refillPendingBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: GasTaRadius.pill, backgroundColor: colors.warningSoft },
  refillPendingLabel: { color: palette.warning, fontSize: 10, fontWeight: '700' },
  refillAmount: { minWidth: 0, color: GasTaColors.forestDark, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  refillAmountVoided: { color: GasTaColors.textMuted, textDecorationLine: 'line-through' },
  refillMetadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  refillMetaChip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: GasTaRadius.sm, backgroundColor: GasTaColors.creamLight },
  refillMeta: { color: GasTaColors.forestMuted, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  refillSplitChip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: GasTaRadius.pill, backgroundColor: palette.primarySoft },
  refillSplitBadge: { color: GasTaColors.forest, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  refillWho: { color: GasTaColors.textMuted, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  voidedChip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: GasTaColors.creamDark },
  voidedChipText: { color: GasTaColors.forestMuted, fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 0.3 },
  /** Actions sit on one short line: the normal one left, overflow right. */
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rowMore: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    marginLeft: 'auto',
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
    padding: spacing.lg,
  },
  rowMenu: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
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
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  rowMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  rowMenuItemPressed: {
    backgroundColor: TINT_BG,
  },
  rowMenuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  rowMenuItemDanger: {
    fontWeight: '700',
    color: palette.danger,
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
  notice: {
    color: GasTaColors.forest,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  formContent: {
    paddingHorizontal: GasTaSpacing.md,
    // Extra tail room so the last content (the responsibility helper) always
    // scrolls clear of the Save button, and so a validation message appearing
    // under the lowest field is never pinned under it.
    paddingBottom: spacing.xl * 2,
  },
  hint: {
    color: GasTaColors.forestMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  // Responsibility keeps its own card and positive spacing around the controls.
  respSection: {
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.creamLight,
    borderRadius: GasTaRadius.md,
    padding: GasTaSpacing.sm + GasTaSpacing.xs,
    marginBottom: GasTaSpacing.md,
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
  // The existing save/split label and action share one full-width CTA.
  formSaveBtn: {
    ...shadow('light', 'sm'),
    width: '100%',
    minHeight: 50,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs,
    backgroundColor: GasTaColors.forest,
    borderColor: GasTaColors.forest,
    marginTop: GasTaSpacing.xs,
  },
  refillFormSheet: {
    ...shadow('light', 'sm'),
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  refillFormHead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
    gap: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.md,
  },
  refillFormIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GasTaColors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refillFormIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textMuted,
    marginTop: GasTaSpacing.xs,
  },
  vehicleSummary: {
    ...shadow('light', 'sm'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    padding: GasTaSpacing.sm + GasTaSpacing.xs,
    backgroundColor: GasTaColors.glassFillStrong,
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: GasTaColors.forestBorder, inset: true }],
    borderRadius: GasTaRadius.md,
    marginBottom: GasTaSpacing.md,
  },
  vehicleSummaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GasTaColors.forestGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: GasTaColors.textMuted,
  },
  summaryVehicle: {
    ...typeScale.cardTitle,
    color: GasTaColors.forestDark,
  },
  formSection: {
    padding: GasTaSpacing.sm + GasTaSpacing.xs,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.creamLight,
    marginBottom: GasTaSpacing.md,
    gap: GasTaSpacing.sm,
  },
  fuelSection: {
    ...shadow('light', 'sm'),
    backgroundColor: GasTaColors.white,
    borderColor: GasTaColors.forestBorder,
    borderLeftWidth: 3,
    borderLeftColor: GasTaColors.forest,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    lineHeight: 28,
    textAlign: 'center',
    borderRadius: 14,
    backgroundColor: GasTaColors.forestGlow,
  },
  formSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.xs,
  },
  formSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  totalCard: {
    padding: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    backgroundColor: palette.primarySoft,
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 2, color: GasTaColors.forestBorder, inset: true }],
  },
  fuelInputRow: {
    flexDirection: 'row',
    gap: GasTaSpacing.sm,
  },
  formField: {
    minWidth: 0,
    gap: GasTaSpacing.xs,
  },
  formFieldCompact: {
    flex: 1,
  },
  formFieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  formFieldLabelFocused: {
    color: GasTaColors.forest,
    fontWeight: '700',
  },
  formInputSurface: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderRadius: GasTaRadius.sm + GasTaSpacing.xs,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.white,
    paddingHorizontal: GasTaSpacing.sm,
    gap: GasTaSpacing.xs,
  },
  formInputAmount: {
    backgroundColor: GasTaColors.white,
  },
  formInputFocused: {
    borderColor: GasTaColors.forest,
    backgroundColor: palette.primarySoft,
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: GasTaColors.forest, inset: true }],
  },
  formInputInvalid: {
    borderColor: GasTaColors.error,
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: GasTaColors.error, inset: true }],
  },
  formInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: GasTaSpacing.sm,
    fontSize: 15,
    color: GasTaColors.forestDark,
  },
  formAmountInput: {
    fontSize: 24,
    fontWeight: '700',
  },
  amountUnit: {
    fontSize: 20,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  formUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: GasTaColors.forestMuted,
  },
  formFieldError: {
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.error,
  },
});
