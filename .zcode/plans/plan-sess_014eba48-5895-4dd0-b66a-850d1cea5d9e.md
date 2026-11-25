## Implementation plan

1. **Fix the stale Expo bundle error at its real source**
   - Update `mobile/app/+html.tsx` so a failed `<script>` event whose `target.src` is a hashed `/_expo/static/js/web/*.js` file triggers the existing one-time cache-busting reload—even when the event does not include the words “Loading module.”
   - Keep the existing 60-second loop protection and promise-error handling.
   - Do not change Vercel’s SPA rewrite or cache unrelated application errors.

2. **Change fuel types to compact chips**
   - Update `mobile/components/prices/FuelTypeFilter.tsx` to keep one-tap chips for **RON 91, RON 95, and Diesel**.
   - Replace the misleading fourth peer-style box with an explicit compact overflow chip such as **“More · Kerosene ˅”** when an uncommon fuel is selected.
   - Remove the selection-dependent 2×2 layout jump and use compact auto-width wrapping chips on phone, tablet, and web.
   - Keep all seven canonical fuels, current selection state, data queries, defaults, and the existing More sheet unchanged.
   - Correct accessibility grouping: the three direct fuels remain a radio group; the More control is a separate button; the sheet options form their own radio group.

3. **Update focused tests**
   - Add the exact production failure case: a resource error with only the missing Expo script URL.
   - Keep tests for promise failures, non-Expo errors, cache-busting, and reload-loop prevention.
   - Update fuel-filter tests for compact wrapping, stable layout across common/uncommon selections, minimum 44px targets, clear overflow labeling, all seven fuels, selection behavior, and accessibility roles.
   - Keep existing price-query/default tests unchanged to prove this is presentation-only.

4. **Verify before handoff**
   - Run the focused stale-bundle and fuel-filter tests, relevant Prices tests, TypeScript checking, and the exact Vercel command: `npm run build:web --prefix mobile`.
   - Open an isolated local preview and visually verify desktop and compact widths.
   - Confirm generated HTML contains the recovery script before Expo bundles.

I’ll use the compact-chip option because it preserves one-tap access to the three common fuels while making the overflow behavior clear. I will not commit or push unless you explicitly ask.