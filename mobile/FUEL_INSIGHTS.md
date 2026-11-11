# Personal fuel insights

Home highlights one observation: completed-month spending change when supported, otherwise the largest recorded vehicle expense. Budget status stays in the compact spending card below the fuel price feature and the two primary actions. The full Fuel history view retains all three explanations, their evidence and date ranges. `View history` opens Budget's new Fuel history view. The monthly bars cover six calendar months ending in the selected month; tapping a month opens its existing Budget overview.

## Calculation rules

- Spending change compares the two newest completed months in the loaded period. An unfinished month is never compared with a completed month. Both months need recorded accepted refills before a percentage is shown. A zero baseline is never used as a divisor.
- Actual amounts come from the existing `monthly_budget_analytics` RPC's totals row. Only the caller's accepted allocations on non-voided refills count. Pending, rejected, cancelled and other users' amounts are excluded by that existing server calculation.
- The RPC groups `occurred_at` in UTC. The history view discloses this to match the Budget totals at month boundaries.
- Budget status uses that month's saved limit and alert threshold. No budget and an unreadable budget are different states.
- Largest vehicle expense uses accepted amounts rather than full shared-vehicle refill totals. It describes spending responsibility, not measured vehicle efficiency.
- Trip cost estimates are never added to recorded refill spending. A spending decrease is not presented as proven savings.
- Missing responses, malformed totals or unreconciled vehicle rows are unavailable, never zero. Months with no recorded refills do not establish that no spending happened.

## Data loading

Home reads three months; the history view reads six. Requests are bounded and run in parallel with one budget lookup. The existing caller-scoped RPC retains a former collaborator's own expenses after vehicle access is revoked; a client-side join would silently lose these rows under RLS. There are no new migrations or database writes.

The panel refreshes on focus, retry and Budget refresh/save. Stale requests are discarded on blur, account changes and period changes. Backend errors are replaced with a friendly unavailable state and a retry action.

## Verification

`node --test tests/*.test.cjs` includes business-rule, service and component coverage in `tests/fuelInsights.test.cjs`. Browser fixture checks cover Home-to-history navigation, selecting a past month, populated/empty/unavailable history, retry, and phone/desktop layouts. Fixture requests never reach the real backend.
