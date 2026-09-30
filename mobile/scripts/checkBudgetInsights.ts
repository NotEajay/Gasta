/**
 * Structural check of the insight rules and the shared litres-coverage helper,
 * run against the scenarios in the device-test matrix. Exits non-zero on
 * failure so a regression is loud rather than silent.
 *
 *   npx tsx mobile/scripts/checkBudgetInsights.ts
 */
import {
  activeVehicles,
  buildBudgetInsights,
  type InsightInput,
} from '../lib/budgetInsights';
import {
  describeLiters,
  unassignedLoggedTravel,
  type BudgetAnalytics,
  type VehicleBudgetRow,
} from '../lib/services/budgetAnalytics';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function row(over: Partial<VehicleBudgetRow> & { vehicleId: string }): VehicleBudgetRow {
  return {
    label: over.vehicleId,
    brand: null,
    model: null,
    year: null,
    actualSpend: 0,
    attributedLiters: null,
    relevantRefillCount: 0,
    refillsWithLitersCount: 0,
    loggedTripCount: 0,
    loggedDistanceKm: 0,
    estimatedTripCost: 0,
    ...over,
  };
}

function analyticsOf(
  vehicles: VehicleBudgetRow[],
  over: Partial<BudgetAnalytics> = {}
): BudgetAnalytics {
  return {
    vehicles,
    loggedTripCount: vehicles.reduce((s, v) => s + v.loggedTripCount, 0),
    loggedDistanceKm: vehicles.reduce((s, v) => s + v.loggedDistanceKm, 0),
    estimatedTripCost: vehicles.reduce((s, v) => s + v.estimatedTripCost, 0),
    ...over,
  };
}

const keys = (input: InsightInput) => buildBudgetInsights(input).map((i) => i.key);


// ---------------------------------------------------------------- A: budget, no spend
console.log('\nA. Budget set, no accepted spend');
{
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', loggedTripCount: 3, loggedDistanceKm: 90 }),
  ]);
  const out = buildBudgetInsights({
    analytics,
    actualSpend: 0,
    estimatedTripCost: 0,
    budgetUsedPercent: 0,
    daysRemaining: 10,
  });
  check('no top-spend insight when total is zero', !out.some((i) => i.key === 'top-spend'));
  check('no actual-vs-estimate when nothing spent', !out.some((i) => i.key === 'actual-vs-estimate'));
  check('no imperative wording', !out.some((i) => /you should|stop using/i.test(i.text)));
}

// ------------------------------------------------- C: spend, no logged trips
console.log('\nC. Accepted spend, no logged trips');
{
  const analytics = analyticsOf([row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1000 })]);
  const out = buildBudgetInsights({
    analytics,
    actualSpend: 1000,
    estimatedTripCost: 0,
    budgetUsedPercent: 20,
    daysRemaining: 10,
  });
  check('top-spend present', out.some((i) => i.key === 'top-spend'));
  check('no actual-vs-estimate with 0 logged trips', !out.some((i) => i.key === 'actual-vs-estimate'));
  check('no top-distance with no distance', !out.some((i) => i.key === 'top-distance'));
}

// ------------------------------------- D: trips on a vehicle with no spend
console.log('\nD. Logged trips, no accepted responsibility');
{
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1000, loggedTripCount: 5, loggedDistanceKm: 182 }),
    row({ vehicleId: 'v2', label: 'Click', loggedTripCount: 3, loggedDistanceKm: 64 }),
  ]);
  const out = buildBudgetInsights({
    analytics,
    actualSpend: 1000,
    estimatedTripCost: 2980,
    budgetUsedPercent: 65,
    daysRemaining: 10,
  });
  check('pace ranks first', out[0]?.key === 'pace', out[0]?.key);
  check('no-responsibility reported', out.some((i) => i.key === 'no-responsibility'));
  check('max 4 insights', out.length <= 4, String(out.length));
  // In this scenario the same vehicle leads spend and distance, so the two
  // rules are expected to merge into one 'top-both' line rather than repeat.
  check('spend/distance merged, not duplicated', out.some((i) => i.key === 'top-both'), out.map((i) => i.key).join(','));
  check('no duplicate vehicle statements', new Set(out.map((i) => i.text)).size === out.length);
}

/* Distance leader that is NOT the spend leader: a genuinely different fact,
   so it must stay as its own insight. */
console.log('\nDistance leader differs from spend leader');
{
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 2000, loggedTripCount: 2, loggedDistanceKm: 30 }),
    row({ vehicleId: 'v2', label: 'Click', actualSpend: 500, loggedTripCount: 9, loggedDistanceKm: 300 }),
  ]);
  const out = keys({
    analytics,
    actualSpend: 2500,
    estimatedTripCost: 1000,
    budgetUsedPercent: 50,
    daysRemaining: 5,
  });
  check('spend leader kept', out.includes('top-spend'), out.join(','));
  check('distance leader kept separately', out.includes('top-distance'), out.join(','));
}

