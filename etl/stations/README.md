# Official fuel station directory ETL

This job stores **branch locations**, independently of DOE price ingestion. It never reads/writes `fuel_prices`, attaches an area price to a branch, geocodes, or calls the DOE pipeline. No scheduled sync or full import is enabled yet. Complete listing audit results are in [FULL_PREVIEW.md](FULL_PREVIEW.md); the complete dataset contains five unresolved pairs. [PAIR_REVIEW.md](PAIR_REVIEW.md) documents the 817 eligible / 10 quarantined partition and evidence; no live import has run.

## Source investigation (2026-10-09)

| Company | Observed mechanism | Endpoint / authentication | ETL assessment |
|---|---|---|---|
| SEAOIL | Webflow CMS HTML. Locator cards have name, address, hours, and a `/stations/<slug>` link. Finsweet `cmsload` follows ordinary `w-pagination-next` links; `cmsnest` loads products from detail HTML. No station JSON/API discovered in the published locator. | `https://www.seaoil.com.ph/station-locations`, observed pagination `?1a2d56f2_page=2`, and individual `/stations/<slug>` pages. No login/key needed. | Implemented HTML ingestion. Paginated, bounded, rate-limited; selectors/identity/product validation fail closed on unexpected changes. No browser. |
| Shell | Official site JavaScript loads a public AEM page model, then a station-locator web component embeds Geome. Geome uses a JavaScript app and public locale configuration. | Public model: `https://www.shell.com.ph/shell-mobility-station/shell-station-locator.model.json`; locator `https://shellretaillocator.geoapp.me/?locale=en_PH`; public config `/config/published/shellretaillocator3/prod/en_PH.json?cacheBust=1234`. Bundle declares `/api/v2`, locations resources and `within_bounds`, `nearest_to`, `show`, `complete`, `along_corridor` views. Exact request contract/bulk export not verified. | Potential structured source, **not yet supported**. Undocumented API; no bulk extraction, private tokens, or browser Maps key reuse attempted. Confirm permitted API/feed access with Shell/Geome before implementing. |
| Phoenix | WordPress page contains literal `[wpsl]`, plus historical WP Store Locator styling. Downloaded HTML has no rendered locator/list, coordinates, or locator script/config. Generic WordPress AJAX references belong to cookies/social sharing, not verified station endpoints. | `https://www.phoenixfuels.ph/find-a-gas-station/`. No working station endpoint or auth requirement established. | **Unsupported currently**: published locator markup is incomplete. No guessed plugin API requests or bypass. Seek a maintained official CSV/feed, keep public locator link, or later use an explicitly authorized Places API fallback. |

Official sources:
- https://www.seaoil.com.ph/station-locations
- https://www.shell.com.ph/shell-mobility-station/shell-station-locator.html
- https://www.phoenixfuels.ph/find-a-gas-station/

Current DOE parser scope (`etl/src/constants.py`): Petron, Shell, Caltex, Phoenix, Total, Flying V, Unioil, Seaoil, PTT, Jetti, Clean Fuel, My Gas. All three investigated brands are in scope. The station loader only resolves the existing `seaoil` company; it never creates brands.

## Run a preview

From the repository root, using the project's Python environment:

```bash
.venv/bin/pip install -r etl/requirements.txt -r etl/requirements-stations.txt
cd etl
../.venv/bin/python -m stations.sync --limit 5
```

Default is five **enriched** records and **no database write**. The first listing page is parsed completely, but only five detail pages are fetched. Output reports both counts and whether traversal finished. Source requests check robots directives, are sequential, use a 30-second timeout and a 4 MB limit, and wait at least 500 ms between requests. HTTP failures stop collection; no anti-bot bypass or automatic headless fallback.

After reviewing parser quality, applying the migration, and explicitly deciding to import a sample:

```bash
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY via environment or etl/.env
../.venv/bin/python -m stations.sync --limit 5 --write
```

Full directory traversal is opt-in with `--limit 0`; the page cap defaults to 100. Collection/enrichment must complete before any upsert is attempted, so a failed detail page/pagination loop cannot silently import a partial batch. The full import has **not** been run. Use a sample first, inspect its persisted rows, and only then enable full ingestion/scheduling.

## Sample observed

Read-only live preview: **40 listing rows parsed, 5 detail pages enriched, 1 listing page visited**, no writes. Second-page inspection independently confirmed additional paginated HTML. Locator advertises “1001 Stations”; this is a site label, **not a verified ETL total**. This was the initial five-row preview; the subsequent full audit verified 827 source identities across 21 pages, documented in FULL_PREVIEW.md.

