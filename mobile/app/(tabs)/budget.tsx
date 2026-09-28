import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import { Text } from '@/components/Themed';
import AnimatedPressable from '@/components/auth/AnimatedPressable';
import HideWhenBlurred from '@/components/navigation/HideWhenBlurred';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
// NOTE: Budget deliberately uses the AUTH palette (cream + forest) for this
// design experiment, not the canonical navy `HomeColors`/`colors` values.
import { GasTaColors, GasTaRadius, GasTaSpacing, palette, typeScale } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatPeso } from '@/lib/format';
import {
  ActualSpendUnavailableError,
  deleteBudget,
  fetchMonthBudgetSummaries,
  getMonthlyBudgetOverview,
  upsertBudget,
  type BudgetStatus,
  type MonthBudgetSummary,
  type MonthlyBudgetOverview,
} from '@/lib/services/budgets';
import { fetchMyPendingAllocations } from '@/lib/services/refillAllocations';
import { isSupabaseConfigured } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Three-letter month cells for the picker grid. */
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Documented default for `fuel_budgets.alert_threshold_percent`
 * (`smallint not null default 80 check (between 1 and 100)`). Mirrors the
 * service fallback in lib/services/budgets.ts so the form and the row agree.
 */
const DEFAULT_THRESHOLD_PERCENT = 80;

/**
 * Budget's data-visualization accent.
 *
 * Deliberately NOT forest. The colour system this screen is testing is:
 *   forest = GasTa brand, primary actions, authoritative amounts
 *   teal   = normal budget consumption / progress
 *   amber  = at or above the alert threshold
 *   red    = over budget, destructive
 *
 * Chosen over the suggested #2A7F7A because that value reaches only 4.21:1
 * against the cream canvas, which is below the 4.5:1 AA threshold for body
 * text. #1F6B67 is the same hue family a shade deeper and measures 6.26:1 on
 * white and 5.54:1 on cream, so the percentage, the "On track" label and the
 * remaining amount are all legible on either surface.
 */
const ACCENT_TEAL = '#1F6B67';

/** Faint teal wash for the unfilled part of the progress track. */
const ACCENT_TEAL_SOFT = 'rgba(31, 107, 103, 0.14)';

// Restrained green, not a large colored bubble behind each icon.
const ICON_TINT_BG = 'rgba(1, 68, 33, 0.06)';
const ICON_TINT_BORDER = 'rgba(1, 68, 33, 0.16)';