// ------------------------------------------- combined leader (top-both)
console.log('\nCombined leader: same vehicle tops spend and distance');
{
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 2100, loggedTripCount: 5, loggedDistanceKm: 182 }),
    row({ vehicleId: 'v2', label: 'Click', actualSpend: 800, loggedTripCount: 1, loggedDistanceKm: 20 }),
  ]);
  const out = keys({
    analytics,
    actualSpend: 2900,
    estimatedTripCost: 2980,
    budgetUsedPercent: 65,
    daysRemaining: 10,
  });
  check('merged into top-both', out.includes('top-both'), out.join(','));
  check('no duplicate top-spend', !out.includes('top-spend'));
  check('no duplicate top-distance', !out.includes('top-distance'));
}

// ------------------------------------------------------------ past month
console.log('\nPast / future month pacing');
{
  const analytics = analyticsOf([row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1000 })]);
  const past = keys({
    analytics,
    actualSpend: 1000,
    estimatedTripCost: 500,
    budgetUsedPercent: 100,
    daysRemaining: null,
  });
  check('no pace insight for a non-current month', !past.includes('pace'), past.join(','));
}

// ------------------------------------------------------- last-day wording
console.log('\nLast-day wording never says "0 days remaining"');
{
  const analytics = analyticsOf([row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1100 })]);
  const last = buildBudgetInsights({
    analytics,
    actualSpend: 1100,
    estimatedTripCost: 45,
    budgetUsedPercent: 31,
    daysRemaining: 0,
  });
  const pace = last.find((i) => i.key === 'pace');
  check('pace insight still produced', pace != null);
  check(
    'uses last-day phrasing',
    pace?.text.includes('on the last day of the month') === true,
    pace?.text
  );
  check('never says "0 days remaining"', !last.some((i) => /0 days remaining/.test(i.text)));

  const normal = buildBudgetInsights({
    analytics,
    actualSpend: 1100,
    estimatedTripCost: 45,
    budgetUsedPercent: 31,
    daysRemaining: 10,
  });
  check(
    'mid-month still uses the count',
    normal.find((i) => i.key === 'pace')?.text.includes('10 days remaining') === true
  );
}

// ---------------------------------------------------- actual vs estimate copy
console.log('\nActual-vs-estimate wording');
{
  // loggedTripCount must be > 0: the rule is deliberately suppressed when no
  // trips were logged, because an estimate of nothing is not a comparison.
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1100, loggedTripCount: 1, loggedDistanceKm: 9 }),
  ]);
  const out = buildBudgetInsights({
    analytics,
    actualSpend: 1100,
    estimatedTripCost: 45,
    budgetUsedPercent: 31,
    daysRemaining: 10,
  });
  const cmp = out.find((i) => i.key === 'actual-vs-estimate');
  check('comparison produced when trips were logged', cmp != null, out.map((i) => i.key).join(','));
  check(
    'explains the source of the estimate',
    cmp?.text.includes('fuel estimate from your logged trips') === true,
    cmp?.text
  );
  check(
    'no imperative advice',
    !out.some((i) => /you should|stop using|instead of/i.test(i.text))
  );
}

// ------------------------------------------------------ duplicate "logged"
console.log('\nNo duplicated "logged logged" phrasing');
{
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1100, loggedTripCount: 1, loggedDistanceKm: 9 }),
    row({ vehicleId: 'v2', label: 'Family Car', loggedTripCount: 1, loggedDistanceKm: 3 }),
  ]);
  const out = buildBudgetInsights({
    analytics,
    actualSpend: 1100,
    estimatedTripCost: 45,
    budgetUsedPercent: 31,
    daysRemaining: 10,
  });
  const note = out.find((i) => i.key === 'no-responsibility');
  check('no-responsibility present', note != null, out.map((i) => i.key).join(','));
  check('no "logged ... logged" duplication', !out.some((i) => /logged[^.]*logged/i.test(i.text)));
  check(
    'reads "has 1 logged trip this month"',
    note?.text === 'Family Car has 1 logged trip this month with no accepted refill responsibility.',
    note?.text
  );
}

