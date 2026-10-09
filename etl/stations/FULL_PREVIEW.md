# SEAOIL full preview validation

**Full dataset import: NO — five unresolved pairs remain.** The subsequent [pair review](PAIR_REVIEW.md) enables **817 eligible records**, with **10 explicitly quarantined**. No record was removed, merged, or silently selected.

Official source: https://www.seaoil.com.ph/station-locations

Audit timestamp (UTC): 2026-10-09T00:15:51.862105+00:00

```yaml
SEAOIL FULL PREVIEW:
  Pages: 21
  Raw listings: 827
  Unique stations by source ID: 827
  Duplicate listings by source ID: 0
  Missing addresses: 0
  Detail URLs available: 827
  Detail URLs missing: 0
  Invalid or ambiguous detail URLs: 0
  Import-key collisions: 0
  Duplicate normalized name/address pairs: 5
  Records in those pairs: 10
  Unique normalized name/address pairs: 822
  Sample enriched: 30
  Fuel coverage: 30/30 sampled
  Hours coverage: 30/30 sampled; 827/827 listings
  Detail identity matches: 30/30 sampled
  Malformed or failed details: 0/30 sampled
  Safe to import: NO
```

## Pagination and evidence

Followed the published `w-pagination-next` href through `?1a2d56f2_page=2` … `page=21`. The first 20 pages each contained 40 cards; final page contained 27. Published pagination labels independently matched `1 / 21` … `21 / 21`; final page had no next link. Count is from every downloaded card, not the site's “1001 Stations” label, which does not match the currently published pagination.

The read-only audit first printed all-listing coverage, then fetched 30 details. Selection used explicit address terms for geographic variety plus spread across the list; these sampling labels are never persisted as locality. Detail identity is confirmed by the Webflow `data-wf-item-slug` matching the listing URL, plus a station collection marker. Details do not expose the station display name/address again, so independent name/address matching cannot be claimed.

Sample fuel availability: Extreme Diesel 30, Extreme 95 28, Extreme 91 18, Extreme 97 3. Other advertised fuels were not present in this bounded sample; no claim is made about all 827 stations' products. Lubricants/LubeServ remain excluded. Sample operating hours all read “Open 24 hours”. No sampled detail failures or empty fuel lists; no fabricated coordinates/localities.

Raw records, every anomaly group, page URLs, terminal pagination, HTML hashes, and all 30 enriched rows: `etl/data/stations/seaoil-full-preview.json`. HTML snapshots: `etl/data/stations/seaoil-audit-html/`. These are ignored local evidence artifacts, not database imports.

## Ambiguous duplicate branch records

All source keys are unique, so repeated imports would be idempotent **by source identity**. However, these five name/address pairs have two source IDs each; source IDs alone cannot prove they represent separate physical branches.

- **CABAROAN TAYUM - ABRA** — CABAROAN, TAYUM, ABRA
  - https://www.seaoil.com.ph/stations/bmf-gasoline-station-97055
  - https://www.seaoil.com.ph/stations/bmf-gasoline-station
- **KABANKALAN - NEGROS** — NATIONAL HIGHWAY BINIQUIL KABANKALAN NEGROS OCCIDENTAL
  - https://www.seaoil.com.ph/stations/freida-s-seaoil-station
  - https://www.seaoil.com.ph/stations/freida-s-seaoil-station-14fef
- **PALATIW - PASIG** — CORNER MARKET AVE AND BALTAZAR STS PALATIW PASIG CITY
  - https://www.seaoil.com.ph/stations/serv-central-inc-palatiw
  - https://www.seaoil.com.ph/stations/lotus-dragon-opc-palatiw
- **POB MAGPET - NORTH COTABATO** — POBLACION, MAGPET, NORTH COTABATO
  - https://www.seaoil.com.ph/stations/sychar-gas-station-325ae
  - https://www.seaoil.com.ph/stations/sychar-gas-station
- **PUROK 1B APOKON TAGUM - DAVAO** — PUROK 1B BARANGAY APOKON TAGUM CITY DAVAO DEL NORTE
  - https://www.seaoil.com.ph/stations/lji888-gas-refilling-station
  - https://www.seaoil.com.ph/stations/lji888-gas-refilling-station-7e9ff

All ten records remain in the preview. Distinct keys must not be collapsed automatically. Obtain source clarification or an explicitly reviewed canonical-ID mapping before a full import. The initial loader rejected such aliases before database access. The subsequent pair-review implementation now excludes/reports only unresolved IDs and permits an eligible subset; evidence-approved distinct IDs may coexist. No collisions under `(oil_company_id, directory_key)` or `(oil_company_id, source_station_id)` were found.

Generating keys twice (including reversed traversal) reproduced all 827 identities. Replaying a keyed import simulation retained 827 rows. Replaying all cached pages through the actual strict parser produced 827 records and identical next links. The initial full-dataset loader test stopped on the first ambiguous pair. Subsequent mocked safe-subset tests imported exactly 817 records twice and retained all ten skipped records in quarantine evidence.

## Ten representative enriched records

