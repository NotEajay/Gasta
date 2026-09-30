import { formatPeso } from '@/lib/format';

import type { BudgetAnalytics, VehicleBudgetRow } from '@/lib/services/budgetAnalytics';

/**
 * Deterministic, explainable insights for the Budget screen.
 *
 * Every one of these is a restatement of a number already on screen. None is
 * generated, inferred, or advisory in the "you should do X" sense — the audit
 * was explicit that logged-trip coverage is opt-in, so nothing here can support
 * a claim about how someone *should* drive.
 *
 * Rules deliberately absent:
 *   - actual cost per km        (refill money over opt-in distance is biased)
 *   - month-end projection      (refills are lumpy; linear pacing is noise)
 *   - trip-derived litres       (efficiency is not persisted on trip_records)
 *   - "vehicle X is inefficient" (compares logging habits, not vehicles)
 */

/**
 * Dot tone for one insight.
 *
 *   info    -> neutral fact (budget timing)          -> blue
 *   caution -> worth a second look (one vehicle)     -> amber
 *   neutral -> restatement of displayed figures       -> olive
 *
 * `neutral` is the majority case, so a green/olive dot reads as the default and
 * a coloured one means the statement is worth noticing.
 */
export type BudgetInsightTone = 'info' | 'neutral' | 'caution';

export interface BudgetInsight {
  key: string;
  text: string;
  tone: BudgetInsightTone;
}

export interface InsightInput {
  analytics: BudgetAnalytics;
  /** The authoritative "Spent this month" figure. */
  actualSpend: number;
  /** The trip-derived estimate, kept strictly separate from actualSpend. */
  estimatedTripCost: number;
  /** 0..100, or null when no budget is set. */
  budgetUsedPercent: number | null;
  /** Days left in the selected month; null when it is not the current month. */
  daysRemaining: number | null;
}

/** Hard cap from the product decision: the Insights section is a summary, not a report. */
const MAX_INSIGHTS = 4;

/** Trims a peso difference to a clean peso string, e.g. "₱260". */
function pesoDelta(value: number): string {
  return formatPeso(Math.round(Math.abs(value)));
}

/** "1 logged trip" / "5 logged trips" — avoids a stray plural. */
function tripWord(count: number): string {
  return count === 1 ? '1 logged trip' : `${count} logged trips`;
}

/**
 * Vehicles worth a row in "By vehicle": the user has accepted responsibility
 * for them OR logged a trip on them this month. A vehicle with neither is not
 * part of this month's story and is omitted rather than shown as an empty card.
 */
export function activeVehicles(vehicles: VehicleBudgetRow[]): VehicleBudgetRow[] {
  return vehicles.filter(
    (v) => v.actualSpend > 0 || v.loggedTripCount > 0 || v.loggedDistanceKm > 0
  );
}

/**
 * Vehicles with any activity in the month, most responsible first.

/**
 * Build the insight list, in priority order. Capped at four so the section
 * stays a summary rather than a report.
 */