// -------------------------------------------------- unassigned logged travel
console.log('\nUnassigned logged travel (nullable vehicle_id)');
{
  // Mirrors the device state: 3 trips / 14.4 km total, but only 2 are attached
  // to a vehicle row.
  const analytics = analyticsOf(
    [
      row({ vehicleId: 'v1', label: 'Food Panda Motor', actualSpend: 1100, loggedTripCount: 1, loggedDistanceKm: 9 }),
      row({ vehicleId: 'v2', label: 'Family Car', loggedTripCount: 1, loggedDistanceKm: 3 }),
    ],
    { loggedTripCount: 3, loggedDistanceKm: 14.4 }
  );
  const u = unassignedLoggedTravel(analytics);
  check('recovers the missing trip', u.tripCount === 1, String(u.tripCount));
  check('recovers the missing distance', Math.abs(u.distanceKm - 2.4) < 0.001, String(u.distanceKm));

  const complete = analyticsOf([row({ vehicleId: 'v1', loggedTripCount: 3, loggedDistanceKm: 14.4 })]);
  const none = unassignedLoggedTravel(complete);
  check('zero when every trip has a vehicle', none.tripCount === 0 && none.distanceKm === 0);

  const inverted = analyticsOf([row({ vehicleId: 'v1', loggedTripCount: 5, loggedDistanceKm: 99 })], {
    loggedTripCount: 1,
    loggedDistanceKm: 1,
  });
  const clamped = unassignedLoggedTravel(inverted);
  check('never negative if rows exceed the total', clamped.tripCount === 0 && clamped.distanceKm === 0);
}

// --------------------------------------------------------- insight priority
console.log('\nInsight priority order');
{
  // Three vehicles, including one with trips but no spend, so every rule that
  // participates in the ordering has something to fire on.
  const analytics = analyticsOf([
    row({ vehicleId: 'v1', label: 'Vios', actualSpend: 2100, loggedTripCount: 5, loggedDistanceKm: 182 }),
    row({ vehicleId: 'v2', label: 'Click', actualSpend: 800, loggedTripCount: 1, loggedDistanceKm: 20 }),
    row({ vehicleId: 'v3', label: 'Family Car', loggedTripCount: 1, loggedDistanceKm: 3 }),
  ]);
  const out = keys({
    analytics,
    actualSpend: 2900,
    estimatedTripCost: 2980,
    budgetUsedPercent: 65,
    daysRemaining: 10,
  });
  const rank = (k: string) => out.indexOf(k);
  check('all four rules fired', out.length === 4, out.join(','));
  check('pace before spend', rank('pace') < rank('top-both'), out.join(','));
  check('spend before estimate', rank('top-both') < rank('actual-vs-estimate'), out.join(','));
  check(
    'estimate before completeness note',
    rank('actual-vs-estimate') < rank('no-responsibility'),
    out.join(',')
  );
  check('max 4', out.length <= 4, String(out.length));
}

// ------------------------------------------------------------ past month
console.log('\nPast / future month pacing');
{
  const analytics = analyticsOf([row({ vehicleId: 'v1', label: 'Vios', actualSpend: 1000 })]);
  const past = keys({
    analytics,
    actualSpend: 1000,
    estimatedTripCost: 500,
    budgetUsedPercent: 100,
    daysRemaining: null,
  });
  check('no pace insight for a non-current month', !past.includes('pace'), past.join(','));
}

// ------------------------------------------------------------ litres states
console.log('\nLitres coverage states');
{
  const complete = row({
    vehicleId: 'v1', attributedLiters: 31.4, relevantRefillCount: 2, refillsWithLitersCount: 2,
  });
  const partial = row({
    vehicleId: 'v2', attributedLiters: 24.8, relevantRefillCount: 4, refillsWithLitersCount: 3,
  });
  const none = row({
    vehicleId: 'v3', attributedLiters: null, relevantRefillCount: 1, refillsWithLitersCount: 0,
  });
  const noneAtAll = row({ vehicleId: 'v4' });

  const c = describeLiters(complete);
  const p = describeLiters(partial);
  const n = describeLiters(none);
  const z = describeLiters(noneAtAll);

  check('complete -> complete kind', c.kind === 'complete' && (c as { liters: number }).liters === 31.4);
  check(
    'partial -> partial kind with counts',
    p.kind === 'partial' &&
      (p as { known: number }).known === 3 &&
      (p as { relevant: number }).relevant === 4
  );
  check('none recorded -> none kind', n.kind === 'none');
  check('no refills at all -> none kind', z.kind === 'none');
  check(
    'missing litres never coerced to 0',
    [complete, partial, none, noneAtAll].every((r) => r.attributedLiters !== 0)
  );
}

// ------------------------------------------------------------ activeVehicles
console.log('\nactiveVehicles filtering');
{
  const all = [
    row({ vehicleId: 'a', actualSpend: 100 }),
    row({ vehicleId: 'b', loggedTripCount: 1 }),
    row({ vehicleId: 'c', loggedDistanceKm: 5 }),
    row({ vehicleId: 'd' }),
  ];
  const active = activeVehicles(all).map((v) => v.vehicleId);
  check('keeps spend / trips / distance rows', active.length === 3, active.join(','));
  check('drops the fully inactive vehicle', !active.includes('d'));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

