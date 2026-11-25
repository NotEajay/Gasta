"""Offline, evidence-preserving normalization of additional public station registers.

DOE subsidy participation is evidence of a branch, never a pump price or a complete
brand inventory. Numbered PDF rows are retained as evidence, not stable identities.
"""
from __future__ import annotations

from collections import Counter
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from lxml import html

from .brands import record
from .expansion import normalized, point
from .seaoil import clean
from .seaoil import sync_time
from .brands import shell_props

DOE_SOURCE = 'https://doe.gov.ph/fuel-subsidy-program-participating-stations-as-of-14-september-2026'
MYGAS_SOURCE = 'https://www.mygaspetroleum.com/stations.html'
PHOENIX_LUZON_SOURCE = 'https://sites.google.com/phoenixfuels.ph/sharelimitlesswarmth/participating-phoenix-stations'
DOE_BRANDS = {
    'UNIOIL PETROLEUM PHILIPPINES, INC.': 'unioil',
    'TWA, INC. (Flying V)': 'flying-v',
    'TWA, INC.': 'flying-v',
    'TOTAL PHILIPPINES CORPORATION': 'total',
}
SHELL_MOTOR_FUELS = {'cng', 'premium_gasoline', 'premium_diesel', 'fuelsave_midgrade_gasoline',
                     'fuelsave_regular_diesel', 'super_premium_gasoline', 'unleaded_super',
                     'super98', 'kerosene', 'shell_regular_diesel', 'fuelsave_98'}


def parse_doe(pages, expected_rows=None):
    rows, numbers, excluded = [], [], Counter()
    for page_no, tables in enumerate(pages, 1):
        if not tables:
            raise ValueError('Missing DOE table page')
        for table in tables:
            for cells in table:
                number = clean(cells[0]) if cells else None
                if not number or not number.isdigit():
                    if number not in {None, 'Item No.'}:
                        raise ValueError('Unexpected DOE table header')
                    continue
                if len(cells) != 8:
                    raise ValueError('DOE station table schema changed')
                numbers.append(int(number))
                _, region, province, city, barangay, street, publisher, name = [clean(v) for v in cells]
                brand = DOE_BRANDS.get(publisher)
                if brand is None:
                    excluded[publisher] += 1
                    continue
                # Include structured locality without losing the published street.
                address = street or ''
                for locality in [city, province]:
                    if locality and locality.casefold() not in address.casefold():
                        address = ', '.join(v for v in [address, locality] if v)
                row = record(brand, name, address, DOE_SOURCE, city=city, province=province,
                             directory_region=region, source_page=page_no, published_row=int(number),
                             source_published_date='2026-09-14', published_publisher=publisher,
                             published_street=street, published_barangay=barangay)
                if not street or not city or not province:
                    row['review_reasons'].append('incomplete_doe_address')
                rows.append(row)
    if not numbers or numbers != list(range(1, len(numbers)+1)):
        raise ValueError('DOE numbered rows missing, duplicated or reordered')
    if expected_rows is not None and len(numbers) != expected_rows:
        raise ValueError('DOE source row count changed')
    return rows, dict(excluded)


def parse_mygas(content):
    root = html.fromstring(content)
    tables = root.xpath('//table[@id="stationTable"]')
    if len(tables) != 1:
        raise ValueError('MyGas directory schema changed')
    rows = []
    for node in tables[0].xpath('./tbody/tr'):
        cells = node.xpath('./td')
        if len(cells) != 3:
            raise ValueError('MyGas table width changed')
        name, address = [clean(v.text_content()) for v in cells[:2]]
        if not name or not name.startswith('MY GAS '):
            raise ValueError('Unexpected MyGas station name')
        links = cells[2].xpath('.//a/@href')
        coords = None
        if len(links) == 1:
            url = urlparse(links[0])
            query = parse_qs(url.query).get('q', [''])[0].split(',')
            if url.scheme == 'https' and url.netloc == 'www.google.com' and url.path == '/maps' and len(query) == 2:
                coords = point(*query)
        row = record('my-gas', name, address, MYGAS_SOURCE,
                     lat=coords[0] if coords else None, lon=coords[1] if coords else None)
        if not coords or not 4 <= coords[0] <= 22.5 or not 116 <= coords[1] <= 127:
            row['latitude'] = row['longitude'] = None
            row['review_reasons'].append('invalid_published_map_coordinates')
        rows.append(row)
    if not rows:
        raise ValueError('Empty MyGas directory')
    return rows


def parse_phoenix_luzon(content):
    root = html.fromstring(content)
    title = ' '.join(root.xpath('//title/text()'))
    if 'Participating Phoenix Stations' not in title:
        raise ValueError('Phoenix participating-list identity changed')
    paragraphs = [clean(node.text_content().replace('\u200b', '')) for node in root.xpath('//p')]
    paragraphs = [v for v in paragraphs if v]
    rows, section, index = [], None, 0
    while index < len(paragraphs):
        value = paragraphs[index]
        if value in {'NCR', 'LUZON PROVINCIAL'}:
            section = value
        if value.startswith('PHOENIX '):
            address = paragraphs[index+1] if index+1 < len(paragraphs) else None
            # Several published addresses also start PHOENIX; all caps titles are
            # distinguished by the sequential source pairs, not a name heuristic.
            if not section or not address:
                raise ValueError('Phoenix Luzon station missing address/section')
            if address.startswith('PHOENIX ') and not any(
                    token in address for token in ['GAS STATION ', 'TABING BAKOD,', 'HIGHWAY ']):
                raise ValueError('Phoenix Luzon consecutive names need review')
            rows.append(record('phoenix', value, address, PHOENIX_LUZON_SOURCE,
                               directory_region=section))
            index += 2
        else:
            index += 1
    if not rows:
        raise ValueError('Empty Phoenix Luzon list')
    return rows


