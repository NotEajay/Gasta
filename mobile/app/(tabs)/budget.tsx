import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { buildBudgetInsights, activeVehicles, type BudgetInsight } from '@/lib/budgetInsights';
import {
  describeLiters,
  fetchMonthlyBudgetAnalytics,
  unassignedLoggedTravel,
  type BudgetAnalytics,
} from '@/lib/services/budgetAnalytics';
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

/**
 * Section accent rails.
 *
 * Each lower section gets a 3px vertical rail in its own hue so the page reads
 * as a set of labelled bands rather than a wall of identical white cards. The
 * hues are deliberately narrow and desaturated: they are structural, not
 * decorative, and none of them is loud enough to compete with the hero figure.
 *
 *   ACTUAL VS ESTIMATED -> deep forest, the money section
 *   TRAVEL              -> blue, the distance section
 *   BY VEHICLE          -> olive, the per-vehicle section
 *
 * Contrast note: all three are checked against the cream canvas (#F8F0E5) and
 * clear the 3:1 needed for a non-text UI element.
 */
const RAIL_FOREST = '#014421';
const RAIL_BLUE = '#1F6F8B';
const RAIL_OLIVE = '#6B7A2A';

/** Blue used for the Travel tile icons and the "logged trips" insight dot. */
const ACCENT_BLUE = '#1F6F8B';

/**
 * Insight dots. Three tones, mapping to the three kinds of statement:
 *   info    -> a neutral fact (budget timing)
 *   caution -> something worth a second look (one vehicle dominates)
 *   neutral -> a restatement of figures (comparisons, completeness)
 * The caution hue is amber rather than the red used for destructive UI, because
 * a high share is an observation and not an error.
 */
const DOT_INFO = '#1F6F8B';
const DOT_CAUTION = '#B45309';
const DOT_NEUTRAL = RAIL_OLIVE;

/**
 * Pale beige inset surface for explanatory notes. Warm rather than grey so it
 * sits with the cream canvas instead of reading as a disabled field.
 */