| Station | Address | Fuel products | Hours |
|---|---|---|---|
| [55 C VIRA LAOAG - ILOCOS NORTE](https://www.seaoil.com.ph/stations/gazz-up-inc-55-c-vira-laoag-ilocos-norte) | RODOLFO G. FARINAS BYPASS ROAD, BRGY. NO. 55-C VIRA, LAOAG CITY, ILOCOS NORTE | Extreme 95, Extreme Diesel | Open 24 hours |
| [ALIBAGU ILAGAN - ISABELA](https://www.seaoil.com.ph/stations/serv-central-inc-alibagu-ilagan-isabela) | NATIONAL HIGHWAY, BARANGAY ALIBAGU, ILAGAN, ISABELA | Extreme 95, Extreme Diesel | Open 24 hours |
| [JP RIZAL AVE OLYMPIA - MAKATI](https://www.seaoil.com.ph/stations/lotus-dragon-opc-jp-rizal-ave-olympia-makati) | 407 J.P RIZAL AVENUE, BARANGAY OLYMPIA, MAKATI CITY, METRO MANILA | Extreme 95, Extreme 97, Extreme Diesel | Open 24 hours |
| [ALFONSO - CAVITE](https://www.seaoil.com.ph/stations/efti-alfonso-cavite-ho) | POBLACION ALFONSO CAVITE | Extreme 91, Extreme 95, Extreme Diesel | Open 24 hours |
| [ANTIPULUAN NARRA- PALAWAN](https://www.seaoil.com.ph/stations/efti-antipuluan-narra-palawan) | BARANGAY ANTIPULUAN, NARRA, PALAWAN | Extreme 91, Extreme Diesel | Open 24 hours |
| [ALOGUINSAN - CEBU](https://www.seaoil.com.ph/stations/owena) | BONBON, ALOGUINSAN, CEBU | Extreme 91, Extreme 95, Extreme Diesel | Open 24 hours |
| [AYAMAN - ILOILO](https://www.seaoil.com.ph/stations/mj-gasoline-station) | AYAMAN CABATUAN ILOILO | Extreme 91, Extreme 95, Extreme Diesel | Open 24 hours |
| [BOLOD PANGLAO - BOHOL](https://www.seaoil.com.ph/stations/drad-distributors-corporation) | SITIO SAPA, BARANGAY BOLOD, PANGLAO, BOHOL | Extreme 95, Extreme Diesel | Open 24 hours |
| [AYALA - ZAMBOANGA](https://www.seaoil.com.ph/stations/ayala-seaoil-gas-station) | CALLE PILAR BARANGAY AYALA ZAMBOANGA CITY | Extreme 91, Extreme 95, Extreme Diesel | Open 24 hours |
| [1ST CRUMB ZONE 1 - DIGOS CITY](https://www.seaoil.com.ph/stations/ata-seaoil-gas-up-and-service-center-1st-crumb-digos-city) | 1ST CRUMB STREET, BARANGAY ZONE 1, DIGOS CITY, DAVAO DEL SUR | Extreme 95, Extreme Diesel | Open 24 hours |

## Locality parsing decision

**Not safe enough for production from addresses alone.** 248 of 827 addresses have no comma delimiters; some repeat locality text, use postal codes, abbreviations, informal district names, or underspecified provinces (for example “AGUSAN” or “NEGROS”). Splitting the last address token/segment would misassign provinces/cities. No regex/gazetteer-based inference was added. Keep city/province/company-region NULL unless explicitly supplied by the source; preserve the complete address. A future authoritative administrative reference and ambiguity handling would require separate validation, not automatic geocoding.

## Migration safety review

Only the new unapplied migration was edited. It extends existing fuel_stations without UPDATE/DELETE of existing records. New directory fields are nullable; source_type defaults to community for legacy rows. Official records require a nonblank name, source URL/key and sync timestamp, but can lack coordinates/DOE region. Existing community/manual location requirements and create RPC are preserved.

The initial coordinate-range check could reject legacy manual values which the old schema permitted. It is now scoped to official records. On a fresh isolated local PostgreSQL database, original station fields (including timestamps/UUIDs) were compared before/after migration and were identical, including a deliberately out-of-range legacy manual row and same-name community rows across regions.

Directory-key uniqueness uses ordinary SQL NULL semantics: legacy rows have NULL keys and do not conflict. The source-ID index is partial, restricted to official rows with a source ID. Existing name/region uniqueness is preserved; imported rows have NULL region_id and are not incorrectly assigned a DOE region. Official provenance RLS guards block authenticated insert/update/conversion, while original community creation remains available. No company/area price tables or report/budget semantics were changed.

Migration, idempotent local upsert, uniqueness, invalid official coordinates/products, unknown locations, original row preservation, community inserts, and RLS checks passed locally. Live database contents were not queried or modified; this is repository-schema plus isolated-fixture validation, not a claim of live schema introspection. Regenerate mobile database types and review integration before exposing directory rows in new UI. Historical/community seeds were not heuristically merged with official records.

## Validation and restrictions

- Station tests, cached full parser replay, deterministic-key/re-import checks, Python compilation, and whitespace checks passed.
- Full live listing preview completed; 30 representative details sampled, not all 827.
- Importing all 827 remains blocked; the eligible 817 subset is supported after review, with ten exclusions reported explicitly. No real import was performed.
- No live Supabase access, migration deployment, station write, geocoding, commit, or push.