def hold_community_collisions(rows, existing):
    """Conservatively hold same-brand named branches already reported by users.

    New text-only registers cannot prove coordinate separation from an existing
    user station. A normalized branch-name containment needs manual reconciliation.
    """
    def address_words(value):
        ignored = {'brgy', 'barangay', 'city', 'road', 'rd', 'street', 'st', 'avenue', 'ave',
                   'boulevard', 'blvd', 'highway', 'hwy', 'metro', 'manila', 'north', 'south',
                   'east', 'west', 'cor', 'corner', 'the', 'of'}
        return {w for w in re.findall(r'[a-z0-9]+', normalized(value)) if len(w) >= 3 and w not in ignored}

    result = []
    for original in rows:
        row = dict(original, review_reasons=list(original['review_reasons']))
        name = normalized(row['name'])
        matches = []
        for old in existing:
            if old['company_slug'] != row['company_slug'] or old.get('source_type') != 'community':
                continue
            old_name = normalized(old.get('name'))
            same_name = min(len(name), len(old_name)) >= 8 and (name in old_name or old_name in name)
            old_words = address_words(old.get('address'))
            same_address = len(old_words) >= 2 and old_words <= address_words(row['address'])
            if same_name or same_address:
                matches.append(old['id'])
        if matches:
            row['review_reasons'].append('possible_community_branch_name')
            row['community_match_ids'] = matches
        result.append(row)
    return result


def review_previous_holds(preview, shell_details):
    """Resolve only evidence-backed cases; preserve every other review reason."""
    rows = []
    for original in preview['stations']:
        if not original['review_reasons']:
            continue
        row = dict(original, review_reasons=list(original['review_reasons']))
        if row['company_slug'] == 'shell':
            path = shell_details/(row['source_station_id']+'.html')
            if path.exists():
                detail = shell_props(path.read_bytes())['location']
                coords = point(detail.get('lat'), detail.get('lng'))
                if (str(detail['location_id']) != row['source_station_id'] or clean(detail['name']) != row['name']
                        or detail['country_code'] != 'PH'):
                    raise ValueError('Shell detail identity mismatch')
                motor_fuels = SHELL_MOTOR_FUELS.intersection(detail.get('fuels') or [])
                if detail.get('site_status') == 'Active' and motor_fuels and coords:
                    row.update(latitude=coords[0], longitude=coords[1], published_fuels=detail['fuels'])
                    row['review_reasons'] = [r for r in row['review_reasons'] if r not in {'unknown_shell_site_type', 'shared_address'}]
                    row['review_resolution'] = 'Active PH fuel branch verified on its official detail page; published pin retained.'
        elif row['company_slug'] == 'caltex' and row['review_reasons'] == ['shared_address']:
            # Fresh audit below still holds identical or nearby pins. Separate
            # published branch IDs/pins can distinguish a short shared address.
            row['review_reasons'] = []
            row['review_resolution'] = 'Distinct locator IDs and separated published pins required by fresh audit.'
        elif row['company_slug'] == 'ptt' and row['review_reasons'] == ['invalid_published_coordinates']:
            # A valid published address remains useful for price reporting.
            # Bad/inverted GPS is deliberately omitted, never swapped/geocoded.
            if row['latitude'] is not None or row['longitude'] is not None or not row['address']:
                raise ValueError('PTT invalid-coordinate review contract changed')
            row['review_reasons'] = []
            row['review_resolution'] = 'Address-only branch; invalid published GPS omitted. No inferred replacement.'
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--existing-json', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--prior-preview', type=Path)
    args = parser.parse_args()
    folder = args.source_dir
    import pdfplumber
    pdf_path = folder/'doe-subsidy-2026-09-14.pdf'
    with pdfplumber.open(pdf_path) as pdf:
        heading = pdf.pages[0].extract_text()
        if '14 SEPTEMBER 2026' not in heading or 'FUEL SUBSIDY PROGRAM' not in heading:
            raise ValueError('DOE PDF identity changed')
        if len(pdf.pages) != 138:
            raise ValueError('DOE PDF page count changed')
        doe, excluded = parse_doe([page.extract_tables() for page in pdf.pages], 2754)
    mygas_path, phoenix_path = folder/'mygas.html', folder/'phoenix-luzon.html'
    rows = doe + parse_mygas(mygas_path.read_bytes()) + parse_phoenix_luzon(phoenix_path.read_bytes())
    evidence = [pdf_path, mygas_path, phoenix_path, args.existing_json]
    if args.prior_preview:
        prior = json.loads(args.prior_preview.read_bytes())
        for filename, digest in prior['source_hashes'].items():
            if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != digest:
                raise ValueError('Prior source evidence changed')
        rows += review_previous_holds(prior, folder/'shell-details')
        evidence += [args.prior_preview] + list((folder/'shell-details').glob('*.html'))
        evidence += [Path(filename) for filename in prior['source_hashes']]
    existing = json.loads(args.existing_json.read_bytes())
    from .expansion import audit
    result = audit(hold_community_collisions(rows, existing), existing)
    result.update(audited_at=sync_time(), excluded_doe_publishers=excluded,
                  coverage='Published directories and subsidy participants; not a complete national census.',
                  source_hashes={str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                                 for path in evidence})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