const NOTE_BEIGE = '#F3EADB';
const NOTE_BEIGE_BORDER = 'rgba(1, 68, 33, 0.08)';

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

  /**
   * Per-vehicle analytics, loaded in ONE bulk call rather than per vehicle.
   * `analyticsError` is tracked separately from the main `error` because the
   * headline spend figure is still authoritative and correct when the analytics
   * RPC is unavailable — the page must not blank out over a missing optional
   * section.
   */
  const [analytics, setAnalytics] = useState<BudgetAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

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

  /**
   * Budget editor lives in a modal, not inline on the page.
   *
   * `limit`/`threshold` remain the single source of truth for the form and are
   * seeded from the loaded budget, so the existing save handler is reused
   * unchanged — no duplicated logic and no second copy of the validation.
   * `editorOpen` is the only new piece of state the move required.
   */
  const [editorOpen, setEditorOpen] = useState(false);

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

      /*
       * Per-vehicle analytics load SEPARATELY and after the main figures.
       *
       * Deliberately not part of the Promise.all above: if this call fails the
       * authoritative spend figure is still correct, and failing the whole load
       * would replace a working page with an error screen. The analytics
       * section degrades on its own instead.
       *
       * One bulk call for every vehicle. There is no per-vehicle query.
       */
      try {
        setAnalytics(await fetchMonthlyBudgetAnalytics(year, month));
        setAnalyticsError(null);
      } catch (e) {
        setAnalytics(null);
        setAnalyticsError(
          e instanceof Error ? e.message : 'Per-vehicle analytics are unavailable.'
        );
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
      // The sheet closes only on a confirmed save. On failure it stays open with
      // the error visible, so the values the user typed are not lost.
      setEditorOpen(false);
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

  /**
   * Opens the editor seeded with the SELECTED month's saved values.
   *
   * `limit`/`threshold` are already seeded by `load`, so opening only needs to
   * re-seed defensively and clear stale validation from a previous visit.
   * Cancelling closes the sheet; the next open re-seeds from the budget, so
   * discarded edits cannot leak into a later save.
   */
  const openEditor = () => {
    setLimit(String(overview?.budget?.limit_amount ?? ''));
    setThreshold(String(overview?.budget?.alert_threshold_percent ?? DEFAULT_THRESHOLD_PERCENT));
    setLimitError(null);
    setThresholdError(null);
    setFormNotice(null);
    setEditorOpen(true);
  };

  /** Discards unsaved edits by closing; the seeded values are re-derived on open. */
  const closeEditor = () => {
    setEditorOpen(false);
    setFormNotice(null);
    setLimitError(null);
    setThresholdError(null);
  };

  const spent = overview?.actualRefillSpend ?? 0;
  const limitAmount = overview?.limitAmount ?? 0;
  const hasBudget = Boolean(overview?.budget);
  const statusMeta = STATUS_META[overview?.status ?? 'unset'];
  const percent = overview ? Math.round(overview.progress * 100) : 0;
  // Never rendered as a negative "remaining": the label switches to "Over budget".
  const isOver = (overview?.overBy ?? 0) > 0;
  const headroom = isOver ? (overview?.overBy ?? 0) : (overview?.remaining ?? 0);

  /**
   * Time context for the SELECTED month, as a label rather than a count.
   *
   * Deliberately not a bare number. A finished month must never read "0 days
   * remaining", and a future month must not read as though it were underway:
   *
   *   'current' -> "10 days remaining this month" (real count, 0 => last day)
   *   'past'    -> "Month completed"               (no countdown at all)
   *   'future'  -> "Month not started yet"         (no pacing claim)
   *
   * Returning a label rather than a number means the hero line and the pace
   * insight cannot accidentally imply progress for a month that has none.
   */
  const timeContext = useMemo<{
    kind: 'current' | 'past' | 'future';
    daysRemaining: number | null;
  }>(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const isCurrent = year === currentYear && month === currentMonth;
    if (isCurrent) {
      const daysInMonth = new Date(year, month, 0).getDate();
      return {
        kind: 'current',
        daysRemaining: Math.max(daysInMonth - now.getDate(), 0),
      };
    }
    // Ordering by (year, month) rather than by Date comparison keeps this
    // independent of any time-of-day edge on the 1st.
    const isPast = year < currentYear || (year === currentYear && month < currentMonth);
    return { kind: isPast ? 'past' : 'future', daysRemaining: null };
  }, [year, month]);

  /** Vehicles with any activity this month, for the By vehicle section. */
  const vehicleRows = useMemo<BudgetAnalytics | null>(() => {
    if (!analytics) return null;
    return { ...analytics, vehicles: activeVehicles(analytics.vehicles) };
  }, [analytics]);

  /**
   * Logged travel with no vehicle attached.
   *
   * The month totals include trips whose `vehicle_id` is null, but the
   * per-vehicle rows cannot, so the two legitimately differ. Rendering the
   * difference is what stops the page looking like it dropped trips.
   */
  const unassigned = useMemo(() => {
    if (!analytics) return null;
    const value = unassignedLoggedTravel(analytics);
    return value.tripCount > 0 ? value : null;
  }, [analytics]);

  /** Deterministic, traceable insights. Never freeform. */
  const insights = useMemo<BudgetInsight[]>(() => {
    if (!analytics) return [];
    return buildBudgetInsights({
      analytics,
      actualSpend: spent,
      // The estimate is informational and is never folded into actualSpend.
      estimatedTripCost: analytics.estimatedTripCost,
      budgetUsedPercent: hasBudget ? percent : null,
      // Pacing is only meaningful for a month that is actually underway. A past
      // or future month passes null here, which suppresses the pace insight
      // entirely rather than wording it awkwardly.
      daysRemaining: timeContext.kind === 'current' ? timeContext.daysRemaining : null,
    });
  }, [analytics, spent, hasBudget, percent, timeContext]);


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

        {/*
          HEADER — a dark forest block with rounded bottom corners that owns the
          title, the Edit budget action, and the month selector together.

          The BACKGROUND is bled to the left and right screen edges, and starts
          immediately below the safe area rather than after a page gutter. The
          CONTENT keeps the normal page padding, so the title and controls line
          up with the hero and every section below. The status-bar area itself
          stays cream and is never covered.

          The month arrows live inside the header and are centred, per the design
          direction. `shiftMonth` maths, the picker, and both arrow handlers are
          unchanged.
        */}
        <View style={styles.header}>
          {/*
            Decorative dotted route motif. pointerEvents="none" so it can never
            intercept a press, and hidden from accessibility so it is never
            announced as a label.
          */}
          <View
            style={styles.headerMotif}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <View style={[styles.headerDot, styles.headerDotA]} />
            <View style={[styles.headerDot, styles.headerDotB]} />
            <View style={[styles.headerDot, styles.headerDotC]} />
            <View style={styles.headerMotifArc} />
          </View>

          <View style={styles.headerTopRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Budget
            </Text>
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel="Edit this month's budget"
              accessibilityHint="Opens the budget editor"
              hitSlop={8}
              pressScale={0.96}
              style={styles.headerAction}
              onPress={openEditor}>
              <Ionicons name="create-outline" size={14} color={GasTaColors.textOnForest} />
              <Text style={styles.headerActionText}>
                {hasBudget ? 'Edit budget' : 'Set budget'}
              </Text>
            </AnimatedPressable>
          </View>

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
              <Ionicons name="chevron-back" size={18} color={GasTaColors.textOnForest} />
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
              <Ionicons name="chevron-down" size={14} color="rgba(248, 240, 229, 0.75)" />
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
              <Ionicons name="chevron-forward" size={18} color={GasTaColors.textOnForest} />
            </AnimatedPressable>
          </View>
        </View>


        {loading ? (
          <LoadingState />
        ) : (
          <>
            {/*
              HERO — the strongest surface on the screen.

              A negative top margin tucks its top edge under the forest header, so
              the page does not read as a flat stack of cards from the first
              element. It keeps the normal page gutter on both sides and is NOT
              bled to the screen edges the way the header background is.
            */}
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
                      <View style={styles.trackWrap}>
                        <View style={styles.track}>
                          <View
                            style={[
                              styles.fill,
                              { width: `${percent}%`, backgroundColor: statusMeta.color },
                            ]}
                          />
                        </View>
                        {/*
                          Threshold marker, as a notch sitting on the track rather
                          than as another sentence of text. It lives in `trackWrap`
                          (not inside `track`) because the track clips its fill with
                          `overflow: hidden`, which would also swallow the marker.
                          Clamped so a threshold above 100 cannot sit off the end.
                        */}
                        <View
                          pointerEvents="none"
                          accessibilityElementsHidden
                          style={[
                            styles.thresholdMark,
                            {
                              left: `${Math.min(overview?.thresholdPercent ?? 80, 100)}%`,
                            },
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

                  {/*
                    Time context for the selected month. A finished month reads
                    "Month completed" rather than "0 days remaining", and a
                    future month is explicitly marked as not started, so neither
                    can be mistaken for a month in progress.
                  */}
                  {timeContext.kind === 'current' ? (
                    <Text style={styles.daysRemaining}>
                      {timeContext.daysRemaining === 0
                        ? 'Last day of this month'
                        : `${timeContext.daysRemaining} ${
                            timeContext.daysRemaining === 1 ? 'day' : 'days'
                          } remaining this month`}
                    </Text>
                  ) : (
                    <Text style={styles.daysRemaining}>
                      {timeContext.kind === 'past' ? 'Month completed' : 'Month not started yet'}
                    </Text>
                  )}
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

            </View>

            {/* The budget editor no longer lives here. It moved into a modal
                opened from the header action, so this page reads as a dashboard
                rather than a form. `handleSave` / `handleDelete` / the form state
                are unchanged and reused by that modal verbatim. */}

            {/* ============================ ACTUAL vs ESTIMATED
                The two measurements are shown side by side because comparing them
                is useful, and kept on separate lines with explicit labels because
                they must never be read as one number. They are never summed, and
                the estimate is visually subordinate (muted) to the actual. */}
            <View style={styles.section}>
              <View style={styles.sectionRailRow}>
                <View style={[styles.sectionRail, { backgroundColor: RAIL_FOREST }]} />
                <Text style={styles.sectionLabel}>Actual vs estimated</Text>
              </View>
              <View style={styles.compareCard}>
                <View style={styles.compareRow}>
                  <View style={styles.compareText}>
                    <Text style={styles.compareLabel}>Actual refill responsibility</Text>
                    <Text style={styles.compareHint}>
                      Accepted shares of refills assigned to you
                    </Text>
                  </View>
                  <Text style={styles.compareValueActual}>{error ? '—' : formatPeso(spent)}</Text>
                </View>
                <View style={styles.compareDivider} />
                <View style={styles.compareRow}>
                  <View style={styles.compareText}>
                    <Text style={styles.compareLabel}>Logged-trip estimate</Text>
                    <Text style={styles.compareHint}>
                      Estimated from logged trips only · informational
                    </Text>
                  </View>
                  <Text style={styles.compareValueMuted}>
                    {formatPeso(analytics?.estimatedTripCost ?? 0)}
                  </Text>
                </View>
                {/*
                  Beige inset note. It is a View with a Text inside rather than a
                  styled Text, because the beige fill and border have to sit as a
                  block behind the copy.
                */}
                <View style={styles.compareFooter}>
                  <Text style={styles.compareFooterText}>
                    Trip estimates are informational and are not added to your actual spending.
                  </Text>
                </View>
              </View>
            </View>

            {/* ============================ TRAVEL THIS MONTH
                Every label says "logged" because trip_records rows are created
                only when someone explicitly taps Log to history. They are opt-in
                history, not automatic odometer or GPS records, and the wording
                must not imply otherwise.

                Deliberately TWO metrics, not three. The fuel estimate already
                appears in "Actual vs estimated" directly above; repeating the
                same peso figure a second time added height without adding
                information, so it was removed rather than restated. */}
            <View style={styles.section}>
              <View style={styles.sectionRailRow}>
                <View style={[styles.sectionRail, { backgroundColor: RAIL_BLUE }]} />
                <Text style={styles.sectionLabel}>Travel this month</Text>
              </View>
              {/*
                Two equal tiles rather than one tall card. The rail already
                establishes this is the travel section, so the blue icons are the
                only reinforcement needed and the figures can sit side by side
                at a glance instead of stacked in a narrow column.
              */}
              <View style={styles.travelTileRow}>
                <View style={styles.travelTile}>
                  <Ionicons name="map-outline" size={15} color={ACCENT_BLUE} />
                  <Text style={styles.travelTileLabel}>Logged trips</Text>
                  <Text style={styles.travelTileValue}>
                    {analyticsError ? '—' : (analytics?.loggedTripCount ?? 0)}
                  </Text>
                </View>
                <View style={styles.travelTile}>
                  <Ionicons name="navigate-outline" size={15} color={ACCENT_BLUE} />
                  <Text style={styles.travelTileLabel}>Logged distance</Text>
                  <Text style={styles.travelTileValue}>
                    {analyticsError
                      ? '—'
                      : `${(analytics?.loggedDistanceKm ?? 0).toFixed(1)} km`}
                  </Text>
                </View>
              </View>

              {/*
                Trips saved without a vehicle. The month total counts them but no
                vehicle row can, so naming the gap keeps the section
                self-consistent instead of looking like data was lost. No vehicle
                is invented and nothing is reassigned.
              */}
              {unassigned ? (
                <View style={styles.unassignedCard}>
                  <View style={styles.unassignedTop}>
                    <Text style={styles.unassignedLabel}>No vehicle saved</Text>
                    <Text style={styles.unassignedValue}>
                      {unassigned.tripCount}{' '}
                      {unassigned.tripCount === 1 ? 'trip' : 'trips'} ·{' '}
                      {unassigned.distanceKm.toFixed(1)} km
                    </Text>
                  </View>
                  <Text style={styles.unassignedHint}>
                    Only trips you chose to save are included.
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ============================ BY VEHICLE
                One compact row per vehicle, never a large card per vehicle.

                A vehicle qualifies when the user has accepted responsibility for
                it OR logged a trip on it this month. Vehicles with neither are
                omitted rather than shown as an empty card.

                Actual and trip-derived figures are kept visually separate: the
                peso figure is authoritative and in forest, the logged travel
                figures are muted and explicitly labelled. They are NOT presented
                as corresponding — a member may log trips on a car where they hold
                only part of the refill responsibility, so the row never implies
                one explains the other. */}
            {vehicleRows && vehicleRows.vehicles.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionRailRow}>
                  <View style={[styles.sectionRail, { backgroundColor: RAIL_OLIVE }]} />
                  <Text style={styles.sectionLabel}>By vehicle</Text>
                </View>
                <View style={styles.vehicleList}>
                  {vehicleRows.vehicles.map((row) => {
                    /*
                     * Share is only meaningful for a vehicle that actually
                     * carries accepted responsibility. A 0% on a trip-only
                     * vehicle reads as "this cost nothing" rather than "you
                     * have no refill responsibility for it", which is a
                     * different and more accurate statement — so the
                     * percentage, the bar and the caption are all omitted.
                     */
                    const hasSpend = row.actualSpend > 0;
                    const share = hasSpend && spent > 0 ? Math.round((row.actualSpend / spent) * 100) : null;
                    const liters = describeLiters(row);
                    const tripSummary =
                      row.loggedTripCount > 0
                        ? `${row.loggedTripCount} ${
                            row.loggedTripCount === 1 ? 'trip' : 'trips'
                          } · ${row.loggedDistanceKm.toFixed(1)} km`
                        : 'No logged trips';

                    return (
                      <View key={row.vehicleId} style={styles.vehicleRow}>
                        <View style={styles.vehicleHead}>
                          <Text style={styles.vehicleName} numberOfLines={1}>
                            {row.label}
                          </Text>
                          {share != null ? <Text style={styles.vehicleShare}>{share}%</Text> : null}
                        </View>

                        {hasSpend ? (
                          <>
                            {/* ACTUAL — money the user is responsible for. */}
                            <View style={styles.vehicleLine}>
                              <Text style={styles.vehicleLineLabel}>Actual responsibility</Text>
                              <Text style={styles.vehicleLineValue}>
                                {formatPeso(row.actualSpend)}
                              </Text>
                            </View>

                            {/*
                              Litres are proportional to the SAME accepted amount
                              as the pesos. Coverage is stated explicitly: a
                              partial figure is never dressed up as the monthly
                              total, because that would understate real usage.
                            */}
                            <View style={styles.vehicleLine}>
                              <Text style={styles.vehicleLineLabel}>Attributed fuel</Text>
                              <Text style={styles.vehicleLineValueMuted}>
                                {liters.kind === 'complete'
                                  ? `${liters.liters.toFixed(1)} L`
                                  : liters.kind === 'partial'
                                    ? `${(row.attributedLiters ?? 0).toFixed(1)} L recorded · ${liters.known}/${liters.relevant} refills`
                                    : 'Not recorded'}
                              </Text>
                            </View>

                            {share != null ? (
                              <>
                                <View style={styles.shareTrack}>
                                  <View
                                    style={[
                                      styles.shareFill,
                                      {
                                        width: `${Math.min(share, 100)}%`,
                                        backgroundColor: statusMeta.color,
                                      },
                                    ]}
                                  />
                                </View>
                                <Text style={styles.vehicleShareCaption}>
                                  {share}% of your actual fuel responsibility
                                </Text>
                              </>
                            ) : null}

                            {/*
                              LOGGED TRAVEL — a separate, opt-in dataset.

                              The hairline is deliberate. Refill money and logged
                              kilometres come from different sources and do not
                              correspond one-to-one, so the travel figure sits
                              below a rule rather than blending in with the peso
                              lines above it.
                            */}
                            <View style={styles.vehicleSplit} />
                            <View style={styles.vehicleLine}>
                              <Text style={styles.vehicleLineLabel}>Logged travel</Text>
                              <Text style={styles.vehicleLineValueMuted}>{tripSummary}</Text>
                            </View>
                          </>
                        ) : (
                          <>
                            <Text style={styles.vehicleNoSpend}>
                              No accepted refill responsibility
                            </Text>
                            <View style={styles.vehicleLine}>
                              <Text style={styles.vehicleLineLabel}>Logged travel</Text>
                              <Text style={styles.vehicleLineValueMuted}>{tripSummary}</Text>
                            </View>
                          </>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/*
              INSIGHTS — one card per statement, each with its own tone dot.

              Earlier these were merged into a single surface for density. The
              design direction calls for separate cards again, and they do read
              better that way: each is a self-contained sentence with one clear
              emphasis, rather than a block of same-weight text.

              Dot colour follows the statement's `tone`, so the three kinds are
              distinguishable at a glance without reading the words.
            */}
            {insights.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Insights</Text>
                <View style={styles.insightList}>
                  {insights.map((insight) => (
                    <View key={insight.key} style={styles.insightRow}>
                      <View
                        style={[
                          styles.insightDot,
                          {
                            backgroundColor:
                              insight.tone === 'caution'
                                ? DOT_CAUTION
                                : insight.tone === 'info'
                                  ? DOT_INFO
                                  : DOT_NEUTRAL,
                          },
                        ]}
                      />
                      <Text style={styles.insightText}>{insight.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Optional-section failure. The headline figures above are still
                correct, so this is a quiet inline note rather than an error
                screen, and it does not imply the spending figure is wrong. */}
            {analyticsError && !error ? (
              <View style={styles.analyticsNotice}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={GasTaColors.forestMuted}
                />
                <Text style={styles.analyticsNoticeText}>
                  Per-vehicle breakdown is unavailable right now. Your actual spending above is
                  still accurate.
                </Text>
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
        {/* ------------------------------------------- budget editor
            Moved out of the page body into a sheet, so the main screen reads as
            a dashboard rather than a form.

            This is a RELOCATION, not a rewrite: it renders the same
            `LabeledInput`s, the same `formNotice`, the same `limitError` /
            `thresholdError` validation, and calls the same `handleSave` and
            `handleDelete`. No save logic or validation was duplicated.

            `openEditor` re-seeds the draft from the saved budget each time, so
            cancelling discards unsaved edits instead of leaking them into a
            later save. `KeyboardAvoidingView` keeps the fields above the
            keyboard at every screen width. */}
        <Modal
          animationType="fade"
          transparent
          visible={editorOpen}
          onRequestClose={closeEditor}>
          <Pressable style={styles.editorBackdrop} onPress={closeEditor}>
            <Pressable style={styles.editorSheet} onPress={() => {}}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.editorHead}>
                  <Text style={styles.editorTitle}>
                    {hasBudget ? 'Edit budget' : 'Set monthly budget'}
                  </Text>
                  <AnimatedPressable
                    accessibilityRole="button"
                    accessibilityLabel="Close budget editor"
                    hitSlop={8}
                    pressScale={0.94}
                    style={styles.editorClose}
                    onPress={closeEditor}>
                    <Ionicons name="close" size={18} color={GasTaColors.forestMuted} />
                  </AnimatedPressable>
                </View>

                <Text style={styles.editorMonthLabel}>
                  {MONTHS[month - 1]} {year}
                </Text>

                {formNotice ? (
                  <View
                    accessibilityRole="alert"
                    style={[
                      styles.formNotice,
                      formNotice.variant === 'error'
                        ? styles.formNoticeError
                        : styles.formNoticeOk,
                    ]}>
                    <Ionicons
                      name={
                        formNotice.variant === 'error'
                          ? 'close-circle-outline'
                          : 'checkmark-circle-outline'
                      }
                      size={16}
                      color={
                        formNotice.variant === 'error' ? palette.danger : GasTaColors.forest
                      }
                    />
                    <Text
                      style={[
                        styles.formNoticeText,
                        {
                          color:
                            formNotice.variant === 'error' ? palette.danger : GasTaColors.forest,
                        },
                      ]}>
                      {formNotice.message}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.editorField}>
                  <LabeledInput
                    label="Monthly budget (₱)"
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

                <View style={styles.editorField}>
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

                <Text style={styles.helperText}>
                  Warn me when spending reaches this percentage. Default is{' '}
                  {DEFAULT_THRESHOLD_PERCENT}%.
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
              </KeyboardAvoidingView>
            </Pressable>
          </Pressable>
        </Modal>


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

  // ---- month selector, now centred inside the dark header -------------------
  /*
   * Centred and deliberately compact. It is a secondary control inside the
   * header, not a second hero element, so the arrows and the surrounding padding
   * were both reduced until the whole pill sits comfortably under the title
   * rather than competing with it. Tap targets stay at 30px, which is still
   * above the 28px minimum for a comfortable press.
   */
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 2,
    padding: 2,
    marginTop: GasTaSpacing.sm,
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(248, 240, 229, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(248, 240, 229, 0.18)',
  },
  monthBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(248, 240, 229, 0.10)',
  },
  monthLabel: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.textOnForest,
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
  /*
   * Overlaps the forest header by a quarter of the header's bottom padding, so
   * the hero's top edge tucks under the dark block and the page does not read as
   * a flat stack of cards.
   *
   * The hero keeps the normal page gutter on both sides: unlike the header
   * background, its white card is NOT bled to the edges, which is what lets the
   * full-width header above it read as a distinct band rather than one more
   * edge-to-edge surface.
   */
  summary: {
    marginTop: -GasTaSpacing.lg,
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
  /*
   * Positioning context for the threshold marker. The track itself clips its
   * fill with `overflow: hidden`, so the marker has to be a sibling of the track
   * rather than a child, and this wrapper is what it positions against.
   */
  trackWrap: {
    position: 'relative',
    marginTop: GasTaSpacing.md,
  },
  track: {
    height: 8,
    borderRadius: GasTaRadius.pill,
    // A faint teal wash rather than a warm neutral, so the empty portion of the
    // bar still reads as part of the same consumption scale.
    backgroundColor: ACCENT_TEAL_SOFT,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: GasTaRadius.pill },
  /*
   * Threshold notch. Strengthened from the previous version, which was too faint
   * to read against the teal wash: it is now 3px wide with a warmer, darker
   * olive tone so the alert point is legible at a glance. Still a thin precise
   * tick and clearly subordinate to the progress bar, which remains the primary
   * element.
   */
  thresholdMark: {
    position: 'absolute',
    top: -4,
    width: 3,
    height: 16,
    marginLeft: -1.5,
    borderRadius: 1.5,
    backgroundColor: '#6B5A18',
  },
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

  // ---- header -------------------------------------------------------------
  /*
   * Dark forest block with rounded bottom corners. It owns the title, the Edit
   * budget pill, and the centred month selector, so the hero card below reads as
   * one floating surface rather than the first of many stacked blocks.
   *
   * The forest background is bled to the left and right screen edges, and it
   * starts immediately below the safe-area region. The content inside keeps the
   * page gutter on all sides.
   */
  /*
   * VERTICAL POSITION — cancel the page's top gutter only.
   *
   * Three things stack above the title:
   *   1. the tab layout's `<SafeAreaView edges={['top']}>` = insets.top
   *   2. this ScrollView's `content.paddingTop`    = GasTaSpacing.lg
   *   3. this header's own `paddingTop`            = GasTaSpacing.lg
   *
   * (1) is the real status bar / notch and is left completely alone. (3) is
   * breathing room between the forest's top edge and the title, so the title
   * never crowds the notch.
   *
   * (2) was the problem: it stacked a full 24pt band of cream between the safe
   * area and the forest, which read as a gap rather than as a header. A negative
   * margin of exactly that same token cancels it, so the forest begins
   * immediately below the safe-area region and the status-bar area stays cream.
   *
   * Deliberately NOT `-(insets.top + spacing)`: that would pull the header
   * behind the status bar, which is not wanted.
   *
   * HORIZONTAL BLEED — background to both screen edges, content inset.
   * `marginHorizontal` cancels the page gutter and `paddingHorizontal` puts it
   * back, so the two cancel for the CONTENT while the BACKGROUND runs edge to
   * edge. Both use the shared spacing token, not a device width, so this holds
   * at 320, 375, 390, 430 and web.
   */
  header: {
    marginTop: -GasTaSpacing.lg,
    marginHorizontal: -GasTaSpacing.lg,
    paddingHorizontal: GasTaSpacing.lg,
    paddingTop: GasTaSpacing.lg,
    paddingBottom: GasTaSpacing.xl,
    backgroundColor: GasTaColors.forest,
    // Only the bottom corners are rounded; the sides run off-screen and the top
    // is a straight edge under the safe area.
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GasTaSpacing.md,
  },
  headerTitle: {
    ...typeScale.pageTitle,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: GasTaColors.textOnForest,
    // `flex: 1` with `numberOfLines={1}` on the Text: the title yields space to
    // the Edit budget pill rather than pushing it off the row. Without this, a
    // long month label below could squeeze the action on a 320px screen.
    flex: 1,
  },
  /**
   * Quiet translucent pill, not a filled white button. On the dark header a
   * solid fill would out-weigh the hero figure below it; this reads as available
   * without competing.
   */
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: 7,
    borderRadius: GasTaRadius.pill,
    backgroundColor: 'rgba(248, 240, 229, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248, 240, 229, 0.28)',
  },
  headerActionText: {
    ...typeScale.bodySmall,
    fontWeight: '700',
    color: GasTaColors.textOnForest,
  },

  /* ---- decorative route motif --------------------------------------------
   * Three dots on a curve plus one faint arc. Absolutely positioned inside the
   * header and clipped by its `overflow: hidden`, so it cannot push layout.
   *
   * Sits low and to the right, around the month selector, and is deliberately
   * very faint. An earlier version sat high and near the Edit budget pill,
   * where it competed with a real control; the title and the action now have
   * clear space, and this reads as texture rather than a foreground graphic.
   */
  headerMotif: {
    position: 'absolute',
    bottom: 18,
    right: 10,
    width: 150,
    height: 84,
  },
  headerMotifArc: {
    position: 'absolute',
    top: 18,
    right: 6,
    width: 116,
    height: 54,
    borderWidth: 1.5,
    borderColor: 'rgba(248, 240, 229, 0.09)',
    borderTopLeftRadius: 116,
    borderBottomLeftRadius: 116,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    borderRightWidth: 0,
    transform: [{ rotate: '-8deg' }],
  },
  headerDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    // Lower contrast than the header's own text, so the dots never pull focus.
    backgroundColor: 'rgba(248, 240, 229, 0.20)',
  },
  headerDotA: { top: 8, right: 22 },
  headerDotB: { top: 36, right: 8 },
  headerDotC: { top: 64, right: 28 },
  /** Under the status line in the hero; a plain calendar fact, not a warning. */
  daysRemaining: {
    ...typeScale.caption,
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.forestMuted,
    marginTop: GasTaSpacing.xs,
  },

  // ---- actual vs estimated ------------------------------------------------
  compareCard: {
    padding: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: GasTaSpacing.md,
  },
  // minWidth 0 lets the label column shrink so the peso figure never wraps or
  // is pushed off-screen at 320px.
  compareText: { flex: 1, minWidth: 0 },
  compareLabel: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  compareHint: {
    ...typeScale.caption,
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  compareValueActual: {
    ...typeScale.body,
    fontWeight: '800',
    color: GasTaColors.forest,
  },
  // Deliberately muted: the estimate must never compete with the actual figure
  // for attention, and must not read as an equal kind of number.
  /*
   * The trip estimate. Strengthened from `textSoft` (0.42 alpha), which was too
   * pale to read comfortably next to the actual figure. `textMuted` (0.62) keeps
   * it clearly subordinate to the forest `compareValueActual` above while being
   * comfortably legible — the estimate is meant to be readable, not hidden.
   */
  compareValueMuted: {
    ...typeScale.body,
    fontWeight: '700',
    color: GasTaColors.textMuted,
  },
  compareDivider: {
    height: 1,
    backgroundColor: GasTaColors.glassBorderSubtle,
    marginVertical: GasTaSpacing.sm,
  },
  /*
   * Beige inset note. Pale and warm rather than grey, so it reads as part of the
   * card's content instead of a disabled field, and inset with its own border so
   * it is clearly a qualifier on the two figures above rather than a third one.
   */
  /*
   * Beige inset note wrapper. Pale and warm rather than grey, so it reads as
   * part of the card's content instead of a disabled field, and inset with its
   * own border so it is clearly a qualifier on the two figures above rather than
   * a third one of them.
   */
  compareFooter: {
    marginTop: GasTaSpacing.md,
    padding: GasTaSpacing.sm + 2,
    borderRadius: GasTaRadius.sm,
    backgroundColor: NOTE_BEIGE,
    borderWidth: 1,
    borderColor: NOTE_BEIGE_BORDER,
  },
  compareFooterText: {
    ...typeScale.caption,
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.forestMuted,
  },

  // ---- section scaffolding ------------------------------------------------
  /*
   * Budget's own section rhythm. `sectionCard` already existed for the old
   * single card; these wrap each new dashboard block so the page reads as a
   * stack of labelled sections rather than a wall of unrelated cards.
   */
  /*
   * Slightly tighter than the original `lg` (24). The page stacks four sections
   * plus a hero, and the earlier gap left a visible band of empty cream between
   * each. This is a modest reduction only — hierarchy and breathing room are
   * unchanged, and the page does not become dense.
   */
  section: {
    marginBottom: GasTaSpacing.md + GasTaSpacing.xs,
  },
  sectionLabel: {
    ...typeScale.caption,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: GasTaColors.forestMuted,
  },
  /*
   * Section title with a colour rail to its left. Each lower section passes its
   * own hue, so the page reads as a set of labelled bands instead of a stack of
   * identical white cards. The rail is 3px and flush with the cap height of the
   * uppercase label, so it punctuates rather than decorating.
   */
  sectionRailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    marginBottom: GasTaSpacing.sm,
  },
  sectionRail: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },

  // ---- travel this month --------------------------------------------------
  /*
   * Two equal tiles. `flex: 1` on each with a gap keeps them identical at every
   * width, and the row wraps nothing: "Logged distance" is the longest label and
   * is allowed to shrink rather than push the value off the tile.
   */
  travelTileRow: {
    flexDirection: 'row',
    gap: GasTaSpacing.sm,
  },
  travelTile: {
    // minWidth 0 lets the label shrink on a 320px screen so the value column
    // never gets squeezed off the card.
    flex: 1,
    minWidth: 0,
    paddingVertical: GasTaSpacing.md,
    paddingHorizontal: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  travelTileLabel: {
    ...typeScale.caption,
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.forestMuted,
    marginTop: 6,
  },
  travelTileValue: {
    ...typeScale.sectionHeading,
    fontSize: 20,
    fontWeight: '800',
    color: GasTaColors.forestDark,
    marginTop: 2,
  },
  /* Horizontal card for logged travel that has no vehicle attached. */
  unassignedCard: {
    marginTop: GasTaSpacing.sm,
    paddingVertical: GasTaSpacing.sm + 2,
    paddingHorizontal: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  unassignedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GasTaSpacing.sm,
  },
  unassignedLabel: {
    ...typeScale.bodySmall,
    fontWeight: '700',
    flexShrink: 1,
    color: GasTaColors.forestDark,
  },
  unassignedValue: {
    ...typeScale.bodySmall,
    fontWeight: '700',
    color: GasTaColors.forestMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  unassignedHint: {
    ...typeScale.caption,
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },


  // ---- by vehicle ---------------------------------------------------------
  vehicleList: { gap: GasTaSpacing.sm },
  vehicleRow: {
    paddingVertical: GasTaSpacing.md,
    paddingHorizontal: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  vehicleHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: GasTaSpacing.sm,
  },
  // flexShrink 1 + numberOfLines keeps a long nickname from pushing the
  // percentage off the row at 320px.
  vehicleName: {
    ...typeScale.body,
    fontWeight: '800',
    flexShrink: 1,
    color: GasTaColors.forestDark,
  },
  vehicleShare: {
    ...typeScale.body,
    fontWeight: '800',
    color: GasTaColors.forest,
  },
  vehicleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GasTaSpacing.sm,
    marginTop: GasTaSpacing.xs,
  },
  /*
   * Hairline between the ACTUAL block (money, fuel, share) and the LOGGED TRAVEL
   * block below it. It is the visual guarantee that "₱1,100 bought exactly the
   * fuel for these 9 km" is never implied: the two datasets sit on opposite
   * sides of a rule and are labelled independently.
   */
  vehicleSplit: {
    height: 1,
    marginTop: GasTaSpacing.md,
    marginBottom: GasTaSpacing.xs,
    backgroundColor: GasTaColors.glassBorderSubtle,
  },
  vehicleLineLabel: {
    ...typeScale.caption,
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
    color: GasTaColors.forestMuted,
  },
  vehicleLineValue: {
    ...typeScale.bodySmall,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  vehicleLineValueMuted: {
    ...typeScale.bodySmall,
    fontWeight: '600',
    color: GasTaColors.forestMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  shareTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: GasTaSpacing.sm,
    backgroundColor: ACCENT_TEAL_SOFT,
    overflow: 'hidden',
  },
  shareFill: {
    height: '100%',
    borderRadius: 2,
  },
  vehicleShareCaption: {
    ...typeScale.caption,
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.forestMuted,
    marginTop: GasTaSpacing.xs,
  },
  /* Stated in words, never as a ₱0 that would read as "cost nothing". */
  vehicleNoSpend: {
    ...typeScale.caption,
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.forestMuted,
    marginTop: GasTaSpacing.xs,
  },
  // ---- insights -----------------------------------------------------------
  /*
   * One card per insight. These were merged into a single surface in an earlier
   * pass for density; the design direction calls for separate cards, and each
   * statement reads better as a self-contained unit with a single tone dot.
   */
  insightList: { gap: GasTaSpacing.sm },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GasTaSpacing.sm,
    // Reduced from `md` (16) to `sm + 2` (10), roughly 20% less vertical
    // padding. Text size and line height are untouched, so readability is
    // identical; only the page gets shorter. The gap between cards is kept.
    paddingVertical: GasTaSpacing.sm + 2,
    paddingHorizontal: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  /* Small marker, not an icon bubble. */
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  insightText: {
    ...typeScale.bodySmall,
    flex: 1,
    // Wraps as a block so a long sentence reflows instead of being truncated.
    lineHeight: 19,
    color: GasTaColors.forestDark,
  },
  analyticsNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: GasTaSpacing.md,
    borderRadius: GasTaRadius.sm,
    backgroundColor: ICON_TINT_BG,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  analyticsNoticeText: {
    ...typeScale.caption,
    flex: 1,
    lineHeight: 17,
    color: GasTaColors.forestMuted,
  },

  // ---- budget editor sheet ------------------------------------------------
  editorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 48, 25, 0.45)',
    justifyContent: 'flex-end',
  },
  editorSheet: {
    backgroundColor: GasTaColors.creamLight,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: GasTaSpacing.lg,
    paddingTop: GasTaSpacing.md,
    paddingBottom: GasTaSpacing.xl,
  },
  editorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GasTaSpacing.md,
  },
  editorTitle: {
    ...typeScale.sectionHeading,
    flexShrink: 1,
    color: GasTaColors.forestDark,
  },
  editorClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ICON_TINT_BG,
  },
  editorMonthLabel: {
    ...typeScale.caption,
    fontSize: 12,
    color: GasTaColors.forestMuted,
    marginTop: 2,
    marginBottom: GasTaSpacing.md,
  },
  editorField: { marginBottom: GasTaSpacing.xs },

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

  // Deliberate compact destructive control: a quiet outlined pill, not a red
  // text link and not a full-width filled button.
  saveBtn: { marginTop: GasTaSpacing.sm },
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
