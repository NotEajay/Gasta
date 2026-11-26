# GasTa UI direction

The redesign uses ink navy, muted cobalt and soft citron with a cool off-white canvas. It is implemented on UI-FIX using Expo 58 (upgraded to match the iPhone Expo Go app) and the existing routes.

| Role | Color |
| --- | --- |
| Ink navy: headings, hero cards, primary logo | `#192D42` |
| Cobalt: primary actions, links and focus | `#3E5FB5` |
| Soft citron: selected navigation and featured actions | `#DCE9B5` |
| Canvas | `#F5F6F7` |
| Surface | `#FFFFFF` |
| Supporting text | `#617083` |

## Replacement logo

Create a simple GasTa wordmark and a separate compact mark. Use midnight on light surfaces, white on midnight, and an optional lime accent. Keep the mark legible at 24–32 pixels; avoid fine detail and baked-in backgrounds. Deliver transparent PNGs and SVG masters, with little empty padding around the artwork.

The dashboard header uses the transparent `assets/images/gasta-wordmark.png` through `components/ui/BrandWordmark.tsx`, with its original midnight, cobalt and lime colors. The desktop rail displays the symbol region from the same artwork. The auth screen, native app icon and splash assets are unchanged. Fuel company logos keep their original colors.

## Scope and verification

Shared color tokens, cards, fields, selectors, buttons, tab styling and headers now follow one visual system. Home includes existing-route quick actions. Budget retains its picker/editor controls, Trips retains New/Saved/History, and all six main tabs remain accessible.

Backend services, database schema, route parameters, calculations, report verification and data-writing handlers retain their existing behavior. Browser screenshots use local fixtures when authenticated data is needed; fixture data is never added to the production app.

Run `node --test tests/*.test.cjs` from `mobile/` for regression coverage. The responsive hook mock in the existing test harness was updated so the existing screen tests run. `tests/uiInteractions.test.cjs` covers the redesigned controls' editing, focus, selection, validation and disabled behavior.

Validation: all 171 Node regression tests pass, and iOS/Android exports succeed with Expo 58 after the compatibility upgrade. Phone (390px), small-phone (320px), and desktop (1440px) layouts were inspected with isolated fixtures. Browser fixtures do not verify live Supabase writes or native device behavior.

The repository still has three pre-existing TypeScript errors: the generated database types lack `profiles.role` and `doe_pending_downloads`, and AuthProvider compares an auth event with `TOKEN_REFRESH_FAILED`, which the installed Supabase type does not include. These backend/auth issues are outside the UI redesign.

SDK 58 migration: native dependencies and the lockfile now match Expo Go 58 on iPhone. Router initial routes use layout anchors, tab activity preserves screen state, and custom root HTML includes the generated asset nodes required by Router 58. All 171 tests and the browser navigation checks pass. Expo Doctor passes 19/20 checks; its remaining warning is the pre-existing local EAS CLI development dependency.

## Fuel-first Home

Home leads with a navy fuel price feature showing its actual source, region, fuel reference, bulletin date and fallback qualifiers. The lime comparison action opens Prices. Plan a trip and Log refill retain their existing routes. A smaller spending summary, one historical insight, the vehicle preview and recent activity follow. Desktop places spending and insights beside the price feature. Full comparisons remain on Prices; complete historical explanations remain in Budget. No calculation or write path changes.

Palette refinement: quieter neutral surfaces and slate-blue insight fills reduce the amount of saturated blue. Citron is reserved for featured actions and selected navigation. The supplied logo keeps its original artwork and colors. Layout, typography and behavior are unchanged.

## Fuel Prices page

Prices uses the same full-width phone gutter as Home, with a single grouped mode/filter panel, a navy lowest-listed-price feature and a quieter range summary. Fuel shortcuts lead with RON 91, RON 95 and Diesel; More holds RON 97, RON 100, Diesel Plus and Kerosene and displays the selected additional fuel. Region and Area share a compact row. Weekly mode puts company estimates and community reports before the trend; Past prices puts history before those lists. Empty trusted-price results have an explicit state. Existing fetching, source precedence, confirmations, company disclosure, report routes and history selection remain unchanged. Browser fixtures verify area/fuel query parameters, mode order, community navigation and empty results at 320px, 390px and 1440px.

## Imported multi-brand station directories

The live database now has 4,232 stations after the screened multi-brand import. Company cards share one paginated official-directory flow, with a selected-area view and an All locations option for unmapped addresses. Search and reporting retain the physical station UUID. Price comparisons count source facts independently of directory size: one DOE company/area estimate plus verified community observations, without promoting pending reports. See `../etl/stations/IMPORT_RESULTS.md` for import counts, schema guards and validation.

## Fuel type colors

Fuel Prices uses one shared presentation map in `constants/fuelTypeColors.ts`: RON 91 green, RON 95 blue, RON 97 violet, RON 100 rose, Diesel amber, Diesel Plus burnt orange and Kerosene teal. These are GasTa UI identifiers, independent of company logos, verification status and price movement. Names remain visible, selected buttons use a solid fill, and compact badges keep the same color in summaries, trends and community reports. Unknown fuel codes use a neutral label. All selected-button and badge text pairs exceed 4.5:1 contrast. Common fuels and the More menu retain their original values and query behavior.

Fuel colors also apply to the cards: the lowest-price feature uses the selected fuel’s solid color with white copy; range/trend and DOE company cards use matching soft surfaces and borders. Company and community report cards carry a stronger fuel-colored edge. Community cards use their own report fuel code. Status badges and price-movement cues retain their separate meanings. Company logos, queries, prices and reporting handlers are unchanged.

The shared FuelTypeFilter derives its initial choice from the active/default vehicle and keeps manual changes local to Prices. The shared presentation helper reads the same fuelTypeColors palette for chart lines, badges and cards. Company expansion respects reduced motion on native and web; directory browsing remains available for every brand with Selected area and All locations scopes.
