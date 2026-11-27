"""Offline expansion audit for downloaded official sources. Never writes to a database.

python -m stations.expansion --caltex-json ... --petron-pdf ... --existing-json ... --output ...
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from .seaoil import clean, identity, sync_time

CALTEX_SOURCE = 'https://www.caltex.com/ph/find-us.html'
CALTEX_FEED = 'https://www.caltex.com/bin/services/getStations.json?pagePath=/ph/find-us&siteType=b2c'
PETRON_SOURCE = 'https://www.petron.com/wp-content/uploads/2026/04/PFC-SS-Merged.pdf'
PETRON_SECTIONS = {'NCR', 'NORTH LUZON', 'SOUTH LUZON', 'VISAYAS', 'MINDANAO'}
CALTEX_FUELS = {'Platinum with Techron', 'Silver with Techron', 'Diesel with Techron D',
                'Power Diesel with Techron D', 'Kerosene'}


def normalized(value):
    return (clean(value) or '').casefold()


def point(latitude, longitude):
    try:
        lat, lon = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180 or (lat == lon == 0):
        return None
    return lat, lon


def parse_caltex(data: list) -> tuple[list[dict], dict]:
    if not isinstance(data, list) or not data:
        raise ValueError('Expected a nonempty Caltex locator array')
    rows, skipped = [], Counter()
    for item in data:
        if not isinstance(item, dict) or not item.get('siteType'):
            raise ValueError('Caltex locator schema changed')
        if item['siteType'] != 'Station':
            skipped[item['siteType']] += 1
            continue
        if item.get('country') != 'Philippines':
            raise ValueError('Unexpected country in Philippines station feed')
        source_id = clean(str(item.get('id') or ''))
        name, street = clean(item.get('name')), clean(item.get('street'))
        if not source_id or not name:
            raise ValueError('Caltex station lacks source identity')
        city, province = clean(item.get('city')), clean(item.get('state'))
        # These fields are published by the company; no geocoding or DOE mapping.
        address = ', '.join(dict.fromkeys(x for x in [street, city, province] if x)) or None
        coords = point(item.get('latitude'), item.get('longitude'))
        products = item.get('fuelsName')
        if products is not None and (not isinstance(products, list) or not all(isinstance(x, str) for x in products)):
            raise ValueError('Caltex fuel metadata changed')
        rows.append(dict(company_slug='caltex', name=name, address=address, city=city, province=province,
                         directory_region=clean(item.get('region')), source_type='official_directory',
                         source_url=CALTEX_SOURCE, source_station_id=source_id, directory_key=identity(source_id, name, address),
                         published_site_id=clean(str(item.get('siteId') or '')),
                         operating_hours=clean(item.get('operatingHours')),
                         fuel_types=sorted({x for x in products or [] if x in CALTEX_FUELS}) if products is not None else None,
                         latitude=coords[0] if coords else None, longitude=coords[1] if coords else None,
                         review_reasons=([] if coords else ['missing_or_invalid_coordinates']) + ([] if street else ['missing_street_address'])))
    if not rows:
        raise ValueError('No Philippines stations in feed')
    return rows, dict(skipped)


def parse_petron_tables(pages: list[list]) -> list[dict]:
    rows, section = [], None
    for page_number, tables in enumerate(pages, 1):
        if not tables:
            raise ValueError(f'No table extracted on Petron page {page_number}')
        for table in tables:
            for cells in table:
                if len(cells) != 3:
                    raise ValueError(f'Unexpected Petron table width on page {page_number}')
                number, name, address = (clean(x) for x in cells)
                if number in PETRON_SECTIONS and name is None and address is None:
                    section = number
                    continue
                if name == 'BUSINESS NAME' and address == 'LOCATION':
                    continue
                if not number or not number.isdigit() or not section:
                    raise ValueError(f'Unrecognized Petron row on page {page_number}')
                if not name:
                    raise ValueError(f'Missing Petron station name on page {page_number}')
                # Row numbers restart per section and can change. They are evidence, not stable IDs.
                rows.append(dict(company_slug='petron', name=name, address=address, city=None, province=None,
                                 directory_region=section, source_type='official_directory', source_url=PETRON_SOURCE,
                                 source_station_id=None, directory_key=identity(None, name, address) if address else None,
                                 published_row=number, source_page=page_number, operating_hours=None, fuel_types=None,
                                 latitude=None, longitude=None, review_reasons=[] if address else ['missing_address']))
    if not rows:
        raise ValueError('No participating Petron stations extracted')
    return rows


def meters(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    value = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(value)))


def audit(rows: list[dict], existing: list[dict]) -> dict:
    rows = [{**row, 'review_reasons': list(row['review_reasons'])} for row in rows]
    # Never choose one of two conflicting identities or collapse nearby branches automatically.
    for field, reason in [('directory_key', 'repeated_source_identity'), ('published_site_id', 'repeated_published_site_id')]:
        groups = defaultdict(list)
        for row in rows:
            if row.get(field):
                groups[(row['company_slug'], row[field])].append(row)
        for group in groups.values():
            if len(group) > 1:
                for row in group:
                    row['review_reasons'].append(reason)
    for kind in ['address', 'coordinates']:
        groups = defaultdict(list)
        for row in rows:
            value = normalized(row['address']) if kind == 'address' else point(row['latitude'], row['longitude'])
            if value:
                groups[(row['company_slug'], value)].append(row)
        for group in groups.values():
            if len(group) > 1:
                # A short published address may describe multiple distinct
                # branches. Independent source IDs and separated published pins
                # establish distinct locations; never apply this to shared pins.
                if kind == 'address' and group[0]['company_slug'] in {'caltex', 'shell'} and all(row.get('source_station_id') for row in group):
                    coordinates = [point(row['latitude'], row['longitude']) for row in group]
                    if all(coordinates) and all(meters(a, b) > 75 for index, a in enumerate(coordinates) for b in coordinates[index+1:]):
                        continue
                for row in group:
                    row['review_reasons'].append('shared_' + kind)
    for row in rows:
        if not row['address']:
            row['review_reasons'].append('missing_address')
        matches = []
        for old in existing:
            if old['company_slug'] != row['company_slug']:
                continue
            a, b = point(row['latitude'], row['longitude']), point(old.get('latitude'), old.get('longitude'))
            same_source = old.get('directory_key') and old['directory_key'] == row['directory_key']
            same_address = row['address'] and normalized(old.get('address')) == normalized(row['address'])
            nearby = a and b and meters(a, b) <= 75
            if same_source or same_address or nearby:
                matches.append(old['id'])
        row['existing_match_ids'] = sorted(matches)
        if matches:
            row['review_reasons'].append('possible_existing_station')
        row['review_reasons'] = sorted(set(row['review_reasons']))
    return {'stations': rows, 'summary': {
        'fetched_station_rows': len(rows),
        'candidate_new_records': sum(not row['review_reasons'] for row in rows),
        'review_required': sum(bool(row['review_reasons']) for row in rows),
        'by_brand': {brand: {'fetched': sum(row['company_slug'] == brand for row in rows),
                            'candidate_new': sum(row['company_slug'] == brand and not row['review_reasons'] for row in rows)}
                     for brand in sorted({row['company_slug'] for row in rows})},
        'review_reason_counts': dict(Counter(reason for row in rows for reason in row['review_reasons'])),
        'database_writes': 0}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--caltex-json', type=Path, required=True)
    parser.add_argument('--petron-pdf', type=Path, required=True)
    parser.add_argument('--existing-json', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    import pdfplumber
    caltex, skipped = parse_caltex(json.loads(args.caltex_json.read_text()))
    with pdfplumber.open(args.petron_pdf) as pdf:
        petron = parse_petron_tables([page.extract_tables() for page in pdf.pages])
    result = audit(caltex + petron, json.loads(args.existing_json.read_text()))
    result.update(audited_at=sync_time(), excluded_caltex_types=skipped,
                  source_hashes={str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                                 for path in [args.caltex_json, args.petron_pdf, args.existing_json]})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    fields = ['company_slug', 'name', 'address', 'city', 'province', 'latitude', 'longitude',
              'source_url', 'source_station_id', 'directory_key', 'review_reasons', 'existing_match_ids']
    with args.output.with_suffix('.csv').open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for row in result['stations']:
            writer.writerow({**row, 'review_reasons': '; '.join(row['review_reasons']),
                             'existing_match_ids': '; '.join(row['existing_match_ids'])})
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