export function buildBudgetInsights(input: InsightInput): BudgetInsight[] {
  const { analytics, actualSpend, estimatedTripCost } = input;
  const insights: BudgetInsight[] = [];
  const vehicles = activeVehicles(analytics.vehicles);

  // 1. Share of budget by vehicle. Factual and directly traceable to the
  // per-vehicle rows. No percentage when the total is zero.
  if (actualSpend > 0) {
    const top = [...vehicles].sort((a, b) => b.actualSpend - a.actualSpend)[0];
    if (top && top.actualSpend > 0) {
      const share = Math.round((top.actualSpend / actualSpend) * 100);
      insights.push({
        key: 'top-spend',
        text: `${top.label} accounts for ${share}% of your actual fuel responsibility this month.`,
        tone: share >= 60 ? 'caution' : 'neutral',
      });
    }
  }

  // 2. Which vehicle produced most of the logged distance. Labelled as logged
  // because trip_records are opt-in history, not automatic odometer data.
  const withDistance = [...vehicles].filter((v) => v.loggedDistanceKm > 0);
  if (withDistance.length > 0) {
    const top = withDistance.sort((a, b) => b.loggedDistanceKm - a.loggedDistanceKm)[0];
    if (top && analytics.loggedDistanceKm > 0) {
      const topShare = Math.round((top.loggedDistanceKm / analytics.loggedDistanceKm) * 100);
      const topSpendShare =
        actualSpend > 0 ? Math.round((top.actualSpend / actualSpend) * 100) : 0;

      /*
       * Merge rather than repeat.
       *
       * When one vehicle leads BOTH spend and distance, the two rules produce
       * the same observation, and emitting both would print the same vehicle
       * and the same percentage twice in a four-item list. So the distance
       * leader is folded into the spend insight and the distance row is
       * suppressed. The reverse case is kept separate on purpose: a vehicle that
       * leads distance but NOT spend is a genuinely different fact, because it
       * means logged travel and refill responsibility are not lining up.
       */
      if (
        insights[0]?.key === 'top-spend' &&
        topSpendShare >= 60 &&
        topShare >= 60 &&
        insights[0].text.startsWith(top.label)
      ) {
        insights.splice(0, 1, {
          key: 'top-both',
          text: `${top.label} accounts for ${topSpendShare}% of your actual fuel responsibility and ${topShare}% of your logged distance this month.`,
          tone: 'caution',
        });
      } else {
        insights.push({
          key: 'top-distance',
          text: `Most of your logged distance this month came from ${top.label} — ${top.loggedDistanceKm.toFixed(
            0
          )} km of ${analytics.loggedDistanceKm.toFixed(0)} km logged.`,
          tone: 'neutral',
        });
      }
    }
  }

  // 3. Budget pace. Factual: percent used and days left are both facts already
  // displayed. No extrapolation to a month-end figure.
  if (input.budgetUsedPercent != null && input.daysRemaining != null) {
    // On the final day the count is 0, and "with 0 days remaining" reads as a
    // bug rather than a fact. Phrased as "on the last day of the month" so this
    // sentence agrees with the hero's time-context line.
    const timing =
      input.daysRemaining === 0
        ? 'on the last day of the month'
        : `with ${input.daysRemaining} ${
            input.daysRemaining === 1 ? 'day' : 'days'
          } remaining`;
    insights.push({
      key: 'pace',
      text: `You have used ${input.budgetUsedPercent}% of this month's budget ${timing}.`,
      // 'info' when healthy, 'caution' once past the alert threshold, so the
      // dot colour carries the same judgement the hero status line does.
      tone: input.budgetUsedPercent >= 80 ? 'caution' : 'info',
    });
  }

  // 4. Actual vs trip-derived estimate. Both halves are already on screen, and
  // the gap is stated as a difference rather than a verdict, because the two
  // measure different things and are not expected to match.
  if (analytics.loggedTripCount > 0 && actualSpend > 0 && estimatedTripCost > 0) {
    const delta = actualSpend - estimatedTripCost;
    if (Math.abs(delta) >= 1) {
      insights.push({
        key: 'actual-vs-estimate',
        text:
          delta > 0
            ? `Your actual refill responsibility is ${pesoDelta(delta)} higher than the fuel estimate from your logged trips.`
            : `The fuel estimate from your logged trips is ${pesoDelta(delta)} higher than your actual refill responsibility.`,
        tone: 'neutral',
      });
    }
  }

  // 5. Logged travel with no accepted refill responsibility. A
  //    data-completeness observation, phrased neutrally — it does not suggest the
  //    user did anything wrong.
  //
  //    The count comes from summing the affected vehicles rather than from the
  //    first one, so the number always matches the rows on screen. "logged trip"
  //    already carries the word, hence no second "logged" before "this month".
  const noResponsibility = vehicles.filter((v) => v.actualSpend === 0 && v.loggedTripCount > 0);
  if (noResponsibility.length > 0 && vehicles.length > 1) {
    const first = noResponsibility[0];
    const count = noResponsibility.reduce((sum, v) => sum + v.loggedTripCount, 0);
    insights.push({
      key: 'no-responsibility',
      text: `${first.label} has ${tripWord(count)} this month with no accepted refill responsibility.`,
      tone: 'neutral',
    });
  }

  /*
   * Display order, applied as a stable sort rather than by the order the rules
   * happen to run. The rules read most naturally in rule order, but the
   * requested reading order starts with budget status / time context, so the two
   * are kept separate instead of contorting the rules to match.
   *
   *   1. budget status / month timing
   *   2. largest actual-responsibility vehicle
   *   3. actual vs logged-trip estimate
   *   4. travel logged without accepted responsibility
   *
   * 'top-distance' sits below all four. A standalone distance leader is the
   * weakest of these facts: when the same vehicle leads spend, the two are
   * already merged into 'top-both', so a separate distance line would just
   * restate it. It only surfaces when nothing better fired.
   *
   * Everything a rule produced is SORTED and then capped. The cap is applied
   * last so it can never silently discard a rule that genuinely fired: a
   * completeness note about a vehicle with no accepted responsibility is more
   * useful than a third restatement of the biggest spender. Rules only run when
   * their own preconditions hold, and an insight that adds little is left out
   * rather than used to fill a slot.
   */
  const RANK: Record<string, number> = {
    pace: 0,
    'top-both': 1,
    'top-spend': 2,
    'actual-vs-estimate': 3,
    'no-responsibility': 4,
    'top-distance': 5,
  };

  return insights
    .slice()
    .sort((a, b) => (RANK[a.key] ?? 99) - (RANK[b.key] ?? 99))
    .slice(0, MAX_INSIGHTS);
}

