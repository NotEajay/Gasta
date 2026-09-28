import { StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { HomeColors } from '@/constants/home';
import type { SplitAllocationInput } from '@/lib/services/refillAllocations';
import type { VehicleMember } from '@/types';

/**
 * The shared visual language of the split feature.
 *
 * There are two split screens that look the same on purpose:
 *
 *   - RefillSplitSheet        the history split, against a SAVED refill
 *   - RefillSplitDraftSheet   the pre-save split, before anything is written
 *
 * They differ entirely in persistence and must never share that, but a user
 * stepping from one to the other should not feel they left the feature. So the
 * presentational layer lives here and both sheets compose from it. Keeping the
 * tokens in one StyleSheet is what stops the two screens from drifting apart
 * again.
 *
 * Nothing in this file knows about refills, ids, allocations, the keyboard or
 * the network. It only knows how the screen should look.
 */

/** Up to two initials for a member avatar: "Danna Paula" -> "DP". */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const splitSheetStyles = StyleSheet.create({
  /** Bottom sheet: white surface, 20pt top corners, allowed to shrink. */
  sheet: {
    maxHeight: '88%',
    flexShrink: 1,
    backgroundColor: GasTaColors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.md,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 18, 38, 0.45)',
  },
  /** Full-area wrapper that pins the sheet to the bottom. */
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  titles: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  title: { color: HomeColors.navy, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  subtitle: { color: HomeColors.muted, fontSize: 13, lineHeight: 18, marginTop: 1 },

  /** The tinted total / summary card at the top of both sheets. */
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
  totalHint: { color: HomeColors.muted, fontSize: 11, lineHeight: 16, marginTop: spacing.xs },
  empty: {
    color: HomeColors.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  /**
   * One person: avatar, name, quiet role, and the amount field.
   *
   * Rows are separated by a hairline rather than nested in cards, which keeps a
   * long member list compact and lets the whole sheet scan as one column. The
   * caller's own row gets a faint tint so it is findable without a badge.
   */
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  personRowSelf: { backgroundColor: HomeColors.primarySoft, borderRadius: radii.sm },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.primaryBorder,
  },
  avatarText: {
    color: HomeColors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  personInfo: { flex: 1, minWidth: 0 },
  personName: { color: HomeColors.navy, fontSize: 14, fontWeight: '700' },
  personMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  personRole: { color: HomeColors.muted, fontSize: 12 },
  metaDot: { color: HomeColors.muted, fontSize: 12 },
  personStatus: { fontSize: 12, fontWeight: '700' },
  /** "You" -- present but deliberately quiet. */
  personSelf: { color: HomeColors.muted, fontSize: 12, fontWeight: '600' },

  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  currencyPrefix: { color: HomeColors.muted, fontSize: 13, fontWeight: '700', marginRight: 2 },
  amountInput: {
    width: 84,
    height: 44,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    paddingHorizontal: spacing.sm,
    color: HomeColors.navy,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  amountStatic: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 92,
    textAlign: 'right',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  /** Keyboard-up footer: just the action, no figures. */
  footerCompact: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelBtn: { flex: 1, marginTop: spacing.sm },
  /** The primary action takes the larger share so its longer label fits. */
  saveBtn: { flex: 1.5, marginTop: spacing.sm },

  /** Inline error, matching the history sheet's quiet danger treatment. */
  errorBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  errorBody: { flex: 1, color: HomeColors.muted, fontSize: 12, lineHeight: 18 },
});

const s = splitSheetStyles;

/**
 * The amount field, identical on both split screens: currency symbol, fixed
 * width so a long figure never resizes the column, decimal keypad, right
 * aligned. `editable` false renders a static figure for a locked row.
 */
export function SplitAmountInput({
  value,
  onChangeText,
  onFocus,
  accessibilityLabel,
  editable = true,
  staticText,
}: {
  value: string;
  onChangeText?: (text: string) => void;
  onFocus?: () => void;
  accessibilityLabel?: string;
  editable?: boolean;
  staticText?: string;
}) {
  if (!editable) {
    return (
      <View style={s.amountWrap}>
        <Text style={s.amountStatic}>{staticText ?? '—'}</Text>
      </View>
    );
  }
  return (
    <View style={s.amountWrap}>
      <Text style={s.currencyPrefix}>₱</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        keyboardType="decimal-pad"
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder="0"
        placeholderTextColor={HomeColors.muted}
        style={s.amountInput}
        value={value}
      />
    </View>
  );
}

/**
 * One member line. Purely presentational: the caller supplies the value, the
 * change handler, and any status. The pre-save sheet simply passes no status,
 * which is why it never has to invent Accepted / Pending for money that has not
 * been written yet.
 */
export function SplitMemberRow({
  member,
  isSelf,
  statusText,
  statusColor,
  value,
  onChangeText,
  onFocus,
  editable = true,
  staticText,
}: {
  member: VehicleMember;
  isSelf: boolean;
  statusText?: string;
  statusColor?: string;
  value: string;
  onChangeText?: (text: string) => void;
  onFocus?: () => void;
  editable?: boolean;
  staticText?: string;
}) {
  const name = member.full_name?.trim() || 'Team member';
  return (
    <View style={[s.personRow, isSelf && s.personRowSelf]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initialsFor(member.full_name)}</Text>
      </View>

      <View style={s.personInfo}>
        <Text numberOfLines={1} style={s.personName}>
          {name}
        </Text>
        <View style={s.personMetaRow}>
          <Text style={s.personRole}>{member.role}</Text>
          {isSelf ? (
            <>
              <Text style={s.metaDot}>·</Text>
              <Text style={s.personSelf}>You</Text>
            </>
          ) : null}
          {statusText ? (
            <>
              <Text style={s.metaDot}>·</Text>
              <Text style={[s.personStatus, statusColor ? { color: statusColor } : null]}>
                {statusText}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      <SplitAmountInput
        accessibilityLabel={`Amount for ${name}`}
        editable={editable}
        onChangeText={onChangeText}
        onFocus={onFocus}
        staticText={staticText}
        value={value}
      />
    </View>
  );
}


/**
 * Money is compared in cents to avoid float drift on 2dp amounts.
 *
 * These two live here, not in a component, so the pre-save split draft and the
 * saved-refill split sheet cannot drift apart: both round through the exact
 * same function.
 */
export const toCents = (value: number) => Math.round((Number(value) || 0) * 100);
export const fromCents = (cents: number) => cents / 100;

/**
 * Eligible recipients: Owner, Member, Driver, Operator -- Owner first, then by
 * name.
 *
 * vehicle_members() already returns the owner plus ACTIVE shares only, so
 * revoked collaborators are absent by construction. Viewer is filtered out here
 * because a read-only role must never be charged.
 */
export function sortEligibleMembers(members: VehicleMember[]): VehicleMember[] {
  return members
    .filter((m) => m.role !== 'Viewer')
    .sort((a, b) => {
      if (a.role === 'Owner') return -1;
      if (b.role === 'Owner') return 1;
      return (a.full_name ?? '').localeCompare(b.full_name ?? '');
    });
}

/** Display name for a member row, with the same fallback the sheet uses. */
export function memberLabel(member: VehicleMember): string {
  return member.full_name?.trim() || 'Team member';
}

/** What the user typed in one amount box, as cents. Blank or junk reads as 0. */
export function parseDraftCents(raw: string | undefined): number {
  return toCents(Number.parseFloat(raw ?? '') || 0);
}

/**
 * Turns a { userId: typedText } draft into RPC lines.
 *
 * ONLY positive amounts are returned. A brand-new draft has nothing seeded, so
 * every person the user did not type for would otherwise send 0 -- and
 * save_refill_split() rejects any entry with amount <= 0, which fails the whole
 * call. Omitting a row is also how the server retires a pending proposal: its
 * trailing update cancels every pending row absent from p_allocations.
 */
export function buildSplitPayload(
  draft: Record<string, string>,
  members: VehicleMember[],
): SplitAllocationInput[] {
  return members
    .map((m) => ({ userId: m.user_id, amount: Number.parseFloat(draft[m.user_id] ?? '') || 0 }))
    .filter((line) => line.amount > 0);
}