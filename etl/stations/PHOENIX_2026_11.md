# Phoenix station directory — 26 November 2026

Added **38** reviewed stations to the live app database. Phoenix increased from
366 to **404** records: **402 official-directory stations** and the unchanged two
community records. All brands together now total **4,862** stations, including
4,827 official-directory entries and 35 community entries.

Verified every addition through the real mobile `fetchOfficialStationDirectory`
service using the public anonymous client. All 402 official stations are readable.
Every field of every original station record was compared against the saved
before snapshot and preserved. No prices, reports or user records were written.

## Source coverage

Six public company-controlled lists were downloaded again and reconciled:

| Source | Published rows retained |
|---|---:|
| [Operational Visayas/Mindanao list](https://sites.google.com/phoenixfuels.ph/pnxstationvismin/home) | 189 |
| [Luzon participant list](https://sites.google.com/phoenixfuels.ph/sharelimitlesswarmth/participating-phoenix-stations) | 185 |
| [June 2026 fuel-promotion station table](https://www.phoenixfuels.ph/your-freedom-drive-deserves-a-treat/) | 85 |
| [Station locator-partner opportunities](https://www.phoenixfuels.ph/locator-partner/) | 66 unique station identities from 76 lease opportunities |
| [DITO booths at Phoenix](https://sites.google.com/phoenixfuels.ph/ditoboothsatphoenix/home) | 55 |
| [PTC-Grab participating stations](https://sites.google.com/phoenixfuels.ph/ptc-grab-participating-station/home) | 93 |

These 673 source rows overlap. They are not 673 distinct stations. Nine source
variants were excluded through eight fingerprint-bound review decisions, keeping
one reviewed source identity per branch. Repeated lease spaces count once. The
fuel-promotion prose says 82 stations, but its table actually publishes 85 rows;
the table's rows were all retained rather than silently truncated to the prose.

The operational-list parser now handles zero-width prefixes and `Phoenix.` names.
This recovers Soong, Tandag and Catalunan Grande entries that the earlier parser
skipped. Mintal 1 and Mintal 2 are distinguished using the DITO list's more precise
Mintal 2 address. Reviews and exact selected/excluded fingerprints are recorded in
`review/phoenix_2026_11.json`.

Thirteen additions retain publisher-supplied coordinate pairs; 35 have a
conservative DOE macro-region mapping. The remaining three can be found through
**All locations** without assigning an unsupported region. Unknown fuel grades,
operating hours and coordinates remain unknown.

## Limits and held records

The main [Find a Station](https://www.phoenixfuels.ph/find-a-gas-station/) page still
renders an unresolved `[wpsl]` shortcode. Its linked public REST index and map
script do not publish a working station inventory. Therefore this collection
cannot certify the entire currently operating Philippine network.

The [June 2026 grocery promotion](https://www.phoenixfuels.ph/bawat-refill-may-pa-grocery/)
lists LPG cylinder dealers; those were excluded from the motor-fuel station
inventory. Older 2021 promotions were inspected as supporting evidence, not used
alone to certify additional current motor-fuel stations.

233 source variants remain held, mostly possible aliases of existing branches.
This is not a count of 233 missing physical stations. Conflicting addresses,
shared-address ambiguities, unclear branch overlaps and Babag's missing address
were not resolved by inventing a location or creating duplicate stations.

## Reproduce and verify

Evidence and the complete CSV export are in ignored local storage:
`etl/data/stations/phoenix-2026-11-26/`.

From `etl/`:

```sh
../.venv/bin/python -m stations.phoenix \
  --source-dir data/stations/phoenix-2026-11-26 \
  --existing-json data/stations/phoenix-2026-11-26/existing.json \
  --review stations/review/phoenix_2026_11.json \
  --output data/stations/phoenix-2026-11-26/reviewed-preview.json
node stations/map_regions.cjs \
  data/stations/phoenix-2026-11-26/reviewed-preview.json \
  data/stations/phoenix-2026-11-26/region-mapping.json
../.venv/bin/python -m stations.import_directory \
  --preview data/stations/phoenix-2026-11-26/reviewed-preview.json \
  --mapping data/stations/phoenix-2026-11-26/region-mapping.json \
  --output-dir data/stations/phoenix-2026-11-26/new-preview
```

The importer defaults to a write-free preview. Its applied run inserted 38 rows;
its subsequent live preview reports zero additions. Evidence includes the before
and after snapshots, insertion journal, source hashes, import/recheck plans,
`public-verification.json` and `phoenix-stations.csv`.

Validation: **93 station ETL tests passed**, including six Phoenix-specific tests
for source identity, malformed/missing addresses, invisible characters, duplicate
lease records, changed review fingerprints, possible existing aliases and trusted
import sources. The real mobile public service independently verified visibility.
