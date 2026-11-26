"""Recheck and import screened official station identities. Preview unless --write.

Only additive inserts into fuel_stations; existing UUIDs/metadata and all prices/reports stay intact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from .expansion import audit, point
from .seaoil import identity, sync_time
from .completion import DOE_SOURCE

HOSTS = {'caltex': 'www.caltex.com', 'ptt': 'www.pttphilippines.com', 'shell': 'find.shell.com',
         'petron': 'www.petron.com', 'phoenix': ('sites.google.com', 'www.phoenixfuels.ph'), 'clean-fuel': 'www.cleanfuel.ph', 'jetti': 'prod-cms.doe.gov.ph',
         'my-gas': 'www.mygaspetroleum.com', 'unioil': ('doe.gov.ph', 'www.unioil.com'), 'flying-v': 'doe.gov.ph', 'total': 'doe.gov.ph'}
FIELDS = ['name', 'address', 'source_url', 'source_station_id', 'directory_key', 'city', 'province',
          'directory_region', 'operating_hours', 'fuel_types']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify_inputs(preview_path, mapping_path):
    raw = preview_path.read_bytes();preview = json.loads(raw);mapping = json.loads(mapping_path.read_bytes())
    if mapping['preview_sha256'] != sha(raw):
        raise ValueError('Region map was generated for another preview')
    rules = Path(__file__).resolve().parents[2]/'mobile/lib/services/stationDirectory.ts'
    if mapping['rules_sha256'] != sha(rules.read_bytes()):
        raise ValueError('Region mapping rules changed; regenerate the map')
    for filename, digest in preview['source_hashes'].items():
        if sha(Path(filename).read_bytes()) != digest:
            raise ValueError('Source evidence changed: ' + Path(filename).name)
    return preview['stations'], mapping['records']


def payload(row, companies, regions, mapping, timestamp):
    brand = row['company_slug'];url = urlparse(row['source_url'])
    hosts = HOSTS.get(brand, ())
    hosts = (hosts,) if isinstance(hosts, str) else hosts
    if brand not in companies or url.scheme != 'https' or url.netloc not in hosts:
        raise ValueError('Unexpected station brand/source')
    if brand == 'phoenix':
        from .phoenix import PHOENIX_PAGES
        if url.netloc == 'sites.google.com' and not url.path.startswith('/phoenixfuels.ph/'):
            raise ValueError('Unexpected Phoenix source publisher')
        if url.netloc == 'www.phoenixfuels.ph' and row['source_url'] not in PHOENIX_PAGES.values():
            raise ValueError('Unexpected Phoenix source page')
    if url.netloc == 'doe.gov.ph' and row['source_url'] != DOE_SOURCE:
        raise ValueError('Unexpected DOE station register')
    if brand == 'unioil' and url.netloc == 'www.unioil.com' and row['source_url'] != 'https://www.unioil.com/stations':
        raise ValueError('Unexpected Unioil locator')
    if not row.get('name') or not row.get('address') or row['directory_key'] != identity(row.get('source_station_id'), row['name'], row['address']):
        raise ValueError('Invalid station identity/address')
    key = (brand, row['directory_key'])
    entry = mapping.get(key)
    if entry is None or entry['address'] != row['address']:
        raise ValueError('Region mapping does not match the source address')
    region = entry['region_code']
    if region is not None and region not in regions:
        raise ValueError('Unknown region mapping')
    result = {field: row.get(field) for field in FIELDS}
    result.update(oil_company_id=companies[brand], region_id=regions[region] if region else None,
                  source_type='official_directory', last_synced_at=timestamp)
    coords = point(row.get('latitude'), row.get('longitude'))
    if coords:
        if not 4 <= coords[0] <= 22.5 or not 116 <= coords[1] <= 127:
            raise ValueError('Source coordinates outside Philippine extent')
        result.update(latitude=coords[0], longitude=coords[1])
    elif row.get('latitude') is not None or row.get('longitude') is not None:
        raise ValueError('Invalid/partial source coordinates')
    if result['fuel_types'] is not None and (not isinstance(result['fuel_types'], list) or not all(isinstance(v, str) for v in result['fuel_types'])):
        raise ValueError('Invalid product metadata')
    return result


def plan(rows, existing, companies, regions, mappings, timestamp):
    mapping = {(x['company_slug'], x['directory_key']): x for x in mappings}
    if len(mapping) != len(mappings):
        raise ValueError('Duplicate region-map identity')
    existing_keys = {(x['company_slug'], x.get('directory_key')) for x in existing if x.get('directory_key')}
    already, remaining = [], []
    for row in rows:
        if (row['company_slug'], row['directory_key']) in existing_keys:
            already.append(row)
        else:
            remaining.append(row)
    checked = audit(remaining, existing)
    eligible = [row for row in checked['stations'] if not row['review_reasons']]
    payloads = [payload(row, companies, regions, mapping, timestamp) for row in eligible]
    return {'payloads': payloads, 'review': [x for x in checked['stations'] if x['review_reasons']],
            'summary': {'new_records': len(payloads), 'already_present': len(already),
                        'held_for_review': checked['summary']['review_required'],
                        'by_brand': dict(Counter(x['company_slug'] for x in eligible)),
                        'with_mapped_region': sum(x['region_id'] is not None for x in payloads),
                        'with_coordinates': sum('latitude' in x for x in payloads)}}


def fetch_all(client, table, fields='*'):
    result = []
    for offset in range(0, 1_000_000, 500):
        batch = client.table(table).select(fields).order('id').range(offset, offset+499).execute().data or []
        result.extend(batch)
        if len(batch) < 500:
            return result
    raise ValueError('Inventory exceeded audit limit')


def insert_batch(client, batch):
    # DO NOTHING on existing keys: never replace a station UUID or wipe later geocoding.
    return client.table('fuel_stations').upsert(batch, on_conflict='oil_company_id,directory_key',
                                               ignore_duplicates=True, default_to_null=False).execute().data or []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', type=Path, required=True)
    parser.add_argument('--mapping', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    rows, mappings = verify_inputs(args.preview, args.mapping)
    from dotenv import dotenv_values
    from supabase import create_client
    root = Path(__file__).resolve().parents[2]
    env = dotenv_values(root/'etl/.env');mobile = dotenv_values(root/'mobile/.env')
    if env.get('SUPABASE_URL', '').rstrip('/') != mobile.get('EXPO_PUBLIC_SUPABASE_URL', '').rstrip('/'):
        raise ValueError('ETL and app target different projects')
    if not env.get('SUPABASE_SERVICE_ROLE_KEY'):
        raise ValueError('Station import credentials unavailable')
    client = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
    company_rows = fetch_all(client, 'oil_companies', 'id,slug')
    companies = {x['slug']: x['id'] for x in company_rows};brands = {x['id']: x['slug'] for x in company_rows}
    regions = {x['code']: x['id'] for x in fetch_all(client, 'regions', 'id,code')}
    before = fetch_all(client, 'fuel_stations')
    existing = [{**x, 'company_slug': brands[x['oil_company_id']]} for x in before]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir/'before.json').write_text(json.dumps(before, indent=2))
    result = plan(rows, existing, companies, regions, mappings, sync_time())
    (args.output_dir/'plan.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result['summary']), flush=True)
    if not args.write:
        print('Preview only; no database writes.', flush=True);return
    imported = [];payloads = result['payloads']
    # Validate a small Caltex/PTT batch first, then import in bounded brand order.
    payloads.sort(key=lambda x: (0 if x['oil_company_id'] == companies['caltex'] else 1 if x['oil_company_id'] == companies['ptt'] else 2, x['oil_company_id'], x['directory_key']))
    # Include samples from both coordinate-bearing sources.
    sample = [x for x in payloads if x['oil_company_id'] == companies['caltex']][:5] + [x for x in payloads if x['oil_company_id'] == companies['ptt']][:5]
    sample_keys = {(x['oil_company_id'], x['directory_key']) for x in sample}
    remaining = [x for x in payloads if (x['oil_company_id'], x['directory_key']) not in sample_keys]
    batches = ([sample] if sample else []) + [remaining[i:i+100] for i in range(0, len(remaining), 100)]
    for index, batch in enumerate(batches):
        if not batch:continue
        saved = insert_batch(client, batch)
        imported.extend(saved)
        (args.output_dir/'inserted.json').write_text(json.dumps(imported, indent=2))
        expected = {(x['oil_company_id'], x['directory_key']) for x in batch}
        if {(x['oil_company_id'], x['directory_key']) for x in saved} != expected:
            raise ValueError('Batch changed concurrently; inspect the saved import journal')
        if index == 0 and sample:
            persisted = { (x['oil_company_id'], x['directory_key']): x for x in fetch_all(client, 'fuel_stations') }
            for row in sample:
                saved_row = persisted[(row['oil_company_id'], row['directory_key'])]
                for field in ['name', 'address', 'source_type', 'region_id', 'source_url']:
                    if saved_row.get(field) != row.get(field):
                        raise ValueError('Sample verification failed; import stopped before full batches')
        print(f'Batch {index+1}: {len(saved)} inserted; total {len(imported)}', flush=True)
    after = fetch_all(client, 'fuel_stations')
    (args.output_dir/'after.json').write_text(json.dumps(after, indent=2))
    lookup = {x['id']: x for x in after}
    stable_fields = ['id', 'name', 'address', 'oil_company_id', 'directory_key', 'source_type', 'latitude', 'longitude', 'region_id']
    if any(old['id'] not in lookup or any(old.get(k) != lookup[old['id']].get(k) for k in stable_fields) for old in before):
        raise ValueError('An existing station changed during import; inspect snapshots')
    for row in imported:
        if row['id'] not in lookup:
            raise ValueError('Inserted station missing during verification')
    verification = dict(before=len(before), after=len(after), inserted=len(imported), existing_preserved=True,
                        by_brand=result['summary']['by_brand'], held_for_review=len(result['review']))
    (args.output_dir/'verification.json').write_text(json.dumps(verification, indent=2))
    print(json.dumps(verification), flush=True)


if __name__ == '__main__':
    main()
