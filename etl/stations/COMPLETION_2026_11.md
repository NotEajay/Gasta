# Station directory expansion — 12 November 2026

This follows the [11 November import](IMPORT_RESULTS.md). **Final live result: 4,824 stations, 592 added in this pass, 4,789 official-directory records across 12 named brands, and 35 unchanged community records.** Public read verification confirms all 4,232 original records are completely unchanged. There are 1,073 coordinate pairs and 2,995 stored region mappings.

The directory is an inventory of published branch locations, not a certification of every currently operating Philippine station. DOE participating-station registers are explicitly identified in the app; their prices are not imported.

## First import: 442 additions

The live directory increased from **4,232 to 4,674 stations**, including **4,639 official-directory records** and the unchanged 35 community records.

| Brand | Added | Official-directory total after first import |
|---|---:|---:|
| Phoenix | 184 | 364 |
| Flying V | 113 | 113 |
| My Gas | 51 | 51 |
| Unioil | 36 | 36 |
| Total | 25 | 25 |
| Shell | 16 | 1,124 |
| PTT | 11 | 165 |
| Caltex | 6 | 590 |

Petron (1,136), SEAOIL (817), Jetti (136), and Clean Fuel (82) retained their existing official records. All 12 named brands in the price catalog now have an official-source station directory. The catalog's generic Independent category is not a single brand and has no imported official directory.

Sources:

- [DOE's 14 September 2026 fuel subsidy register](https://doe.gov.ph/fuel-subsidy-program-participating-stations-as-of-14-september-2026): all 138 PDF pages and **2,754 consecutive numbered rows** validated. Only explicitly mapped Unioil, Flying V/TWA, and Total publishers were selected; other publishers were counted and excluded. These are subsidy participants, not full brand censuses. Row numbers are evidence, never stable source IDs.
- [MyGas's official directory](https://www.mygaspetroleum.com/stations.html): 53 branches with published Google Maps coordinate links. Two Mati entries share an address and remain held; 51 imported. No Maps API, geocoding, or guessed coordinates.
- [Phoenix's company-managed Luzon participant list](https://sites.google.com/phoenixfuels.ph/sharelimitlesswarmth/participating-phoenix-stations): 185 name/address pairs; Phoenix Timog overlaps an existing community record and is held. 184 added alongside existing Visayas/Mindanao coverage.
- Shell's individual official Philippine station pages: all 16 previously held branches are active and publish fuel products and coordinates. Four are mixed fuel/EV sites, not pure EV locations. Published coordinates distinguish the other same-address branch pairs.
- Caltex's previously captured official locator: six branches have independent source IDs and separated published pins despite short shared addresses. Repeated business/site IDs and shared pins remain held. The shared-address exception applies only to Caltex/Shell, requires every branch to have a source ID and valid coordinates, and requires every pair to be more than 75 metres apart.
- PTT's previously captured official locator: 11 otherwise valid branch addresses imported with **null GPS**, because their published coordinate pairs are invalid. Coordinates were neither swapped nor replaced. Four copied/conflicting address records remain held.

The first import added 73 coordinate pairs and 343 conservative region mappings. Totals after it were 927 coordinate pairs and 2,856 stored region IDs. Unknown locations remain searchable through All locations.

## Review partition

Of the previous 59 multi-brand holds, 33 were resolved and imported; 26 remain held. Four new records were held (two MyGas shared addresses, Phoenix Timog, Flying V Bagumbong's possible existing community match), for **30 unresolved records** in this pass. The ten earlier SEAOIL ambiguous records remain separately quarantined.

Cleanfuel E. Rodriguez was checked again on its official detail page: its structured address still contradictorily says Philadelphia, Pennsylvania, United States, alongside a Quezon City street and Philippine coordinates. It remains held. Jetti Hinigaran still has a city-only address. No ambiguous pair was resolved by arbitrarily choosing a record.

## Unioil follow-up: 150 further additions

The [official Unioil locator](https://www.unioil.com/stations) requires JavaScript. It loaded in an ordinary browser session; no login, CAPTCHA interaction, cookie export, private API, or manual challenge decoding was used. Its published `custom.js` declares the public city-list and station-detail GET requests used by the interface.

Collected all **83 city selections from the working areas**, reconciled **186 unique branch IDs**, and read each corresponding branch detail. City lists, counts, IDs, alphanumeric branch codes, names, addresses, and map metadata are checked against the cached responses. The Central Luzon selector (area 5) returns publisher PHP errors and remains an explicit coverage issue. The North Luzon selector includes some Central Luzon provinces; this does not prove that the failed area is redundant.

An explicit [source crosswalk](review/unioil_doe_2026.json) identifies 35 locator branches already represented by the DOE import. These were excluded from insertion; existing operator names, addresses, UUIDs, reports, and other metadata were retained. Both source and existing-record fingerprints must match before the crosswalk applies. Commonwealth/Pearl Drive remains an uncertain source overlap and is held.

Two branches—NAIA Road, Parañaque and Quezon Avenue, Quezon City—publish the same map pin despite separate IDs and different published city/address identities. Their [coordinate review](review/unioil_coordinates_2026.json) explicitly omits GPS for both and retains their address-only identities. The decision is bound to the exact source identity and coordinate pair. No replacement pin was inferred or selected. Two other invalid/missing source coordinate pairs are also omitted.

The follow-up inserted **150 new Unioil stations**, adding 146 coordinate pairs and 139 region mappings. Unioil now has **186 official-directory records**, plus its two pre-existing community records. The numerical equality between the official count and locator count is coincidental: 35 locator records are represented through DOE identities, one locator overlap remains held, and its possible DOE counterpart remains in the database.

The final review partition is 30 unresolved records from the first pass, **one additional unresolved Unioil overlap**, and the ten separately quarantined SEAOIL records. The 35 confirmed Unioil source aliases are exclusions for already represented stations, not unresolved branches. The Unioil importer's `held_for_review: 36` combines those 35 exclusions with the one unresolved overlap.

All original import evidence is retained. `unioil-applied/` records the initial 148 additions; `unioil-address-only-applied/` records the two reviewed address-only additions. `unioil-final-recheck/` proves **zero new records, 150 already present, and 36 excluded/held source records**. `public-final-verification.json` independently verifies the public live inventory and preservation of every field of every original station.

The reusable optional browser collector is `stations/collect_unioil.cjs`. It uses an independently installed Playwright package, an ephemeral browser, bounded response sizes/timeouts, saved-response caching, a delay after uncached requests, and at most two detail requests in flight. It validates the published script contract and writes a final collection manifest only after traversing the available city/branch responses. Publisher errors are recorded; partial source coverage is never certified complete. A separate copied-cache run reproduced all 186 branches and the same publisher error without changing import evidence.

From `etl/`, normalize the retained collection and reviewed identities with:

```sh
../.venv/bin/python -m stations.unioil \
  --source-dir data/stations/completion-2026-11-12/unioil \
  --existing-json data/stations/completion-2026-11-12/existing-after-expansion.json \
  --crosswalk stations/review/unioil_doe_2026.json \
  --coordinate-review stations/review/unioil_coordinates_2026.json \
  --output data/stations/completion-2026-11-12/unioil-final-preview.json
```

Map regions and preview/import with the same shared commands below, substituting the Unioil preview/map filenames and a fresh output directory. Preserve previous source snapshots and output journals when collecting a future version; source changes require crosswalk/coordinate decisions to be reviewed again.

## Reproduce and verify

Ignored local source evidence, previews, and write journals are under `etl/data/stations/completion-2026-11-12/`. The first import's `applied/` folder records before/after snapshots, exact inserted UUIDs, and preservation verification. `recheck/` reports **zero new records, 442 already present, and 30 held**. Previous journals were retained.

From `etl/`:

```sh
../.venv/bin/python -m stations.completion \
  --source-dir data/stations/completion-2026-11-12 \
  --existing-json data/stations/completion-2026-11-12/existing-stations.json \
  --prior-preview data/stations/brands-2026-11-11/combined-preview.json \
  --output data/stations/completion-2026-11-12/preview.json

node stations/map_regions.cjs \
  data/stations/completion-2026-11-12/preview.json \
  data/stations/completion-2026-11-12/region-mapping.json

../.venv/bin/python -m stations.import_directory \
  --preview data/stations/completion-2026-11-12/preview.json \
  --mapping data/stations/completion-2026-11-12/region-mapping.json \
  --output-dir data/stations/completion-2026-11-12/NEW-RECHECK-DIRECTORY
```

The importer defaults to preview. Source file hashes, preview/map hashes, source URL allowlists, identity keys, and a fresh live duplicate audit are checked before any insert. Writes use company-scoped conflict keys with DO NOTHING, preserving every existing UUID and all existing metadata. No prices, reports, confirmations, budgets, or trips are written.

Mobile checks: **182 tests pass**. Browser checks using the imported snapshot passed all 12 directory counts and searches, multi-page reads, independent price comparison counts, and selecting a real station UUID for a report. All external browser requests were mocked, with report writes blocked.

Station ETL checks: **87 tests pass**, covering the existing parsers/importer and the new source schemas, complete DOE row sequence, source URL restrictions, branch identity validation, source-bound coordinate omissions, community collisions, and crosswalk changes. JavaScript collector syntax and cached traversal pass. `git diff --check` is clean.

## Remaining source limits

- Flying V's public website advertises a larger network but does not provide a complete branch inventory through its inspected public pages or WordPress page list. The dated 2020 DOE tariff list is not treated as evidence of current operation.
- Petron's participating PFC list is a subset of its network. Its published WP Store Locator request works for nearby results, but the attempted national-radius request returned zero; that is not interpreted as complete coverage or permission to generate duplicate records under another source key.
- Phoenix's added Luzon list covers participants; the older Visayas/Mindanao operational list is not a live operating-status feed.
- Jetti's website remains under maintenance; its directory is based on the explicitly dated October 2025 DOE list.
- Records with unresolved identities, copied addresses, conflicting country metadata, or insufficient location evidence stay outside the live directory.

Full nationwide completion requires maintained brand inventories or resolution of these publisher gaps. Advertised network sizes and historical participation lists are not silently presented as complete, current inventories.
