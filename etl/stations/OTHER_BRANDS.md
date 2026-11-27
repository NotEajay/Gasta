# Additional brand collection — 11 November 2026

**Follow-up:** [12 November expansion](COMPLETION_2026_11.md) adds DOE/MyGas/Phoenix Luzon sources, the public Unioil locator, and explicit resolutions for some earlier held records. The source limits and counts below describe the original collection date.

The fetched, normalized dataset now covers **seven additional brands beyond the existing SEAOIL directory**. The collection phase made no database writes. The subsequent authorized import and app integration are complete; see [IMPORT_RESULTS.md](IMPORT_RESULTS.md).

| Brand | Source rows retained | Candidates after screening | Review required |
|---|---:|---:|---:|
| Shell | 1,124 | 1,108 | 16 |
| PTT | 169 | 154 | 15 |
| Cleanfuel | 83 | 82 | 1 |
| Phoenix | 186 | 180 | 6 |
| Jetti | 137 | 136 | 1 |
| Newly collected | **1,699** | **1,660** | **39** |
| Caltex, previously collected | 597 | 584 | 13 |
| Petron, previously collected | 1,143 | 1,136 | 7 |
| Combined | **3,439** | **3,380** | **59** |

Candidate counts represent records passing the implemented screening rules, not independently verified counts of unique physical stations. The snapshot compared against 852 existing public station records. Name variants, incomplete addresses and location errors can still hide matches.

## Official sources and actual collection

- **Shell:** [Philippine directory](https://find.shell.com/ph/fuel/locations). Traversed **all 475 published city pages**, reconciled each city's count, and saved page hashes/HTML. The directory returned 1,132 entries. Eight explicitly marked destination-charging EV sites were excluded. Four remaining entries have an unfamiliar marker classification and are held for review. Repeated identities must agree before deduplication. City lists do not publish coordinates or product availability, so these remain unknown. Live `open_status` is not persisted as permanent station status or opening hours.
- **PTT:** [Find a Station](https://www.pttphilippines.com/find-a-station). Parsed the published Next.js station payload: 169 operational entries. Official address, province, valid coordinate pairs, operating-hours strings and explicitly advertised PTT fuel products are retained. Eleven invalid coordinate pairs require review; they are never automatically swapped or geocoded. Another record has no coordinate pair. Lubricants do not become fuel products, and product names are not guessed into DOE grades.
- **Cleanfuel:** [Company locator](https://www.cleanfuel.ph/location/). Its public WordPress REST index declares `/geodir/v2/location` and `/geodir/v2/markers`. Fetched all **83** locations (API headers: 83 total, one page), reconciled the marker IDs/count, and retained official branch URLs, street text and coordinates. A source entry marked United States is held for review. The publisher uses a Pasig locality default even for branches elsewhere; that structured locality is intentionally left unknown. Source modification dates are retained; downloading a record today does not mean it was updated today.
- **Phoenix:** [Company-domain operational list for Visayas/Mindanao](https://sites.google.com/phoenixfuels.ph/pnxstationvismin/home). Extracted 186 name/address pairs, preserving the section as source text. One address starts with “Phoenix Station,”; the parser consumes it as an address, preventing a false extra station. This is **Visayas/Mindanao coverage only**, not the entire Phoenix network. The document is undated; no coordinates or fuel availability are inferred.
- **Jetti:** [DOE participating-station list, October 2025](https://prod-cms.doe.gov.ph/documents/d/guest/overall-summary-of-discount_15-october-2025-o-pdf). Extracted and reconciled **all 137 sequential numbered rows across four pages**, preserving published street/barangay/city/province and source page. One record names only its city and is held. This is a participating-station list, not a complete/current operational network certification. Discount columns are not pump prices or evidence of product availability. An earlier downloaded document was actually dated April 2021 and was superseded by this newer source; it contributes no records to the preview.

## Unavailable sources

- **Unioil:** the official bare-domain and www-domain requests did not resolve successfully (HTTP 307 responses). No challenge bypass, mobile-app endpoint guessing, or copied third-party station list was used.
- **Flying V:** inspected the published homepage. A complete structured station inventory was not established. Its advertised network size is not counted as collected stations.
- **Jetti live website:** maintenance page. The dated DOE list is used as the explicitly labeled fallback.

## Files

Ignored local evidence and exports:

- `etl/data/stations/brands-2026-11-11/combined-preview.json`
- `etl/data/stations/brands-2026-11-11/combined-preview.csv`
- `etl/data/stations/brands-2026-11-11/shell-cities/` — all 475 source pages.
- `etl/data/stations/brands-2026-11-11/shell-collected.json` — reconciled city records.
- Other source HTML/JSON/PDF files alongside them.

The preview includes every retained record, review reasons, possible existing station IDs and source hashes. Review entries are never silently merged, deleted or chosen as canonical.

## Reproduce

From `etl/`, Shell collection can resume from cached pages. Requests verify robots directives, enforce the official Philippine URL scope, bound response size/time, and wait at least 550 ms between uncached requests. Source errors stop certification; the JSON is marked complete only after every city validates.

```sh
../.venv/bin/python -m stations.shell --source-dir data/stations/brands-2026-11-11
../.venv/bin/python -m stations.brands \
  --source-dir data/stations/brands-2026-11-11 \
  --existing-json data/stations/expansion-2026-11-11/existing-stations.json \
  --prior-preview data/stations/expansion-2026-11-11/preview.json \
  --output data/stations/brands-2026-11-11/combined-preview.json
```

`stations.brands` is an offline parser/audit command for the downloaded source files and has no database-write interface. Tests cover incomplete traversal, count mismatches, city cache reuse, country/identity changes, pure EV exclusion, unknown station classifications, source coordinate errors, incorrect default locality, Phoenix name/address boundaries and Jetti row continuity. Existing SEAOIL and expansion regressions also pass.

Import and app integration remain separate work: company-scoped upserts, explicit geographic mapping, generic directory support beyond SEAOIL, and region-query pagination. Station locations remain separate from DOE area estimates and verified branch pump prices.