| Station | Published address | Fuel products |
|---|---|---|
| 1ST CRUMB ZONE 1 - DIGOS CITY | 1ST CRUMB STREET, BARANGAY ZONE 1, DIGOS CITY, DAVAO DEL SUR | Extreme 95; Extreme Diesel |
| 55 C VIRA LAOAG - ILOCOS NORTE | RODOLFO G. FARINAS BYPASS ROAD, BRGY. NO. 55-C VIRA, LAOAG CITY, ILOCOS NORTE | Extreme 95; Extreme Diesel |
| A. BONIFACIO AVE - CAINTA | NO. 54 A. BONIFACIO AVENUE, BRGY. STO. DOMINGO, CAINTA, RIZAL | Extreme 91; Extreme 97; Extreme Diesel |
| A BONI - QC | A. BONIFACIO AVE. COR. SCT. ALCARAZ ST. QUEZON CITY | Extreme 91; Extreme 97; Extreme Diesel |
| ABUCAY TACLOBAN - LEYTE | CONGRESSIONAL MATE AVENUE, BRGY. ABUCAY, TACLOBAN CITY, LEYTE | Extreme 91; Extreme 95; Extreme Diesel |

All five list “Open 24 hours”. Products come from each corresponding detail page, not a global fuel menu. Lubricants/LubeServ are excluded. The sample did not expose coordinates, explicit operating status, or separately structured city/province/region fields. These remain null; the address preserves the published locality. No address token is guessed into an administrative field. Unknown product labels fail validation rather than becoming invented DOE fuel codes.

Station source IDs are published **Webflow slugs**, not assumed internal numeric IDs. Slugs and per-branch source URLs are stored. A source slug could change if SEAOIL renames its URL: review such changes for reconciliation; a stable internal ID was not exposed. No station is automatically deleted because a later source omits it, and manually seeded/community stations are not heuristically merged based on similar names.

## Schema and identity

Apply `supabase/migrations/20261009000002_official_station_directory.sql` separately. **Not applied to live Supabase in this task.**

Extends existing `fuel_stations`, retaining UUID `id`, `name`, company FK, address, timestamps, reports, and existing ownership policies. Added metadata:

- `source_type` (existing/default records: `community`; ingested: `official_directory`)
- `source_url`, `source_station_id`, `directory_key`
- `city`, `province`, `directory_region` (company-published text, distinct from DOE `region_id`)
- `fuel_types` JSON array of official product names, `operating_hours`, `last_synced_at`

Official rows permit null coordinates/DOE region. Community rows still require their original location fields. Coordinate pair/range constraints apply only to official records, preserving legacy manual coordinate values; product array constraints apply to the new nullable metadata. Source URL/key/sync timestamp are required for official records. Existing updated_at trigger remains in place.

`UNIQUE(oil_company_id, directory_key)` drives atomic upsert. Key is `source:<slug>` for SEAOIL; helper supports `address:<SHA-256(normalized name + address)>` when a future source has no IDs, requiring a real address. A second unique source-ID index guards against mismatched keys. Re-sync updates metadata/time without adding duplicates. Missing coordinates are omitted from upsert so later explicitly approved geocoding is preserved. Defaults keep new coordinates null. No automatic region mapping, merging, deletion, or deactivation.

Only service_role writes official records. Restrictive authenticated policies protect official provenance and prevent community callers converting their records to official; existing authenticated community insertion/update remains available.

## Later UI integration (no UI edits here)

- Station search/company lists can query `fuel_stations` with `source_type = official_directory`, join `oil_companies`, and show address/source/sync time even without coordinates.
- Nearby/map browsing must exclude null coordinate pairs; never coerce null to zero or plot city-centre substitutes. Geocoding would be a separate approved/costed job.
- Current community station options are filtered by `region_id`; unmapped directory rows therefore do not automatically enter that workflow. Station selection for reports needs explicit administrative mapping to GasTa's regions first; preserve the existing report creation contract.
- Regenerate/review mobile database types before consuming nullable directory region metadata in a new UI. No mobile query/types/UI changes in this phase.
- Keep provenance labels distinct: **Station location: official company directory**, **DOE price: Area estimate**, **Community price: station-specific report**. Do not join company/area estimates into a field presented as branch pump price.

## Validation

```bash
.venv/bin/python -m pytest -q etl/tests/test_station_directory.py
.venv/bin/python -m compileall -q etl/stations
 git diff --check
```

Tests cover the observed selectors/products, normalization, missing addresses/coordinates, malformed/layout-changed HTML, detail identity, unknown products, host restrictions, sample bounds, pagination/loops, duplicate/conflict detection, repeated loader upserts, and no price writes. The migration was separately applied/tested on a fresh isolated local PostgreSQL database for uniqueness, NULL location handling, original community rows, coordinate/product constraints, and RLS insert/update/conversion restrictions. Live ingestion/database deployment remain pending. The preview-only audit command below has no database-write interface.

```bash
cd etl
../.venv/bin/python -m stations.audit --sample-size 30
```

It traverses every listing page first and reports URL/address coverage before fetching a bounded geographic sample. Raw duplicate/conflicting/malformed records are retained in `etl/data/stations/seaoil-full-preview.json` (ignored local artifact), with source HTML and page hashes. Normalized name/address matches are warnings. Explicit review decisions quarantine unresolved source IDs while allowing the safe subset; approved distinct identities can coexist. The loader prints excluded records/reasons before database access. The ten pending records are preserved in `review/seaoil_ambiguous.json`; new unreviewed pairs are also quarantined.
