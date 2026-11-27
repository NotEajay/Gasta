# Multi-brand station import — 11 November 2026

**Follow-up:** [12 November expansion and verification](COMPLETION_2026_11.md) brought the live directory to 4,824 stations across all 12 named catalog brands. The counts below describe the earlier import.

**Completed in the app's verified Supabase project.** Imported 3,380 screened official station records. Total station records increased from **852 to 4,232**. The original 852 station UUIDs and their identity/location metadata were preserved. No fuel prices, community reports, confirmations, trips or budgets were written by the import.

| Brand | Added | Official directory records now |
|---|---:|---:|
| Caltex | 584 | 584 |
| PTT | 154 | 154 |
| Petron | 1,136 | 1,136 |
| Shell | 1,108 | 1,108 |
| Cleanfuel | 82 | 82 |
| Phoenix | 180 | 180 |
| Jetti | 136 | 136 |
| SEAOIL | 0 | 817 |
| Total | **3,380** | **4,197** |

The database also retains its 35 existing community-source station records. A repeat-import preview reported **0 new records, 3,380 already present and 59 held for review**.

## Geography and retained limits

- 819 imported records contain usable source coordinates; **854 total** stations now have coordinates.
- 2,478 imported addresses map unambiguously to a DOE macro-region under the app's shared conservative address rules; **2,513 total** stations now have stored region IDs.
- 902 new addresses remain without a confirmed region mapping. They can be searched through **All locations** in their brand directory. Unknown coordinates/regions remain null.
- Source city/province/product metadata is retained only where published and usable. Fleet document sections are not used as DOE region mappings. No geocoding, guessed fuel grades or branch pump prices were introduced.
- The 59 held records remain excluded. Their duplicate/identity/address/coordinate issues were not silently resolved by choosing one source record.
- Phoenix coverage remains Visayas/Mindanao; the Jetti source is a dated October 2025 participating-station list. Collected source records are not certifications that every location is currently operating.

## Station identity migration

Applied only [`20261111000001_multi_brand_station_identity.sql`](../../supabase/migrations/20261111000001_multi_brand_station_identity.sql), rather than pushing unrelated migration files.

The old global `(name, region_id)` uniqueness rule prevented distinct official branches with the same business name. Community stations retain their name/region uniqueness through a partial unique index. Official stations retain company-scoped `directory_key` and source-ID uniqueness.

The existing security-definer `create_fuel_station` RPC now looks up **community records only**. A manually entered name can no longer select and relabel an official station. Its arguments, authentication check, community behavior and grants are preserved. Existing restrictive official-write policies remain intact.

The change was tested first in an isolated PostgreSQL database using the original schema, original community RPC and official-directory migration. Assertions verified distinct official same-name branches, stable community identity, duplicate community rejection, and authenticated official insert/update denial. The same index/constraint/function guards were independently checked after deployment.

## Import behavior and evidence

`stations.import_directory` verifies source-file hashes, the exact preview hash and the shared geography-rules hash, then rereads all live station identities before planning. Only records without review reasons enter payloads. Existing source identities are skipped. Inserts use `ON CONFLICT (oil_company_id, directory_key) DO NOTHING`; existing UUIDs and later metadata are never replaced.

The first five Caltex and five PTT rows were inserted and reread before full batches of at most 100. After all 3,380 inserts, every original station's identity/location fields were compared against its before snapshot. The app's anonymous public API independently returned the same 4,232-station total.

Ignored local evidence lives in `etl/data/stations/import-2026-11-11/`:

- `preflight/`: initial live snapshot and write-free plan.
- `applied/`: before/after snapshots, exact payload/review plan, inserted UUID journal and final verification.
- `recheck/`: repeat-import preview proving zero new records.
- `live-verification.json`: independent database totals and deployed guards.

The shared address mapping is in `etl/data/stations/brands-2026-11-11/region-mapping.json`. Generate it before import with:

```sh
node etl/stations/map_regions.cjs \
  etl/data/stations/brands-2026-11-11/combined-preview.json \
  etl/data/stations/brands-2026-11-11/region-mapping.json
```

From `etl/`, the importer defaults to preview. `--write` is required for insertion:

```sh
../.venv/bin/python -m stations.import_directory \
  --preview data/stations/brands-2026-11-11/combined-preview.json \
  --mapping data/stations/brands-2026-11-11/region-mapping.json \
  --output-dir data/stations/import-2026-11-11/recheck
```

Use a new output directory for each import attempt to retain the earlier journals. Credentials are read from the existing ETL environment and must target the same project as the mobile app.

## App integration

- All company cards now support the generic official directory, with brand-specific search and count, stable multi-page reads and independent expiring request caches.
- Selected-area filtering retains conservative geography matches. All locations exposes the rest without assigning a false region.
- Loading state and late-response cancellation prevent one brand's results appearing in another directory.
- Regional station reads paginate in stable name/ID order. A later failed page rejects rather than silently returning a partial directory; legacy optional `brand_label` fallback remains supported.
- Existing report selectors retain the chosen physical station UUID. Station directory metadata remains separate from report prices.
- Price headlines/ranges use one DOE company/area estimate per source plus fresh verified community observations. Importing many branches does not multiply an area estimate into hundreds of distinct branch quotes or promote unverified reports.

Validation: **182 mobile regression tests**, **66 ETL tests**, isolated PostgreSQL assertions, and iOS/Android Expo exports passed. Browser checks using imported station snapshots verified all eight directory brands, name/address search, third-page pagination for Shell/Petron, independent price comparison counts and PTT station selection into the report form. All external browser requests were intercepted; no test report was submitted to the live backend.

The same three pre-existing mobile TypeScript issues remain in Profile, admin ETL and AuthProvider; no new TypeScript errors were introduced.
