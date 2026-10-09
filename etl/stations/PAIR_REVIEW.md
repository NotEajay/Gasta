# SEAOIL ambiguous-pair review

**817 source records are eligible for import; 10 remain quarantined.** None of the five pairs can be confidently classified as the same station, distinct stations, or historical/renamed listings from the available official data. No canonical row was selected and no source record was dropped.

Official listing evidence: complete 21-page inventory captured in the previous full preview. Each of the ten detail pages was read from official SEAOIL HTML (fresh fetch if not previously captured). Capture timestamp: 2026-10-09T00:21:43.558518+00:00. Full detail comparisons: `etl/data/stations/seaoil-pair-evidence.json`; raw HTML remains in `etl/data/stations/seaoil-audit-html/`.

## Decision table

| Pair | Source IDs | Decision | Official evidence | Import action |
|---|---|---|---|---|
| CABAROAN TAYUM - ABRA | `bmf-gasoline-station-97055`; `bmf-gasoline-station` | Unresolved | Unsuffixed page additionally lists Extreme 91 and SEAOIL Gift Cards; suffixed page does not. | Quarantine both; retain evidence |
| KABANKALAN - NEGROS | `freida-s-seaoil-station`; `freida-s-seaoil-station-14fef` | Unresolved | Same fuels; only unsuffixed page lists VIP Card and SEAOIL Gift Cards. | Quarantine both; retain evidence |
| PALATIW - PASIG | `serv-central-inc-palatiw`; `lotus-dragon-opc-palatiw` | Unresolved | Different business-name slugs; SERV page additionally lists Extreme 91 and ten payment options. Neither page provides evidence of a rename/transfer. | Quarantine both; retain evidence |
| POB MAGPET - NORTH COTABATO | `sychar-gas-station-325ae`; `sychar-gas-station` | Unresolved | Unsuffixed page additionally lists Extreme 91 and SEAOIL Gift Cards. | Quarantine both; retain evidence |
| PUROK 1B APOKON TAGUM - DAVAO | `lji888-gas-refilling-station`; `lji888-gas-refilling-station-7e9ff` | Unresolved | Unsuffixed page additionally lists Extreme 91 and SEAOIL Gift Cards. | Quarantine both; retain evidence |

Matching names/addresses do not establish one physical branch. Different products/payments also do not prove separate physical branches: they could reflect data maintenance, business changes, or separate stations. Hex-like slug suffixes are not reliable historical markers. Slug business-name differences are not proof of a renamed operator. No source provides sufficient disambiguating location/identity evidence.

## Field-by-field evidence

In each pair the exact normalized published station name, address, and hours match. Listing whitespace/punctuation normalization follows the existing parser. The cached original HTML is preserved. The evidence manifest includes all ten source IDs/URLs, listing fingerprints, detail HTML SHA-256, fuel products, hours, payment metadata, and Webflow identity attributes.

### CABAROAN TAYUM - ABRA

Published station name: `CABAROAN TAYUM - ABRA`.

Full address: CABAROAN, TAYUM, ABRA.

- Source ID: `bmf-gasoline-station-97055`
  - Detail URL: https://www.seaoil.com.ph/stations/bmf-gasoline-station-97055
  - Fuel products: Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: Paymaya, Gcash
  - Detail identity: `data-wf-item-slug` matches this source ID.
- Source ID: `bmf-gasoline-station`
  - Detail URL: https://www.seaoil.com.ph/stations/bmf-gasoline-station
  - Fuel products: Extreme 91, Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: Paymaya, Gcash, SEAOIL Gift Cards
  - Detail identity: `data-wf-item-slug` matches this source ID.

Contact/phone links: none exposed. Station-specific embedded coordinate markers/structured JSON: none exposed. No explicit closed/renamed/relocated status. No additional detail landmarks; only the published address above. Webflow template/page/site/collection IDs are shared and cannot establish branch distinctness; the item slug is the distinguishing external record identity. Other observed HTML differences are product/payment collections or generic template metadata, not a definitive physical-station identifier.

### KABANKALAN - NEGROS

Published station name: `KABANKALAN - NEGROS`.

Full address: NATIONAL HIGHWAY BINIQUIL KABANKALAN NEGROS OCCIDENTAL.

- Source ID: `freida-s-seaoil-station`
  - Detail URL: https://www.seaoil.com.ph/stations/freida-s-seaoil-station
  - Fuel products: Extreme 91, Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: VIP Card, SEAOIL Gift Cards
  - Detail identity: `data-wf-item-slug` matches this source ID.
- Source ID: `freida-s-seaoil-station-14fef`
  - Detail URL: https://www.seaoil.com.ph/stations/freida-s-seaoil-station-14fef
  - Fuel products: Extreme 91, Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: none exposed; not proof payments are unavailable
  - Detail identity: `data-wf-item-slug` matches this source ID.

Contact/phone links: none exposed. Station-specific embedded coordinate markers/structured JSON: none exposed. No explicit closed/renamed/relocated status. No additional detail landmarks; only the published address above. Webflow template/page/site/collection IDs are shared and cannot establish branch distinctness; the item slug is the distinguishing external record identity. Other observed HTML differences are product/payment collections or generic template metadata, not a definitive physical-station identifier.

### PALATIW - PASIG

Published station name: `PALATIW - PASIG`.

Full address: CORNER MARKET AVE AND BALTAZAR STS PALATIW PASIG CITY.

- Source ID: `serv-central-inc-palatiw`
  - Detail URL: https://www.seaoil.com.ph/stations/serv-central-inc-palatiw
  - Fuel products: Extreme 91, Extreme 97, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: Shopee Pay, Fleet Cards, Paymaya, Gcash, Debit Card, Credit Card, QRPH, PLB, PLC, Pantawid Pasada
  - Detail identity: `data-wf-item-slug` matches this source ID.
