# Station expansion inspection — 11 November 2026

This document records the initial inspection. The subsequent multi-brand collection and authorized import are recorded in [OTHER_BRANDS.md](OTHER_BRANDS.md) and [IMPORT_RESULTS.md](IMPORT_RESULTS.md).

## Live public inventory

Read-only pagination of the application's configured Supabase project returned **852** public station records:

| Brand | Records |
|---|---:|
| SEAOIL | 821 |
| Petron | 11 |
| Shell | 8 |
| Caltex | 6 |
| Unioil | 2 |
| Phoenix | 2 |
| PTT | 1 |
| Flying V | 1 |

817 records are official SEAOIL directory entries; 35 have the community source type. Only those 35 have both coordinates and a stored region. Thus an official branch count does not establish nearby-map coverage or region-filter compatibility. The old October preview documentation is historical: the 817 eligible SEAOIL records **are now present** in the live public inventory.

## Sources actually fetched

| Official source | Station records fetched | New candidates after screening | Records held for review |
|---|---:|---:|---:|
| [Caltex locator](https://www.caltex.com/ph/find-us.html) | 597 | 584 | 13 |
| [Petron participating-station PDF](https://www.petron.com/wp-content/uploads/2026/04/PFC-SS-Merged.pdf) | 1,143 | 1,136 | 7 |
| Total | 1,740 | 1,720 | 20 |

Caltex's locator HTML explicitly publishes the endpoint `/bin/services/getStations.json?pagePath=/ph/find-us&siteType=b2c`. Its 730 records include 597 stations, 124 workshops and 9 distributors. Only Philippine station records enter this preview. All 597 station records publish coordinates and a street address; repeated coordinates still require review. Products retain the official names and exclude lubricants/additives. No map key or Places API was used.

Petron's [PFC page](https://www.petron.com/pfc-online-service-station-list/) links the 36-page PDF. This is a participating network subset, **not a complete national Petron inventory**. Table extraction retained all numbered rows, including one whose address was not extracted. Fleet section headings are preserved as source metadata, never assigned to DOE region IDs: the PDF's NCR section includes Bulacan addresses. Row numbers restart by section and must not become stable station IDs. Candidate identities use normalized name/address hashes. No coordinates or fuel availability are invented.

Fresh SEAOIL traversal returned 827 source identities over 21 pages again. The ten records in five ambiguous name/address pairs remain held under the existing review registry. Five sampled detail pages validated; this is not a new enrichment/import of all 817 eligible branches.

## Screening and limits

The new preview retains every candidate and flags repeated source identities/site IDs, shared addresses, shared coordinates, missing addresses and possible matches against existing same-brand station records. Existing matches use source keys, normalized exact addresses or coordinates within 75 meters. No match is automatically merged, deleted or overwritten. Different spellings and incomplete addresses can still hide duplicates; 1,720 is a candidate count, not a guarantee of distinct physical branches.

The 20 held records include two Caltex source records sharing a published site ID, shared Caltex addresses/coordinates, six Petron records sharing three addresses, and the Petron row missing its address. Reasons overlap. All review evidence remains in the JSON/CSV preview.

## Artifacts and rerun

Ignored local artifacts live in `etl/data/stations/expansion-2026-11-11/`:

- `caltex-source.json`, `petron-source.pdf`: downloaded company sources.
- `existing-stations.json`: public station snapshot used for matching.
- `preview.json`, `preview.csv`: normalized candidates, review reasons, matching existing IDs and source hashes.

SEAOIL evidence: `etl/data/stations/seaoil-2026-11-11-preview.json` and its HTML snapshots.

From `etl/`, after downloading the source files:

```sh
../.venv/bin/python -m stations.expansion \
  --caltex-json data/stations/expansion-2026-11-11/caltex-source.json \
  --petron-pdf data/stations/expansion-2026-11-11/petron-source.pdf \
  --existing-json data/stations/expansion-2026-11-11/existing-stations.json \
  --output data/stations/expansion-2026-11-11/preview.json
```

The expansion command reads local source files and exports a preview only. It has no database credentials or write path. This inspection made **zero database writes**.

## Integration work identified

1. Review the held records and candidate matching; import by company-scoped stable identities while retaining existing UUIDs/reports.
2. Generalize `fetchSeaoilDirectory` and `OfficialStationDirectory` to support Caltex/Petron. `StationPriceTable` currently provides the real directory only for SEAOIL; other companies show a directory placeholder.
3. Use reviewed locality mappings for region selection. Never treat missing coordinates as zero, or Petron fleet headings as authoritative DOE geography.
4. Paginate `fetchFuelStationsByRegion`; its current unbounded single request can hit the server's row limit as the inventory grows. Company-report and SEAOIL directory reads already paginate.
5. Investigate the current official Shell locator next, followed by independent brands. Keep branch locations, weekly DOE estimates and verified station-specific prices as separate facts.

Validation: parser and audit regression tests in `test_station_expansion.py`, alongside existing SEAOIL directory/review tests. These cover source drift, excluded business types, invalid coordinates, missing street addresses, stable identities, duplicate review, existing nearby records and company scoping.
