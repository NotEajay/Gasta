import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Text } from '@/components/Themed';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { fetchVehicleMembers } from '@/lib/services/vehicleRefills';
import {
  fetchRefillAllocationSummary,
  fetchRefillAllocations,
  saveRefillSplit,
  splitErrorMessage,
} from '@/lib/services/refillAllocations';
import {
  buildSplitPayload,
  fromCents,
  memberLabel,
  sortEligibleMembers,
  splitSheetStyles,
  SplitMemberRow,
  toCents,
  parseDraftCents,
  validateSplitDraft,
  SplitResultPopup,
  type SplitResult,
  splitSuccessResult,
} from './refillSplitShared';
import type {
  RefillAllocation,
  RefillAllocationStatus,
  RefillAllocationSummary,
  VehicleMember,
  VehicleRefill,
} from '@/types';

interface Props {
  refill: VehicleRefill;
  vehicleId: string;
  vehicleLabel: string;
  currentUserId: string;
  /**
   * 'owner' renders the full split manager. 'self' renders the simplified
   * "Set my share" sheet used by Member / Driver / Operator, which never shows
   * an editable field for anyone else. Mirrors migration 027.
   */
  mode: 'owner' | 'self';
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}

const STATUS_TEXT: Record<RefillAllocationStatus, string> = {
  accepted: 'Accepted',
  pending: 'Pending approval',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Restrained, low-emphasis status colours -- no heavy badges. */
const STATUS_COLOR: Record<RefillAllocationStatus, string> = {
  accepted: palette.success,
  pending: palette.warning,
  rejected: HomeColors.muted,
  cancelled: HomeColors.muted,
};

/**
 * Money is compared in cents to avoid float drift on 2dp amounts.
 *
 * toCents / fromCents are imported from refillSplitShared so the pre-save split
 * draft and this saved-refill sheet round money through the exact same
 * function and cannot drift apart.
 */

const EMPTY_SUMMARY: RefillAllocationSummary = {
  reserved: 0,
  acceptedTotal: 0,
  pendingTotal: 0,
  unassigned: 0,
};

export default function RefillSplitSheet({
  refill,
  vehicleId,
  vehicleLabel,
  currentUserId,
  mode,
  onClose,
  onSaved,
}: Props) {
  const [allocations, setAllocations] = useState<RefillAllocation[]>([]);
  const [summary, setSummary] = useState<RefillAllocationSummary>(EMPTY_SUMMARY);
  const [members, setMembers] = useState<VehicleMember[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const savedMessage = useRef('Split saved.');
  const [result, setResult] = useState<SplitResult | null>(null);
  const showResult = (next: SplitResult) => {
    submitLock.current = true;
    setResult(next);
  };
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Keyboard height is tracked explicitly rather than with a
   * KeyboardAvoidingView. This sheet is rendered inside the refill-history
   * Modal, which has its own KeyboardAvoidingView, and two of them stacked in a
   * transparent Modal fight each other: the inner one measures its frame against
   * the keyboard window, which is unreliable there, and the pair double-pads.
   * The parent is disabled while this sheet is open (see VehicleRefillPanel) so
   * this value is the single source of truth.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardOpen = keyboardHeight > 0;

  useEffect(() => {
    // keyboardWillChangeFrame gives the smooth iOS animation curve and also
    // covers interactive dismissal, which keyboardWillShow does not.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      const next = e.endCoordinates?.height ?? 0;
      setKeyboardHeight((current) => (current > 0 ? current : next));
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /** Which row currently holds focus, and the refs needed to find it. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  /**
   * A plain View wrapping the ScrollView, because this project's react-native
   * type surface does not expose measureInWindow on ScrollView itself. A View
   * ref does, and it reports the same viewport frame.
   */
  const viewportRef = useRef<View>(null);
  const rowRefs = useRef<Record<string, View | null>>({});
  const scrollYRef = useRef(0);

  /**
   * Brings the focused amount row fully into view.
   *
   * Measured rather than hardcoded: the viewport is located in window
   * coordinates, the row is located in window coordinates, and the difference is
   * the row's offset inside the viewport. If the row is not comfortably inside
   * it, the list scrolls by exactly that difference. This works for the first,
   * a middle, and the last row, and after the keyboard has already resized the
   * sheet, because it re-measures every time instead of assuming an offset.
   */
  const scrollRowIntoView = useCallback((userId: string) => {
    const row = rowRefs.current[userId];
    const viewport = viewportRef.current;
    if (!row || !viewport) return;

    const PAD = 12;
    viewport.measureInWindow((_vx: number, viewY: number, _vw: number, viewH: number) => {
      row.measureInWindow((_rx: number, rowY: number, _rw: number, rowH: number) => {
        const top = rowY - viewY;
        const bottom = top + rowH;
        if (top >= PAD && bottom <= viewH - PAD) return;
        const next = Math.max(0, scrollYRef.current + (top - PAD));
        scrollRef.current?.scrollTo({ y: next, animated: true });
      });
    });
  }, []);

  // Re-run once the keyboard has actually resized the sheet, otherwise the
  // measurement above happens against the pre-keyboard layout.
  useEffect(() => {
    if (!keyboardOpen || !focusedId) return;
    const timer = setTimeout(() => scrollRowIntoView(focusedId), 60);
    return () => clearTimeout(timer);
  }, [keyboardOpen, focusedId, scrollRowIntoView]);

  const handleFocus = useCallback(
    (userId: string) => {
      setFocusedId(userId);
      // If the keyboard is already up the layout is settled, so scroll at once.
      if (keyboardOpen) scrollRowIntoView(userId);
    },
    [keyboardOpen, scrollRowIntoView],
  );

  /**
   * Eligible recipients, from the shared rule so this sheet and the pre-save
   * draft offer exactly the same people in exactly the same order.
   */
  const eligibleMembers = useMemo(() => sortEligibleMembers(members), [members]);

  /**
   * Every open refetches the CURRENT eligible collaborators alongside the
   * allocations and the summary.
   *
   * The member list is deliberately NOT taken from the parent: that list is
   * captured when the refill panel mounts, so a collaborator added afterwards
   * through the sharing flow never appeared here until an app restart. Fetching
   * it here means closing the sheet, adding someone, and reopening is enough.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, totals, memberRows] = await Promise.all([
        fetchRefillAllocations(refill.id),
        fetchRefillAllocationSummary(refill.id),
        fetchVehicleMembers(vehicleId),
      ]);

      setLoaded(true);
      setAllocations(rows);
      setSummary(totals);
      setMembers(memberRows);

      // Seed the inputs from what is already spoken for, so a reopen shows the
      // real figures rather than a blank form.
      const seeded: Record<string, string> = {};
      for (const row of rows) {
        if (row.status === 'accepted' || row.status === 'pending') {
          seeded[row.user_id] = String(row.amount);
        }
      }
      setDraft(seeded);
    } catch (e) {
      setLoaded(false);
      setError('We couldn’t load the split right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [refill.id, vehicleId]);

  // Mounted only while a refill is selected, so load on mount is enough and
  // reopening always refetches.
  useEffect(() => {
    void load();
  }, [load]);

  const allocationByUser = useMemo(() => {
    const map = new Map<string, RefillAllocation>();
    for (const row of allocations) map.set(row.user_id, row);
    return map;
  }, [allocations]);

  /**
   * Only the vehicle owner manages the whole split. Member / Driver / Operator
   * are not split managers: they choose how much of the refill they personally
   * take responsibility for. Mirrors the rule in save_refill_split (migration
   * 027), which is the real authority -- the disabled inputs here are only
   * presentation.
   */
  const isVehicleOwner = useMemo(
    () => members.some((m) => m.role === 'Owner' && m.user_id === currentUserId),
    [members, currentUserId],
  );

  /**
   * Own row: always editable, at any time, whatever its status.
   * Someone else's row: only the owner may touch it, and only while it is still
   * pending. Once another person has accepted, that amount is locked to them.
   */
  const canEditRow = useCallback(
    (member: VehicleMember, existing: RefillAllocation | undefined) => {
      if (member.user_id === currentUserId) return true;
      if (!isVehicleOwner) return false;
      return existing?.status !== 'accepted';
    },
    [currentUserId, isVehicleOwner],
  );

  const myMember = useMemo(
    () => eligibleMembers.find((m) => m.user_id === currentUserId) ?? null,
    [eligibleMembers, currentUserId],
  );

  const myAllocation = useMemo(
    () => (myMember ? (allocationByUser.get(myMember.user_id) ?? null) : null),
    [allocationByUser, myMember],
  );

  /**
   * Read-only "Current split" rows for a non-owner. Excludes the caller (their
   * own editable field is shown separately) and anything cancelled or rejected,
   * which no longer reserves money.
   */
  const otherSplitRows = useMemo(
    () =>
      eligibleMembers
        .filter((m) => m.user_id !== currentUserId)
        .map((m) => ({ member: m, allocation: allocationByUser.get(m.user_id) ?? null }))
        .filter((row) => row.allocation?.status === 'accepted' || row.allocation?.status === 'pending'),
    [allocationByUser, currentUserId, eligibleMembers],
  );

  const myDraftCents = parseDraftCents(draft[currentUserId]);

  // Name only. The role is shown on the second line, so appending "· Owner"
  // here as well would read "Dad · Owner" over "Owner · Accepted".
  const labelFor = useCallback(
    (member: VehicleMember) => memberLabel(member),
    [],
  );

  // What the user is typing right now, in cents.
  const draftCents = useMemo(() => {
    // Accepted shares of removed people still reserve money. Pending shares
    // omitted by the owner are retired; self saves leave everyone else's rows alone.
    const editableIds = new Set(eligibleMembers.filter((m) => canEditRow(m, allocationByUser.get(m.user_id))).map((m) => m.user_id));
    const retained = allocations.filter((a) => !editableIds.has(a.user_id) &&
      (a.status === 'accepted' || (!isVehicleOwner && a.status === 'pending')));
    return retained.reduce((sum, a) => sum + toCents(a.amount), 0) +
      [...editableIds].reduce((sum, id) => sum + parseDraftCents(draft[id]), 0);
  }, [eligibleMembers, canEditRow, allocationByUser, allocations, isVehicleOwner, draft]);

  const refillCents = toCents(refill.total_amount);
  const draftUnassigned = fromCents(Math.max(refillCents - draftCents, 0));
  const overBudget = draftCents > refillCents;

  // True when the form differs from what is actually saved.
  const hasUnsavedEdits = eligibleMembers.some((m) => canEditRow(m, allocationByUser.get(m.user_id)) &&
    parseDraftCents(draft[m.user_id]) !== toCents(['accepted', 'pending'].includes(allocationByUser.get(m.user_id)?.status ?? '') ? allocationByUser.get(m.user_id)?.amount ?? 0 : 0));

  const handleSave = async () => {
    if (submitLock.current || loading || !loaded || result) return;
    if (!myMember || refill.voided_at) {
      showResult({ type: 'error', message: !myMember ? 'You no longer have permission to update this refill.' : 'This refill is no longer available for splitting.' });
      return;
    }
    // Only send rows this user is permitted to write.
    const editable = eligibleMembers.filter((m) => canEditRow(m, allocationByUser.get(m.user_id)));

    // Blank/zero rows remain unassigned. Own existing shares need explicit
    // zero to retire them; omitting only cancels pending proposals for owners.
    const validation = validateSplitDraft(draft, editable);
    if (validation) { setError(validation); return; }
    const payload = buildSplitPayload(draft, editable);
    // Zero explicitly retires the caller's existing share. Omitting it does not.
    for (const member of editable) {
      if (member.user_id === currentUserId && ['accepted', 'pending'].includes(allocationByUser.get(member.user_id)?.status ?? '') && parseDraftCents(draft[member.user_id]) === 0) {
        payload.push({ userId: member.user_id, amount: 0 });
      }
    }

    const hasPositive = payload.length > 0;
    // All-zero is only meaningful if it actually retires an existing row.
    const hasExisting =
      editable.some((m) => allocationByUser.get(m.user_id)?.status === 'accepted') ||
      editable.some((m) => allocationByUser.get(m.user_id)?.status === 'pending');

    if (!hasPositive && !hasExisting) {
      setError('Complete the split before saving.');
      return;
    }
    if (overBudget) {
      setError('Split total is greater than the refill amount.');
      return;
    }

    submitLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRefillSplit(refill.id, payload);
      const needsApproval = saved.some(
        (row) => row.status === 'pending' && row.user_id !== currentUserId,
      );
      savedMessage.current = needsApproval ? 'Split saved. Waiting for approval.' : 'Split saved.';
      // Refresh locally without reseeding the user's draft on a failed save.
      const [rows, totals] = await Promise.all([fetchRefillAllocations(refill.id), fetchRefillAllocationSummary(refill.id)]);
      setAllocations(rows);
      setSummary(totals);
      showResult(splitSuccessResult(rows, currentUserId, Number(refill.total_amount)));
    } catch (e) {
      showResult({ type: 'error', message: splitErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Abandon the draft and close.
   *
   * `draft` is local state, so unmounting the sheet is what actually discards
   * the edits: the next open re-seeds it from the server in `load()`. Nothing
   * here writes -- no saveRefillSplit, no allocation write, no void. For a
   * refill created moments ago through "Save & split" the refill itself simply
   * stays saved with no split attached, which is what cancelling means.
   *
   * The header Close/X and the footer Cancel both run this same path. There is
   * no confirmation on either, matching the sheet's existing behaviour.
   */
  const handleCancel = useCallback(() => {
    if (submitLock.current || result) return;
    onClose();
  }, [result, onClose]);

  return (
    // Deliberately NOT a <Modal>.
    //
    // This sheet is opened from a row inside the refill-history <Modal>, which is
    // already presented. React Native cannot present a second <Modal> while one
    // is open -- iOS silently drops the presentation, so the sheet mounted but
    // never appeared and the "Split expense" button looked dead. Rendering a
    // plain absolutely-positioned overlay inside the already-presented history
    // modal keeps the same slide-up look and works on both platforms.
    <View style={styles.root}>
      <Pressable
        accessibilityLabel="Close split sheet"
        accessibilityRole="button"
        onPress={handleCancel}
        style={styles.backdrop}
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        {/* The keyboard height is applied here as real padding, so the sheet is
            pushed up by exactly the right amount and the ScrollView shrinks
            into whatever space is left. */}
        <View style={[styles.sheet, { paddingBottom: keyboardHeight }]}>
          <View style={styles.head}>
            <View style={styles.titles}>
              <Text style={styles.title}>
                {mode === 'owner' ? 'Split expense' : 'Set my share'}
              </Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {vehicleLabel} · {formatDate(refill.occurred_at)}
              </Text>
            </View>
            <PrimaryButton
              label="Close"
              variant="secondary"
              size="sm"
              onPress={handleCancel}
              disabled={saving}
            />
          </View>

          <View style={styles.totalCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Refill total</Text>
              <Text style={styles.totalValue}>{formatCurrency(refill.total_amount)}</Text>
            </View>
            <View style={styles.divider} />

            {loading ? (
              <View style={styles.summaryLoading}>
                <ActivityIndicator color={HomeColors.primary} />
                <Text style={styles.loadingText}>Loading split…</Text>
              </View>
            ) : !loaded && error ? (
              // Load failures surface in the sheet itself. The button must never
              // look dead: if the Phase 2 migrations are missing, the reason is
              // shown here with a way to retry.
              <View style={styles.errorBlock}>
                <Ionicons name="alert-circle-outline" size={22} color={palette.danger} />
                <Text style={styles.errorBody}>{error}</Text>
                <PrimaryButton
                  label="Retry"
                  variant="secondary"
                  size="sm"
                  onPress={load}
                  style={styles.retryBtn}
                />
              </View>
            ) : (
              <>
                {/* Saved state. Rejected and cancelled are excluded by the
                    server, so they never appear here and never hold money. */}
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Accepted</Text>
                  <Text style={[styles.summaryValue, { color: STATUS_COLOR.accepted }]}>
                    {formatCurrency(summary.acceptedTotal)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Pending</Text>
                  <Text style={[styles.summaryValue, { color: STATUS_COLOR.pending }]}>
                    {formatCurrency(summary.pendingTotal)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Unassigned</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.unassigned)}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Allocated</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(summary.reserved)} / {formatCurrency(refill.total_amount)}
                  </Text>
                </View>
                <Text style={styles.totalHint}>
                  Unassigned stays unassigned. It is never charged to the owner unless an
                  amount is entered for them.
                </Text>
              </>
            )}
          </View>


          {!loading && loaded ? (
            <View ref={viewportRef} style={styles.viewport}>
              <ScrollView
                ref={scrollRef}
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                  scrollYRef.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive">
              {mode === 'self' ? (
                <>
                  {/* The single editable field. Nothing else is an input. */}
                  <View
                    ref={(node) => {
                      rowRefs.current[currentUserId] = node;
                    }}
                    style={styles.shareCard}>
                    <Text style={styles.helperTitle}>Your share</Text>
                    <Text style={styles.helperBody}>
                      Choose how much of this refill you want to take responsibility for.
                    </Text>

                    {myAllocation?.status === 'pending' ? (
                      <View style={styles.proposedBox}>
                        <Ionicons
                          name="information-circle-outline"
                          size={14}
                          color={palette.warning}
                        />
                        <Text style={styles.proposedText}>
                          The owner proposed {formatCurrency(myAllocation.amount)} for you. Accept
                          or reject it from your pending requests, or set your own amount below.
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.shareInputRow}>
                      <Text style={styles.shareCurrency}>₱</Text>
                      <TextInput
                        style={styles.shareInput}
                        value={draft[currentUserId] ?? ''}
                        onChangeText={(text) => {
                          setDraft((prev) => ({ ...prev, [currentUserId]: text }));
                          setError(null);
                        }}
                        placeholder="0"
                        keyboardType="decimal-pad"
                        placeholderTextColor={HomeColors.muted}
                        accessibilityLabel="Your share amount"
                        onFocus={() => handleFocus(currentUserId)}
                      />
                    </View>

                    <Text style={styles.shareHint}>
                      {myAllocation?.status === 'accepted'
                        ? 'Your share is accepted. Changing it keeps it accepted. Enter 0 to remove it.'
                        : 'Your share is accepted automatically. Enter 0 to have no share.'}
                    </Text>
                  </View>

                  {otherSplitRows.length > 0 ? (
                    <View style={styles.readOnlyBox}>
                      <Text style={styles.readOnlyTitle}>Current split</Text>
                      {otherSplitRows.map((row) => (
                        <View key={row.member.user_id} style={styles.readOnlyRow}>
                          <View style={styles.personInfo}>
                            <Text style={styles.readOnlyName}>{labelFor(row.member)}</Text>
                            <Text style={styles.personRole}>
                              {row.member.role} · {STATUS_TEXT[row.allocation!.status]}
                            </Text>
                          </View>
                          <Text style={styles.readOnlyAmount}>
                            {formatCurrency(row.allocation!.amount)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : (
                <>
              {eligibleMembers.length === 0 ? (
                <Text style={styles.empty}>No one is eligible to share this expense yet.</Text>
              ) : null}

              {eligibleMembers.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const existing = allocationByUser.get(member.user_id);
                const status = existing?.status ?? null;
                const editable = canEditRow(member, existing);
                // Someone else's accepted amount is locked to that person.
                const locked = !editable && status === 'accepted';

                return (
                  <SplitMemberRow
                    key={member.user_id}
                    editable={editable}
                    isSelf={isSelf}
                    member={member}
                    onChangeText={(text) => {
                      setDraft((prev) => ({ ...prev, [member.user_id]: text }));
                      setError(null);
                    }}
                    onFocus={() => handleFocus(member.user_id)}
                    staticText={existing ? formatCurrency(existing.amount) : undefined}
                    statusColor={status ? STATUS_COLOR[status] : undefined}
                    statusText={
                      status ? `${STATUS_TEXT[status]}${locked ? ' · Locked' : ''}` : undefined
                    }
                    value={draft[member.user_id] ?? ''}
                  />
                );
              })}
                </>
              )}
              </ScrollView>
            </View>
          ) : null}

          {/*
            While the keyboard is open the draft totals collapse to nothing and
            only a compact action bar remains. The summary card at the top still
            shows the real accepted / pending / unassigned state, so nothing is
            hidden, and the focused amount field gets the vertical space it
            needs instead of competing with three lines of figures and a large
            button.
          */}
          <View style={[styles.footer, keyboardOpen && styles.footerCompact]}>
            {loaded && (overBudget || error) ? (
              <View style={styles.errorBlock}>
                <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
                <Text accessibilityLiveRegion="polite" style={styles.errorBody}>
                  {overBudget ? 'Split total is greater than the refill amount.' : error}
                </Text>
              </View>
            ) : null}
            {keyboardOpen ? null : mode === 'owner' ? (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>This split</Text>
                  {hasUnsavedEdits ? <Text style={styles.unsavedTag}>Unsaved</Text> : null}
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Allocated</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(fromCents(draftCents))}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Unassigned</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: overBudget ? palette.danger : HomeColors.navy },
                    ]}>
                    {formatCurrency(draftUnassigned)}
                  </Text>
                </View>

                <View style={styles.actionRow}>
                  <PrimaryButton
                    label="Cancel"
                    onPress={handleCancel}
                    disabled={saving}
                    style={styles.cancelBtn}
                    variant="secondary"
                  />
                  <PrimaryButton
                    label={saving ? 'Saving…' : 'Save split'}
                    onPress={handleSave}
                    disabled={saving || loading || !loaded || eligibleMembers.length === 0 || overBudget}
                    style={styles.saveBtn}
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Your share</Text>
                  {myDraftCents !== toCents(myAllocation?.amount ?? 0) ? (
                    <Text style={styles.unsavedTag}>Unsaved</Text>
                  ) : null}
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Left unassigned</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: overBudget ? palette.danger : HomeColors.navy },
                    ]}>
                    {formatCurrency(
                      fromCents(Math.max(refillCents - draftCents, 0)),
                    )}
                  </Text>
                </View>

                <View style={styles.actionRow}>
                  <PrimaryButton
                    label="Cancel"
                    onPress={handleCancel}
                    disabled={saving}
                    style={styles.cancelBtn}
                    variant="secondary"
                  />
                  <PrimaryButton
                    label={saving ? 'Saving…' : 'Save my share'}
                    onPress={handleSave}
                    disabled={saving || loading || !loaded || !myMember || overBudget}
                    style={styles.saveBtn}
                  />
                </View>
              </>
            )}
          </View>
        </View>
      </View>
      <SplitResultPopup result={result} onDismiss={() => {
        const success = result?.type === 'success';
        submitLock.current = false;
        setResult(null);
        if (success) { onClose(); void onSaved(savedMessage.current); }
      }} />
    </View>
  );
}


const styles = StyleSheet.create({
  /**
   * Sheet shape, header, tinted total card, summary rows, member rows, amount
   * fields, footer and the Cancel/primary pair all come from splitSheetStyles,
   * which the pre-save draft sheet composes from too. Spreading it in here is
   * what keeps the two split screens from drifting apart again.
   *
   * Spread FIRST, so the genuinely history-specific styles below override it:
   * its loading / load-error states and the self-mode share card.
   */
  ...splitSheetStyles,

  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  /** The "Unsaved" marker beside the draft figures. */
  unsavedTag: { color: palette.warning, fontSize: 11, fontWeight: '700' },

  body: { flexShrink: 1 },
  /** Measured viewport wrapper; must be able to shrink with the keyboard. */
  viewport: { flexShrink: 1 },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    // Guarantees the last row can always scroll clear of the footer.
    paddingBottom: spacing.md,
  },

  summaryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    color: HomeColors.muted,
    fontSize: 12,
  },
  errorBlock: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  errorBody: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryBtn: { alignSelf: 'center' },
  shareCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: HomeColors.primarySoft,
    marginBottom: spacing.md,
  },
  shareInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  shareCurrency: {
    color: HomeColors.muted,
    fontSize: 20,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  shareInput: {
    flex: 1,
    height: 52,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    paddingHorizontal: spacing.md,
    color: HomeColors.navy,
    fontSize: 20,
    fontWeight: '800',
  },
  shareHint: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  /** Heading + lead-in for the self-mode share card. */
  helperTitle: { color: HomeColors.navy, fontSize: 13, fontWeight: '800' },
  helperBody: { color: HomeColors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  proposedBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(180, 83, 9, 0.08)',
  },
  proposedText: {
    flex: 1,
    color: palette.warning,
    fontSize: 11,
    lineHeight: 16,
  },
  readOnlyBox: {
    marginBottom: spacing.sm,
  },
  readOnlyTitle: {
    color: HomeColors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  readOnlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  readOnlyName: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '600',
  },
  readOnlyAmount: { color: HomeColors.navy, fontSize: 14, fontWeight: '700' },
});