function shiftMonth(year: number, month: number, delta: number) {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

// Labels and thresholds are unchanged. Only the colour tokens move onto the
// cream/forest/teal set: `ok` is now the teal data accent rather than forest,
// because teal is this screen's "normal consumption" signal, while forest
// stays reserved for brand and actions. warning/danger were already the
// existing status tokens and are untouched.
const STATUS_META: Record<BudgetStatus, { label: string; color: string }> = {
  unset: { label: 'No budget set', color: GasTaColors.textSoft },
  ok: { label: 'On track', color: ACCENT_TEAL },
  warning: { label: 'Near limit', color: palette.warning },
  exceeded: { label: 'Over budget', color: palette.danger },
};

export default function BudgetScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [overview, setOverview] = useState<MonthlyBudgetOverview | null>(null);
  const [months, setMonths] = useState<MonthBudgetSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState('5000');
  const [threshold, setThreshold] = useState(String(DEFAULT_THRESHOLD_PERCENT));
  /**
   * Inline feedback for the budget editor. Validation and save-success used to
   * interrupt the screen with a modal `Alert`; they are shown in the layout
   * instead. The destructive "remove budget" confirmation stays an `Alert`,
   * because that one is a confirmation, not feedback.
   */
  const [formNotice, setFormNotice] = useState<{
    variant: 'error' | 'success';
    message: string;
  } | null>(null);
  /** Field-scoped validation, shown directly under the offending input. */
  const [limitError, setLimitError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  // Edited inside the picker first; only committed on selection, so dismissing
  // the modal leaves the real budget month untouched.
  const [pickerYear, setPickerYear] = useState(year);
  const [pickerMonth, setPickerMonth] = useState(month);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user || !isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      try {
        const [next, list, pending] = await Promise.all([
          getMonthlyBudgetOverview(user.id, year, month),
          // Non-fatal: the other-months list is a convenience, not the main view.
          fetchMonthBudgetSummaries(user.id, year, month).catch(() => []),
          fetchMyPendingAllocations().catch(() => []),
        ]);

        setOverview(next);
        setMonths(list);
        setPendingCount(pending.length);
        setPendingTotal(pending.reduce((sum, p) => sum + Number(p.amount), 0));
        setLimit(String(next.budget?.limit_amount ?? ''));
        setThreshold(String(next.budget?.alert_threshold_percent ?? 80));
        setError(null);
      } catch (e) {
        // A missing Phase 2 RPC must neither blank the page nor be reported as
        // a real zero, so this is surfaced rather than swallowed.
        setError(
          e instanceof ActualSpendUnavailableError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Unable to load your budget.'
        );
        setOverview(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, year, month]
  );

  // Reloads every time the tab is focused, so accepting or rejecting an
  // allocation on the Vehicles screen shows up here immediately.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleSave = async () => {
    if (!user) return;
    const limitNum = Number.parseFloat(limit);
    const thresholdNum = Number.parseInt(threshold, 10);
    // Same validation, same conditions as before — only the presentation moved
    // inline, and each message now sits under the field it is about.
    const nextLimitError =
      !Number.isFinite(limitNum) || limitNum <= 0
        ? 'Enter a monthly limit greater than zero.'
        : null;
    const nextThresholdError =
      !Number.isFinite(thresholdNum) || thresholdNum < 1 || thresholdNum > 100
        ? 'Enter a percentage between 1 and 100.'
        : null;
    setLimitError(nextLimitError);
    setThresholdError(nextThresholdError);
    if (nextLimitError || nextThresholdError) {
      setFormNotice(null);
      return;
    }
    setSaving(true);
    setFormNotice(null);
    try {
      await upsertBudget({
        userId: user.id,
        year,
        month,
        limitAmount: limitNum,
        alertThresholdPercent: thresholdNum,
      });
      await load('refresh');
      setFormNotice({
        variant: 'success',
        message: `Fuel budget for ${MONTHS[month - 1]} ${year} updated.`,
      });
    } catch (e) {
      setFormNotice({
        variant: 'error',
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  /** Opens the picker seeded with whatever is on screen right now. */
  const openPicker = () => {
    setPickerYear(year);
    setPickerMonth(month);
    setFormNotice(null);
    setPickerOpen(true);
  };

  /**
   * Commits the picked month to the same `setYear`/`setMonth` pair the arrows
   * use, so the existing `useFocusEffect`/`load` path reloads exactly as before.
   */
  const commitPickedMonth = () => {
    setYear(pickerYear);
    setMonth(pickerMonth);
    setPickerOpen(false);
  };

  const handleDelete = () => {
    const target = overview?.budget;
    if (!target) return;
    // Destructive confirmation stays a modal Alert, and the failure path keeps
    // its Alert as well — neither is "feedback about a field".
    Alert.alert('Remove budget', `Remove the ${MONTHS[month - 1]} ${year} budget?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBudget(target.id);
            await load('refresh');
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  };

  const spent = overview?.actualRefillSpend ?? 0;
  const limitAmount = overview?.limitAmount ?? 0;
  const hasBudget = Boolean(overview?.budget);
  const statusMeta = STATUS_META[overview?.status ?? 'unset'];
  const percent = overview ? Math.round(overview.progress * 100) : 0;
  // Never rendered as a negative "remaining": the label switches to "Over budget".
  const isOver = (overview?.overBy ?? 0) > 0;
  const headroom = isOver ? (overview?.overBy ?? 0) : (overview?.remaining ?? 0);


  if (!authLoading && !user) {
    return (
      <AuthPrompt
        message="Sign in to set and track your personal fuel budget."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  return (
    <HideWhenBlurred>
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={tabBarScrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={GasTaColors.forest}
          />
        }>
        {!isSupabaseConfigured ? <SupabaseSetupBanner /> : null}

        {/* ------------------------------------------------ header
            Left-aligned on purpose: this is a data screen, not a Profile-style
            portrait plate. The old subtitle repeated the month/year verbatim,
            which the month selector below already shows, so it is gone. */}
        <Text style={styles.headerTitle}>Budget</Text>

        {/* ------------------------------------------------ month selector
            Same prev/next handlers and same `shiftMonth` maths — only the
            chrome changed: a compact pill instead of a loose row. */}
        <View style={styles.monthNav}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={8}
            pressScale={0.9}
            style={styles.monthBtn}
            onPress={() => {
              setFormNotice(null);
              const next = shiftMonth(year, month, -1);
              setYear(next.year);
              setMonth(next.month);
            }}>
            <Ionicons name="chevron-back" size={18} color={GasTaColors.forest} />
          </AnimatedPressable>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`Select month. Currently ${MONTHS[month - 1]} ${year}`}
            accessibilityHint="Opens a month and year picker"
            pressScale={0.97}
            style={styles.monthTrigger}
            onPress={openPicker}>
            <Text style={styles.monthLabel}>
              {MONTHS[month - 1]} {year}
            </Text>
            <Ionicons name="chevron-down" size={14} color={GasTaColors.forest} />
          </AnimatedPressable>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            pressScale={0.9}
            style={styles.monthBtn}
            onPress={() => {
              setFormNotice(null);
              const next = shiftMonth(year, month, 1);
              setYear(next.year);
              setMonth(next.month);
            }}>
            <Ionicons name="chevron-forward" size={18} color={GasTaColors.forest} />
          </AnimatedPressable>
        </View>

        {loading ? (
          <LoadingState />
        ) : (
          <>
            {/* ============================ ONE strong summary surface
                The Budget equivalent of Profile's identity card, and the only
                elevated surface on the screen. It leads with the one number the
                user came for: actual accepted-refill spend for the month.

                The three values stay strictly separate and are never summed:
                  spent    -> actualRefillSpend (accepted allocations only)
                  limit    -> limitAmount
                  headroom -> remaining, or overBy when over

                When `error` is set the RPC is unavailable, so the amount shows an
                em dash rather than a fabricated zero. */}
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>Spent this month</Text>
              <Text style={styles.summaryAmount}>
                {error ? '—' : formatPeso(spent)}
              </Text>
              <Text style={styles.summaryHint}>
                Accepted portions of vehicle refills assigned to you. Only amounts you accepted
                count here.
              </Text>

              {error ? (
                <>
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                  <PrimaryButton
                    label="Retry"
                    variant="secondary"
                    size="sm"
                    onPress={() => load('refresh')}
                    style={styles.retryBtn}
                  />
                </>
              ) : (
                <>
                  <View style={styles.summaryDivider} />

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Budget</Text>
                    <Text style={[styles.metaValue, !hasBudget && styles.metaValueMuted]}>
                      {hasBudget ? formatPeso(limitAmount) : 'Not set'}
                    </Text>
                  </View>

                  {hasBudget ? (
                    <>
                      {/* Budget consumption, and the only place status colour is
                          applied. The bar caps at 100% (`progress` is clamped in
                          the service) but the percentage keeps counting, so an
                          over-budget month reads "108%" next to a full bar. */}
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Budget used</Text>
                        <Text style={[styles.usedPercent, { color: statusMeta.color }]}>
                          {percent}%
                        </Text>
                      </View>
                      <View style={styles.track}>
                        <View
                          style={[
                            styles.fill,
                            { width: `${percent}%`, backgroundColor: statusMeta.color },
                          ]}
                        />
                      </View>
                      <Text style={styles.progressMeta}>
                        Alert threshold {overview?.thresholdPercent}%
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.noBudgetHint}>
                      No monthly budget set for {MONTHS[month - 1]}. The actual spending above is
                      still counted.
                    </Text>
                  )}

                  <View style={styles.summaryDivider} />

                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>
                      {isOver ? 'Over budget' : 'Remaining'}
                    </Text>
                    <Text
                      style={[
                        styles.metaValue,
                        isOver
                          ? styles.metaValueOver
                          : hasBudget
                            ? styles.metaValuePositive
                            : styles.metaValueMuted,
                      ]}>
                      {formatPeso(headroom)}
                    </Text>
                  </View>

                  {/* Status line, coloured by the same status token as the bar. */}
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
                    <Text style={[styles.statusText, { color: statusMeta.color }]}>
                      {statusMeta.label}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* ============================ secondary, flat, grouped
                Pending responsibility and the trip-fuel estimate are information,
                not budget. They share one flat surface with hairline dividers so
                they read as supporting rows, never as extra hero cards.

                Pending is still excluded from `spent` and from the progress bar —
                exactly as before. It stays tappable to Vehicles. */}
            <View style={styles.infoBlock}>
              {pendingCount > 0 ? (
                <AnimatedPressable
                  accessibilityRole="button"
                  pressScale={0.99}
                  style={styles.infoRow}
                  onPress={() => router.push('/vehicles')}>
                  <View style={styles.infoIcon}>
                    <Ionicons name="hourglass-outline" size={16} color={GasTaColors.forest} />
                  </View>
                  <View style={styles.infoText}>
                    <Text style={styles.infoTitle}>Pending responsibility</Text>
                    <Text style={styles.infoHint}>
                      Awaiting your response · {pendingCount}{' '}
                      {pendingCount === 1 ? 'refill request' : 'refill requests'} not counted yet
                    </Text>
                  </View>
                  <Text style={styles.infoValue}>{formatPeso(pendingTotal)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={GasTaColors.textSoft} />
                </AnimatedPressable>
              ) : null}

              {pendingCount > 0 ? <View style={styles.infoDivider} /> : null}

              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="calculator-outline" size={16} color={GasTaColors.forest} />
                </View>
                <View style={styles.infoText}>
                  <Text style={styles.infoTitle}>Estimated trip fuel</Text>
                  <Text style={styles.infoHint}>
                    Estimate only · not added to your actual budget spending
                  </Text>
                </View>
                <Text style={styles.infoValueMuted}>
                  {formatPeso(overview?.estimatedTripFuelCost ?? 0)}
                </Text>
              </View>
            </View>

            {/* --------------------------------------- budget editor
                Existing inline form, same inputs, same `handleSave`/`handleDelete`.
                `LabeledInput` and `PrimaryButton` are shared with Vehicles, Trip
                and Prices, so they are used as-is rather than restyled here.
                `PrimaryButton`'s primary fill is `palette.primary`, which is
                already forest. */}
            <Text style={styles.sectionTitle}>
              {hasBudget ? 'Edit this budget' : 'Set a monthly fuel budget'}
            </Text>
            <Text style={styles.blockHint}>
              {hasBudget
                ? 'Change the limit or the alert point for this month.'
                : 'Track how much of your own fuel spending this month should stay under.'}
            </Text>

            {formNotice ? (
              <View
                accessibilityRole="alert"
                style={[
                  styles.formNotice,
                  formNotice.variant === 'error' ? styles.formNoticeError : styles.formNoticeOk,
                ]}>
                <Ionicons
                  name={
                    formNotice.variant === 'error'
                      ? 'close-circle-outline'
                      : 'checkmark-circle-outline'
                  }
                  size={16}
                  color={formNotice.variant === 'error' ? palette.danger : GasTaColors.forest}
                />
                <Text
                  style={[
                    styles.formNoticeText,
                    { color: formNotice.variant === 'error' ? palette.danger : GasTaColors.forest },
                  ]}>
                  {formNotice.message}
                </Text>
              </View>
            ) : null}

            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <LabeledInput
                  label="Monthly limit (₱)"
                  value={limit}
                  onChangeText={(next) => {
                    setLimit(next);
                    if (limitError) setLimitError(null);
                  }}
                  placeholder="5000"
                  keyboardType="decimal-pad"
                />
                {limitError ? (
                  <Text accessibilityRole="alert" style={styles.fieldError}>
                    {limitError}
                  </Text>
                ) : null}
              </View>
              <View style={styles.formHalf}>
                <LabeledInput
                  label="Alert at (%)"
                  value={threshold}
                  onChangeText={(next) => {
                    setThreshold(next);
                    if (thresholdError) setThresholdError(null);
                  }}
                  placeholder={String(DEFAULT_THRESHOLD_PERCENT)}
                  keyboardType="number-pad"
                />
                {thresholdError ? (
                  <Text accessibilityRole="alert" style={styles.fieldError}>
                    {thresholdError}
                  </Text>
                ) : null}
              </View>
            </View>

            <Text style={styles.helperText}>
              Warn me when spending reaches this percentage. Default is {DEFAULT_THRESHOLD_PERCENT}%.
            </Text>

            <PrimaryButton
              label={saving ? 'Saving…' : 'Save budget'}
              onPress={handleSave}
              disabled={saving}
              style={styles.saveBtn}
            />
            {hasBudget ? (
              <View style={styles.dangerWrap}>
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove budget"
                  pressScale={0.96}
                  style={styles.removeBtn}
                  onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={15} color={palette.danger} />
                  <Text style={styles.removeText}>Remove budget</Text>
                </AnimatedPressable>
              </View>
            ) : null}

            {/* ----------------------------------- other months list
                Same list, same filtering, same tap-to-switch behaviour. */}
            {months.length > 1 ? (
              <>
                <Text style={styles.sectionTitle}>Your other months</Text>
                <View style={styles.monthList}>
                  {months
                    .filter((m) => !(m.year === year && m.month === month))
                    .map((m) => {
                      const meta = STATUS_META[m.status];
                      return (
                        <Pressable
                          key={`${m.year}-${m.month}`}
                          accessibilityRole="button"
                          onPress={() => {
                            setFormNotice(null);
                            setYear(m.year);
                            setMonth(m.month);
                          }}
                          style={styles.monthRow}>
                          <Text style={styles.monthRowTitle}>
                            {MONTHS[m.month - 1]} {m.year}
                          </Text>
                          <Text style={[styles.monthRowValue, { color: meta.color }]}>
                            {formatPeso(m.actualRefillSpend)} / {formatPeso(m.limitAmount)}
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              </>
            ) : null}
          </>
        )}
        {/* ------------------------------------------- month picker
            Plain React Native `Modal` — no new package. The arrows still handle
            adjacent months; this is for jumping straight to a month/year.
            `pickerYear`/`pickerMonth` are staged, so dismissing leaves the
            budget month untouched; choosing commits through the same
            `setYear`/`setMonth` the arrows use, which triggers the unchanged
            `load` path. */}
        <Modal
          animationType="fade"
          transparent
          visible={pickerOpen}
          onRequestClose={() => setPickerOpen(false)}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
            {/* Swallow taps so pressing inside the sheet does not dismiss it. */}
            <Pressable style={styles.pickerSheet} onPress={() => {}}>
              <Text style={styles.pickerTitle}>Select month</Text>

              <View style={styles.pickerYearRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous year"
                  hitSlop={8}
                  style={styles.pickerYearBtn}
                  onPress={() => setPickerYear((y) => y - 1)}>
                  <Ionicons name="chevron-back" size={18} color={GasTaColors.forest} />
                </Pressable>
                <Text style={styles.pickerYear}>{pickerYear}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next year"
                  hitSlop={8}
                  style={styles.pickerYearBtn}
                  onPress={() => setPickerYear((y) => y + 1)}>
                  <Ionicons name="chevron-forward" size={18} color={GasTaColors.forest} />
                </Pressable>
              </View>

              <View style={styles.pickerGrid}>
                {MONTHS_SHORT.map((label, index) => {
                  const value = index + 1;
                  const selected = value === pickerMonth && pickerYear === year;
                  return (
                    <Pressable
                      key={label}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${MONTHS[index]} ${pickerYear}`}
                      style={[styles.pickerCell, selected && styles.pickerCellSelected]}
                      onPress={() => {
                        setPickerMonth(value);
                        setPickerYear(pickerYear);
                        setFormNotice(null);
                        setPickerOpen(false);
                        setYear(pickerYear);
                        setMonth(value);
                      }}>
                      <Text style={[styles.pickerCellText, selected && styles.pickerCellTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                style={styles.pickerDone}
                onPress={commitPickedMonth}>
                <Text style={styles.pickerDoneText}>
                  Go to {MONTHS[pickerMonth - 1]} {pickerYear}
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

      </ScrollView>
    </View>
    </HideWhenBlurred>
  );
}


const styles = StyleSheet.create({
  // Transparent: the cream canvas comes from `TabCanvas` in the tab layout.
  flex: { flex: 1 },
  content: {
    paddingHorizontal: GasTaSpacing.lg,
    paddingTop: GasTaSpacing.lg,
    // `sceneStyle` already reserves room for the floating tab bar; this is the
    // breathing room between the last control and that reserved area.
    paddingBottom: GasTaSpacing.xxl,
  },

  // ---- header (left-aligned, unlike Profile) -------------------------------
  headerTitle: {
    ...typeScale.pageTitle,
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.md,
  },

  // ---- month selector: compact pill, not a card ---------------------------
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'flex-start',
    gap: GasTaSpacing.xs,
    padding: 4,
    marginBottom: GasTaSpacing.lg,
    borderRadius: GasTaRadius.pill,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  monthBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GasTaRadius.pill,
    backgroundColor: ICON_TINT_BG,
  },
  monthLabel: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  // The tappable half of the selector: label + caret, same visual weight.
  monthTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 4,
  },

  // ---- month picker -------------------------------------------------------
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 16, 8, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: GasTaSpacing.lg,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.lg,
    padding: GasTaSpacing.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  pickerTitle: {
    ...typeScale.sectionHeading,
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.md,
  },
  pickerYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: GasTaSpacing.md,
  },
  pickerYearBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GasTaRadius.pill,
    backgroundColor: ICON_TINT_BG,
  },
  pickerYear: {
    ...typeScale.sectionHeading,
    fontSize: 20,
    fontWeight: '800',
    color: GasTaColors.forestDark,
  },
  // 4 columns x 3 rows, built with flexWrap so it works on every width.
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  pickerCell: {
    width: '25%',
    paddingVertical: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.xs,
    alignItems: 'center',
    borderRadius: GasTaRadius.sm,
  },
  pickerCellSelected: {
    backgroundColor: GasTaColors.forest,
  },
  pickerCellText: {
    ...typeScale.bodySmall,
    fontWeight: '600',
    color: GasTaColors.textPrimary,
  },
  pickerCellTextSelected: {
    color: GasTaColors.textOnForest,
    fontWeight: '700',
  },
  pickerDone: {
    marginTop: GasTaSpacing.md,
    paddingVertical: GasTaSpacing.sm,
    alignItems: 'center',
    borderRadius: GasTaRadius.sm,
    backgroundColor: ICON_TINT_BG,
  },
  pickerDoneText: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.forest,
  },

  // ---- THE one strong surface ---------------------------------------------
  // Budget's single elevated element, matching Profile's identity card: opaque
  // white, one restrained forest-tinted shadow, no glass and no gradient.
  summary: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.lg,
    padding: GasTaSpacing.lg,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    marginBottom: GasTaSpacing.lg,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 2,
  },
  summaryLabel: {
    ...typeScale.label,
    color: GasTaColors.textSoft,
    textTransform: 'uppercase',
  },
  summaryAmount: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1,
    color: GasTaColors.forestDark,
    marginTop: GasTaSpacing.xs,
  },
  summaryHint: {
    ...typeScale.caption,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: GasTaSpacing.xs,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: GasTaColors.glassBorderSubtle,
    marginVertical: GasTaSpacing.md,
  },

  // Budget / Remaining rows. Values sit a step lighter than the labels, and the
  // over-budget value keeps the existing danger token.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 26,
  },
  metaLabel: {
    ...typeScale.body,
    fontWeight: '600',
    color: GasTaColors.textPrimary,
  },
  metaValue: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
  },
  metaValueMuted: { color: GasTaColors.textSoft, fontWeight: '600' },
  // A positive remaining balance wears the same teal as the progress bar, so
  // "how much is left" and "how much is used" read as one system. Deliberately
  // NOT applied when there is no budget, where the figure is a meaningless zero.
  metaValuePositive: { color: ACCENT_TEAL, fontWeight: '700' },
  metaValueOver: { color: palette.danger },
  // The one number coloured by budget-consumption status.
  usedPercent: {
    ...typeScale.body,
    fontWeight: '800',
  },
  noBudgetHint: {
    ...typeScale.caption,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: GasTaSpacing.sm,
  },

  // ---- progress ------------------------------------------------------------
  // Same `percent` and same status colour as before. The track is now a warm
  // neutral instead of a cool navy wash, so it sits on the cream canvas.
  track: {
    height: 8,
    borderRadius: GasTaRadius.pill,
    // A faint teal wash rather than a warm neutral, so the empty portion of the
    // bar still reads as part of the same consumption scale.
    backgroundColor: ACCENT_TEAL_SOFT,
    marginTop: GasTaSpacing.md,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: GasTaRadius.pill },
  progressMeta: {
    ...typeScale.caption,
    color: GasTaColors.textSoft,
    marginTop: GasTaSpacing.sm,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typeScale.bodySmall, fontWeight: '700' },


  // ---- secondary information: flat, grouped, no shadow ---------------------
  // Pending and the trip-fuel estimate are supporting rows, not extra cards.
  infoBlock: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    overflow: 'hidden',
    marginBottom: GasTaSpacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: GasTaSpacing.sm,
    minHeight: 52,
  },
  // Small restrained tinted square — not a large colored bubble.
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: GasTaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ICON_TINT_BG,
    borderWidth: 1,
    borderColor: ICON_TINT_BORDER,
  },
  infoText: { flex: 1, minWidth: 0 },
  infoTitle: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  infoHint: {
    ...typeScale.caption,
    fontSize: 12,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  infoValue: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  infoValueMuted: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.textSoft,
  },
  infoDivider: {
    height: 1,
    backgroundColor: GasTaColors.glassBorderSubtle,
    // Indented past the icon so the divider reads as separating rows, not
    // cutting the icon in half.
    marginLeft: 54,
  },

  // ---- editor --------------------------------------------------------------
  blockHint: {
    ...typeScale.caption,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  sectionTitle: {
    ...typeScale.sectionHeading,
    color: GasTaColors.forestDark,
    marginBottom: GasTaSpacing.xs,
  },
  formNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: GasTaSpacing.md,
    padding: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    borderWidth: 1,
  },
  formNoticeError: {
    backgroundColor: palette.dangerSoft,
    borderColor: 'rgba(220, 38, 38, 0.24)',
  },
  formNoticeOk: {
    backgroundColor: ICON_TINT_BG,
    borderColor: GasTaColors.forestBorder,
  },
  formNoticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  // Field-scoped validation, directly under its input.
  fieldError: {
    ...typeScale.caption,
    fontSize: 12,
    lineHeight: 16,
    color: palette.danger,
    marginTop: -6,
    marginBottom: GasTaSpacing.sm,
  },
  helperText: {
    ...typeScale.caption,
    lineHeight: 18,
    color: GasTaColors.textSoft,
    marginTop: -2,
  },

  formRow: { flexDirection: 'row', gap: GasTaSpacing.md, marginTop: GasTaSpacing.md },
  formHalf: { flex: 1 },
  saveBtn: { marginTop: GasTaSpacing.sm },
  // Deliberate compact destructive control: a quiet outlined pill, not a red
  // text link and not a full-width filled button.
  dangerWrap: {
    alignItems: 'center',
    marginTop: GasTaSpacing.md,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 148,
    paddingHorizontal: GasTaSpacing.lg,
    paddingVertical: 10,
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(220, 38, 38, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  removeText: { ...typeScale.bodySmall, color: palette.danger, fontWeight: '600' },

  // ---- other months -------------------------------------------------------
  monthList: {
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    overflow: 'hidden',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GasTaSpacing.md,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.glassBorderSubtle,
  },
  monthRowTitle: {
    ...typeScale.bodySmall,
    fontWeight: '600',
    color: GasTaColors.textPrimary,
  },
  monthRowValue: { ...typeScale.caption, fontWeight: '700' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: GasTaSpacing.md,
    padding: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    backgroundColor: palette.dangerSoft,
  },
  errorText: { flex: 1, color: palette.danger, fontSize: 12, lineHeight: 17 },
  retryBtn: { alignSelf: 'flex-start', marginTop: GasTaSpacing.sm },
});
