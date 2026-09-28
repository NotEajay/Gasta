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
  type SplitAllocationInput,
} from '@/lib/services/refillAllocations';
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
  onSaved: (message: string) => void;
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

/** Money is compared in cents to avoid float drift on 2dp amounts. */
const toCents = (value: number) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number) => cents / 100;

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
   * Eligible recipients: Owner, Member, Driver, Operator.
   *
   * vehicle_members() already returns the owner plus ACTIVE shares only, so
   * revoked collaborators are absent by construction. Viewer is returned by the
   * RPC and filtered out here, because a read-only role must never be charged.
   */
  const eligibleMembers = useMemo(
    () =>
      members
        .filter((m) => m.role !== 'Viewer')
        .sort((a, b) => {
          if (a.role === 'Owner') return -1;
          if (b.role === 'Owner') return 1;
          return (a.full_name ?? '').localeCompare(b.full_name ?? '');
        }),
    [members],
  );

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
      setError(e instanceof Error ? e.message : 'Unable to load the split.');
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

  const myDraftCents = toCents(Number.parseFloat(draft[currentUserId] ?? '') || 0);

  // Name only. The role is shown on the second line, so appending "· Owner"
  // here as well would read "Dad · Owner" over "Owner · Accepted".
  const labelFor = useCallback((member: VehicleMember) => {
    return member.full_name?.trim() || 'Team member';
  }, []);

  // What the user is typing right now, in cents.
  const draftCents = useMemo(
    () =>
      Object.values(draft).reduce(
        (sum, raw) => sum + toCents(Number.parseFloat(raw) || 0),
        0,
      ),
    [draft],
  );

  const refillCents = toCents(refill.total_amount);
  const draftUnassigned = fromCents(Math.max(refillCents - draftCents, 0));
  const overBudget = draftCents > refillCents;

  // True when the form differs from what is actually saved.
  const hasUnsavedEdits = draftCents !== toCents(summary.reserved);

  const handleSave = async () => {
    // Only send rows this user is permitted to write. Zeros are meaningful: they
    // mean "retire this proposal" and the server cancels the row, which frees the
    // money back to unassigned and clears it from the recipient's inbox.
    const editable = eligibleMembers.filter((m) => canEditRow(m, allocationByUser.get(m.user_id)));

    const payload: SplitAllocationInput[] = editable.map((m) => ({
      userId: m.user_id,
      amount: Number.parseFloat(draft[m.user_id] ?? '') || 0,
    }));

    const hasPositive = payload.some((line) => line.amount > 0);
    // All-zero is only meaningful if it actually retires an existing row.
    const hasExisting =
      editable.some((m) => allocationByUser.get(m.user_id)?.status === 'accepted') ||
      editable.some((m) => allocationByUser.get(m.user_id)?.status === 'pending');

    if (!hasPositive && !hasExisting) {
      setError('Enter an amount for yourself, or leave it at 0 to have no share.');
      return;
    }
    if (overBudget) {
      setError('The split is larger than this refill total.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await saveRefillSplit(refill.id, payload);
      const needsApproval = saved.some(
        (row) => row.status === 'pending' && row.user_id !== currentUserId,
      );
      onSaved(needsApproval ? 'Split saved. Waiting for approval.' : 'Split saved.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the split.');
    } finally {
      setSaving(false);
    }
  };

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
        onPress={onClose}
        style={styles.backdrop}
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        {/* The keyboard height is applied here as real padding, so the sheet is
            pushed up by exactly the right amount and the ScrollView shrinks
            into whatever space is left. */}
        <View style={[styles.sheet, { paddingBottom: keyboardHeight }]}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetTitles}>
              <Text style={styles.sheetTitle}>
                {mode === 'owner' ? 'Split expense' : 'Set my share'}
              </Text>
              <Text numberOfLines={1} style={styles.sheetSubtitle}>
                {vehicleLabel} · {formatDate(refill.occurred_at)}
              </Text>
            </View>
            <PrimaryButton
              label="Close"
              variant="secondary"
              size="sm"
              onPress={onClose}
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
            ) : error && allocations.length === 0 ? (
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


          {!loading && (!error || allocations.length > 0) ? (
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
                        onChangeText={(text) =>
                          setDraft((prev) => ({ ...prev, [currentUserId]: text }))
                        }
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
                  <View
                    key={member.user_id}
                    style={[styles.personRow, isSelf && styles.personRowSelf]}>
                    <View style={styles.personInfo}>
                      <Text style={styles.personName}>
                        {labelFor(member)}
                        {isSelf ? ' · You' : ''}
                      </Text>
                      <View style={styles.personMetaRow}>
                        <Text style={styles.personRole}>{member.role}</Text>
                        {status ? (
                          <>
                            <Text style={styles.metaDot}>·</Text>
                            <Text style={[styles.personStatus, { color: STATUS_COLOR[status] }]}>
                              {STATUS_TEXT[status]}
                              {locked ? ' · Locked' : ''}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    </View>

                    {editable ? (
                      <View style={styles.amountWrap}>
                        <Text style={styles.currencyPrefix}>₱</Text>
                        <TextInput
                          style={styles.amountInput}
                          value={draft[member.user_id] ?? ''}
                          onChangeText={(text) =>
                            setDraft((prev) => ({ ...prev, [member.user_id]: text }))
                          }
                          placeholder="0"
                          keyboardType="decimal-pad"
                          placeholderTextColor={HomeColors.muted}
                          accessibilityLabel={`Amount for ${labelFor(member)}`}
                          onFocus={() => handleFocus(member.user_id)}
                        />
                      </View>
                    ) : (
                      <View style={styles.amountWrap}>
                        <Text style={styles.amountStatic}>
                          {existing ? formatCurrency(existing.amount) : '—'}
                        </Text>
                      </View>
                    )}
                  </View>
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

                <PrimaryButton
                  label={saving ? 'Saving…' : 'Save split'}
                  onPress={handleSave}
                  disabled={saving || loading || eligibleMembers.length === 0 || overBudget}
                  style={styles.saveBtn}
                />
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
                      Math.max(refillCents - myDraftCents, 0),
                    )}
                  </Text>
                </View>

                <PrimaryButton
                  label={saving ? 'Saving…' : 'Save my share'}
                  onPress={handleSave}
                  disabled={saving || loading || !myMember || myDraftCents > refillCents}
                  style={styles.saveBtn}
                />
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  backdrop: {
    // Written out rather than StyleSheet.absoluteFillObject, which is missing
    // from this project's react-native type surface.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 18, 38, 0.45)',
  },
  /** Full-area wrapper that pins the sheet to the bottom. */
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    // Must be allowed to shrink when the keyboard opens, otherwise the list
    // keeps its full height and the focused amount field stays behind the
    // keyboard and the footer.
    flexShrink: 1,
    backgroundColor: GasTaColors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
  totalCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: HomeColors.primarySoft,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  totalLabel: {
    color: HomeColors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  totalValue: {
    color: HomeColors.primary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HomeColors.border,
    marginVertical: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  summaryLabel: { color: HomeColors.muted, fontSize: 13 },
  summaryValue: { color: HomeColors.navy, fontSize: 14, fontWeight: '700' },
  unsavedTag: {
    color: palette.warning,
    fontSize: 11,
    fontWeight: '700',
  },
  totalHint: {
    color: HomeColors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
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
  readOnlyAmount: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '700',
  },
  body: { flexShrink: 1 },
  /** Measured viewport wrapper; must be able to shrink with the keyboard. */
  viewport: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    // Guarantees the last row can always scroll clear of the footer.
    paddingBottom: spacing.md,
  },
  helperBox: {
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  helperTitle: {
    color: HomeColors.navy,
    fontSize: 13,
    fontWeight: '800',
  },
  helperBody: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  empty: {
    color: HomeColors.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  /** A very light tint so the caller's own row is findable without a badge. */
  personRowSelf: {
    backgroundColor: HomeColors.primarySoft,
    borderRadius: radii.sm,
  },
  personInfo: { flex: 1, minWidth: 0 },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  currencyPrefix: {
    color: HomeColors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 2,
  },
  amountStatic: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 92,
    textAlign: 'right',
  },
  personName: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '700',
  },
  personMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  personRole: { color: HomeColors.muted, fontSize: 12 },
  metaDot: { color: HomeColors.muted, fontSize: 12 },
  personStatus: { fontSize: 12, fontWeight: '700' },
  amountInput: {
    width: 84,
    height: 44,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    paddingHorizontal: spacing.sm,
    color: HomeColors.navy,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  saveBtn: { marginTop: spacing.sm },
  /** Keyboard-up footer: just the action, no figures. */
  footerCompact: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
});

