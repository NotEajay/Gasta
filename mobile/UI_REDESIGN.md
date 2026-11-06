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
