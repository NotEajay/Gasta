"""Normalize downloaded official brand locators into the expansion review format.

No network, database writes, geocoding, price extraction or inferred fuel grades.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from lxml import html

from .expansion import audit, point
from .seaoil import clean, identity, sync_time

PTT_SOURCE = 'https://www.pttphilippines.com/find-a-station'
PHOENIX_SOURCE = 'https://sites.google.com/phoenixfuels.ph/pnxstationvismin/home'
JETTI_SOURCE = 'https://prod-cms.doe.gov.ph/documents/d/guest/overall-summary-of-discount_15-october-2025-o-pdf'


def record(brand, name, address, url, source_id=None, lat=None, lon=None, **metadata):
    name, address = clean(name), clean(address)
    if not name:
        raise ValueError('Station is missing its published name')
    coords = point(lat, lon)
    return dict(company_slug=brand, name=name, address=address, source_url=url,
                source_station_id=str(source_id) if source_id is not None else None,
                directory_key=identity(str(source_id) if source_id is not None else None, name, address) if source_id is not None or address else None,
                source_type='official_directory', latitude=coords[0] if coords else None,
                longitude=coords[1] if coords else None, city=None, province=None,
                directory_region=None, operating_hours=None, fuel_types=None,
                review_reasons=[] if address else ['missing_address']) | metadata


def shell_props(content):
    nodes = html.fromstring(content).xpath('//script[@data-page="app" and @type="application/json"]')
    if len(nodes) != 1:
        raise ValueError('Shell directory page schema changed')
    return json.loads(nodes[0].text)['props']


def parse_shell(data):
    if not data.get('complete') or len(data['cities']) != data['expected_cities']:
        raise ValueError('Incomplete Shell city traversal')
    found, excluded = {}, {}
    for city in data['cities']:
        for item in city['locations']:
            marker = urlparse(item['logo_url']).path.rsplit('/', 1)[-1]
            if marker in {'destination-charging-ev.png', 'fast-charging-ev.png'}:
                excluded[marker] = excluded.get(marker, 0) + 1
                continue
            source_id = str(item['id'])
            url = urljoin('https://find.shell.com', item['link'])
            if urlparse(url).netloc != 'find.shell.com' or not urlparse(url).path.startswith('/ph/fuel/' + source_id + '-'):
                raise ValueError('Unexpected Shell station identity or country')
            address = item['formatted_address']
            if address.splitlines()[-1].strip() != 'PH':
                raise ValueError('Non-Philippine Shell station')
            row = record('shell', item['name'], address, url, source_id)
            if marker != 'conventional-fuel-site.png':
                row['review_reasons'].append('unknown_shell_site_type')
            # Live open_status is intentionally not persisted as operating hours/status.
            old = found.get(source_id)
            if old and old != row:
                raise ValueError('Conflicting Shell source identity across cities')
            found[source_id] = row
    if not found:
        raise ValueError('No Shell fuel stations collected')
    return list(found.values()), excluded


def parse_ptt(content):
    flight = []
    for script in html.fromstring(content).xpath('//script[not(@src)]/text()'):
        prefix = 'self.__next_f.push('
        if script.startswith(prefix):
            chunk = json.loads(script[len(prefix):-1])
            if chunk[0] == 1:
                flight.append(chunk[1])
    text, key = ''.join(flight), '"allStations":'
    if key not in text:
        raise ValueError('PTT station payload not found')
    stations, _ = json.JSONDecoder().raw_decode(text[text.index(key) + len(key):].lstrip())
    if not isinstance(stations, list) or not stations:
        raise ValueError('Invalid PTT station payload')
    rows, excluded = [], {}
    for item in stations:
        status = item['status']
        if status != 'operational':
            excluded[status] = excluded.get(status, 0) + 1
            continue
        location = item['locationInfo']
        row = record('ptt', item['stationName'], location.get('address'), PTT_SOURCE,
                     item['id'], location.get('lat'), location.get('lng'))
        row.update(province=clean(location.get('province')), operating_hours=clean(item.get('operatingHours')),
                   fuel_types=[name for flag, name in [('hasSavePlus', 'Save+ Diesel'), ('hasEcoPlus', 'Eco+ Gasoline'),
                               ('hasPowerPlus', 'Power+ Gasoline'), ('hasUltraPlus', 'Ultra+ Diesel')]
                               if item.get('services', {}).get(flag) is True])
        if (location.get('lat') is not None or location.get('lng') is not None) and point(location.get('lat'), location.get('lng')) is None:
            row['review_reasons'].append('invalid_published_coordinates')
        rows.append(row)
    return rows, excluded


def parse_cleanfuel(locations, markers):
    if not isinstance(locations, list) or not locations or len(locations) != markers['total']:
        raise ValueError('Cleanfuel location/marker count mismatch')
    ids = {str(item['m']) for item in markers['items']}
    if len(ids) != markers['total']:
        raise ValueError('Incomplete Cleanfuel marker list')
    rows = []
    for item in locations:
        if item['type'] != 'gd_place' or item['status'] != 'publish':
            raise ValueError('Unexpected Cleanfuel location type/country/status')
        if str(item['id']) not in ids:
            raise ValueError('Cleanfuel location is not present in locator markers')
        url = item['link']
        if urlparse(url).netloc != 'www.cleanfuel.ph' or not urlparse(url).path.startswith('/location/'):
            raise ValueError('Unexpected Cleanfuel branch URL')
        title = html.fromstring('<div>' + item['title']['rendered'] + '</div>').text_content()
        row = record('clean-fuel', 'Cleanfuel ' + title, item.get('street'), url, item['id'], item.get('latitude'), item.get('longitude'))
        # The source incorrectly uses Pasig for other cities. Preserve its street text,
        # but leave structured locality unknown rather than spreading that default.
        row['source_modified_at'] = item.get('modified_gmt')
        if item.get('country') != 'Philippines':
            row['review_reasons'].append('source_country_mismatch')
            row['published_country'] = item.get('country')
        rows.append(row)
    return rows


def parse_phoenix(content):
    root = html.fromstring(content)
    title = ' '.join(root.xpath('//title/text()'))
    if 'OPERATIONAL PHOENIX STATIONS' not in title.upper():
        raise ValueError('Phoenix operational-list identity changed')
    paragraphs = [clean(node.text_content().replace('\u200b', '')) for node in root.xpath('//p')]
    paragraphs = [value for value in paragraphs if value]
    rows, region, index = [], None, 0
    while index < len(paragraphs):
        value = paragraphs[index]
        if value.lower() in {'visayas', 'mindanao'}:
            region = value
        if re.match(r'^phoenix[. ]', value, re.IGNORECASE):
            address = paragraphs[index+1] if index+1 < len(paragraphs) else None
            next_is_name = address and re.match(r'^phoenix[. ]', address, re.IGNORECASE) and not address.lower().startswith('phoenix station,')
            if not region or not address or next_is_name:
                raise ValueError('Phoenix station is missing its address or source section')
            rows.append(record('phoenix', value, address, PHOENIX_SOURCE, directory_region=region))
            index += 2
        else:
            index += 1
    if not rows:
        raise ValueError('No Phoenix operational-list rows')
    return rows


def parse_jetti(pages):
    rows, numbers = [], []
    for page_no, tables in enumerate(pages, 1):
        if not tables:
            raise ValueError('Jetti table extraction missing a page')
        for table in tables:
            for cells in table:
                if not cells[0] or not cells[0].strip().isdigit():
                    if cells[0] not in {'No.', None}:
                        raise ValueError('Unexpected Jetti table row')
                    continue
                if len(cells) != 10 or not (cells[1] or '').upper().startswith('JETTI '):
                    raise ValueError('Jetti source table schema changed')
                number = int(cells[0]);numbers.append(number)
                province, city, barangay, street = [clean(v) for v in cells[2:6]]
                address = ', '.join(v for v in [street, barangay, city, province] if v)
                row = record('jetti', cells[1], address, JETTI_SOURCE, city=city, province=province)
                row.update(source_page=page_no, published_row=number, source_published_date='2025-10-15')
                if not street and not barangay:
                    row['review_reasons'].append('address_only_names_city')
                # The discount columns are not pump prices or evidence of fuel availability.
                rows.append(row)
    if numbers != list(range(1, len(numbers)+1)) or not rows:
        raise ValueError('Jetti numbered rows incomplete, duplicated or reordered')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--existing-json', type=Path, required=True)
    parser.add_argument('--prior-preview', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args();folder = args.source_dir
    import pdfplumber
    shell, shell_excluded = parse_shell(json.loads((folder/'shell-collected.json').read_text()))
    ptt, ptt_excluded = parse_ptt((folder/'ptt.html').read_text())
    cleanfuel = parse_cleanfuel(json.loads((folder/'cleanfuel-locations.json').read_text()), json.loads((folder/'cleanfuel-markers.json').read_text()))
    phoenix = parse_phoenix((folder/'phoenix-vismin.html').read_text())
    with pdfplumber.open(folder/'doe-discount-2025.pdf') as pdf:
        jetti = parse_jetti([page.extract_tables() for page in pdf.pages])
    rows = shell + ptt + cleanfuel + phoenix + jetti
    prior = json.loads(args.prior_preview.read_text())['stations']
    existing = json.loads(args.existing_json.read_text())
    result = audit(prior + rows, existing)
    result.update(audited_at=sync_time(), additional_rows=len(rows), excluded_shell_types=shell_excluded,
                  excluded_ptt_statuses=ptt_excluded, database_writes=0,
                  unavailable_brands={'unioil': 'Official site redirect could not be resolved',
                                      'flying-v': 'No complete structured station inventory found on the inspected official homepage'},
                  source_hashes={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                                 [folder/name for name in ['shell.html', 'shell-collected.json', 'ptt.html',
                                  'cleanfuel-locations.json', 'cleanfuel-markers.json', 'phoenix-vismin.html', 'doe-discount-2025.pdf']]
                                 + [args.existing_json, args.prior_preview]})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    fields = ['company_slug', 'name', 'address', 'city', 'province', 'latitude', 'longitude', 'source_url', 'source_station_id', 'directory_key', 'review_reasons']
    with args.output.with_suffix('.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore');writer.writeheader()
        for row in result['stations']:
            writer.writerow({**row, 'review_reasons': '; '.join(row['review_reasons'])})
    print(json.dumps({**result['summary'], 'additional_rows': len(rows), 'excluded_shell_types': shell_excluded}, indent=2))


if __name__ == '__main__':
    main()