- Source ID: `lotus-dragon-opc-palatiw`
  - Detail URL: https://www.seaoil.com.ph/stations/lotus-dragon-opc-palatiw
  - Fuel products: Extreme 97, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: none exposed; not proof payments are unavailable
  - Detail identity: `data-wf-item-slug` matches this source ID.

Contact/phone links: none exposed. Station-specific embedded coordinate markers/structured JSON: none exposed. No explicit closed/renamed/relocated status. No additional detail landmarks; only the published address above. Webflow template/page/site/collection IDs are shared and cannot establish branch distinctness; the item slug is the distinguishing external record identity. Other observed HTML differences are product/payment collections or generic template metadata, not a definitive physical-station identifier.

### POB MAGPET - NORTH COTABATO

Published station name: `POB MAGPET - NORTH COTABATO`.

Full address: POBLACION, MAGPET, NORTH COTABATO.

- Source ID: `sychar-gas-station-325ae`
  - Detail URL: https://www.seaoil.com.ph/stations/sychar-gas-station-325ae
  - Fuel products: Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: none exposed; not proof payments are unavailable
  - Detail identity: `data-wf-item-slug` matches this source ID.
- Source ID: `sychar-gas-station`
  - Detail URL: https://www.seaoil.com.ph/stations/sychar-gas-station
  - Fuel products: Extreme 91, Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: SEAOIL Gift Cards
  - Detail identity: `data-wf-item-slug` matches this source ID.

Contact/phone links: none exposed. Station-specific embedded coordinate markers/structured JSON: none exposed. No explicit closed/renamed/relocated status. No additional detail landmarks; only the published address above. Webflow template/page/site/collection IDs are shared and cannot establish branch distinctness; the item slug is the distinguishing external record identity. Other observed HTML differences are product/payment collections or generic template metadata, not a definitive physical-station identifier.

### PUROK 1B APOKON TAGUM - DAVAO

Published station name: `PUROK 1B APOKON TAGUM - DAVAO`.

Full address: PUROK 1B BARANGAY APOKON TAGUM CITY DAVAO DEL NORTE.

- Source ID: `lji888-gas-refilling-station`
  - Detail URL: https://www.seaoil.com.ph/stations/lji888-gas-refilling-station
  - Fuel products: Extreme 91, Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: SEAOIL Gift Cards
  - Detail identity: `data-wf-item-slug` matches this source ID.
- Source ID: `lji888-gas-refilling-station-7e9ff`
  - Detail URL: https://www.seaoil.com.ph/stations/lji888-gas-refilling-station-7e9ff
  - Fuel products: Extreme 95, Extreme Diesel
  - Hours from listing: Open 24 hours
  - Published payment options: none exposed; not proof payments are unavailable
  - Detail identity: `data-wf-item-slug` matches this source ID.

Contact/phone links: none exposed. Station-specific embedded coordinate markers/structured JSON: none exposed. No explicit closed/renamed/relocated status. No additional detail landmarks; only the published address above. Webflow template/page/site/collection IDs are shared and cannot establish branch distinctness; the item slug is the distinguishing external record identity. Other observed HTML differences are product/payment collections or generic template metadata, not a definitive physical-station identifier.

## Import policy

- Primary identity stays `(oil_company_id, source_station_id)` through deterministic `source:<slug>` import keys; database uniqueness is unchanged.
- Matching normalized name/address generates a warning and review signal, not a hard uniqueness constraint.
- `review/seaoil_ambiguous.json` explicitly holds all ten `pending_review` records. They stay blocked even if only one member appears in a partial batch or the listing later changes.
- A new matching pair with no decision is quarantined and reported, not silently picked or used to fail the entire safe batch.
- `approved_distinct` decisions require reviewer, date, evidence and a matching listing fingerprint. Both approved external identities may share a name/address and remain separate records. A changed reviewed listing re-enters quarantine.
- No pair was confirmed to be a duplicated physical branch, so no canonical/alias merge was implemented. That decision would require stronger official evidence and explicit alias retention design.
- `collect()` does not fetch known quarantined details during ingestion; the review step has already preserved them. It returns eligible rows and explicit quarantine records/counts. `load_sample()` independently plans quarantine before database access and prints every skipped identity/reason; all-quarantined input makes zero database calls.
- Missing/corrupt review files, duplicate import keys/source IDs, mismatched source IDs/URLs, and invalid approval metadata fail closed.

## Counts and validation

Verified against all cached listing pages:

```yaml
Source records retained: 827
Eligible records: 817
Quarantined records: 10
Normalized name/address warnings: 5
Import-key collisions: 0
Confirmed distinct pairs: 0
Confirmed duplicate physical-station pairs: 0
Confirmed historical/renamed pairs: 0
Unresolved pairs: 5
```

All 19 existing tests pass with the former whole-batch rejection test updated for explicit quarantine. Twelve additional test cases verify pending-single-member handling, safe-subset writes/retries, approved distinctness, stale approvals, new ambiguities, malformed review files, source-key guards, and quarantine collection. Total: 31 passing tests.

Two mocked full-inventory imports, including reversed input order, retained exactly 817 eligible keys and never wrote a quarantined key. Raw evidence retains all 827 records. The 817 count is import eligibility based on reviewed listing identity; a future real sync still validates each eligible detail page using the existing strict fuel parser. This task does not claim that all 817 detail pages have been fetched/enriched. The previous geographic sample covered 30 details, and this review compared ten additional detail records.

No live Supabase reads/writes, migration deployment, geocoding, commit or push. The pending schema migration was not changed for this task.
