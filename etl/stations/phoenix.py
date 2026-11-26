"""Offline Phoenix official-source collection and conservative additive preview.

Coordinates/products are retained only when published. Similar branch names are
held for review, never treated as permission to merge or overwrite a live UUID.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

from lxml import html

from .brands import parse_phoenix, record
from .completion import parse_phoenix_luzon, hold_community_collisions
from .expansion import audit
from .seaoil import sync_time

PHOENIX_PAGES = {
    'freedom': 'https://www.phoenixfuels.ph/your-freedom-drive-deserves-a-treat/',
    'partners': 'https://www.phoenixfuels.ph/locator-partner/',
    'dito': 'https://sites.google.com/phoenixfuels.ph/ditoboothsatphoenix/home',
    'grab': 'https://sites.google.com/phoenixfuels.ph/ptc-grab-participating-station/home',
}


def text(node):
    return ' '.join(node.text_content().replace('\u200b', '').split())


def parse_freedom(content):
    tree = html.fromstring(content)
    if 'Your Freedom Drive Deserves a Treat' not in tree.xpath('string(//h1)'):
        raise ValueError('Phoenix fuel-promotion identity changed')
    tables = tree.xpath('//table')
    if len(tables) != 1:
        raise ValueError('Expected one participating-stations table')
    rows = []
    for tr in tables[0].xpath('.//tr'):
        cells = [text(c) for c in tr.xpath('./th|./td')]
        if len(cells) != 2 or not all(cells):
            raise ValueError('Incomplete Phoenix participating station')
        rows.append(record('phoenix', *cells, PHOENIX_PAGES['freedom']))
    if not rows:
        raise ValueError('Empty Phoenix fuel-promotion list')
    return rows


def parse_partners(content):
    tree = html.fromstring(content)
    if 'Be a Locator Partner' not in tree.xpath('string(//h1)'):
        raise ValueError('Phoenix locator-partner identity changed')
    rows = []
    for node in tree.xpath('//div[div[contains(@class,"col-xs-4")]]'):
        cells = [text(c) for c in node.xpath('./div[not(contains(@class,"clearfix"))]')]
        if cells and cells[0] == 'STATION NAME':
            continue
        if len(cells) != 6 or not cells[0] or not cells[1]:
            raise ValueError('Incomplete Phoenix lease-site row')
        try:
            lat, lon = map(float, cells[2].split(','))
            if not 4 <= lat <= 22.5 or not 116 <= lon <= 127:
                lat = lon = None
        except ValueError:
            lat = lon = None
        rows.append(record('phoenix', cells[0], cells[1], PHOENIX_PAGES['partners'],
                           lat=lat, lon=lon, directory_region=cells[3]))
    if not rows:
        raise ValueError('Empty Phoenix lease-site list')
    # Repeated lease opportunities are not additional physical stations.
    groups = {}
    for row in rows:
        old = groups.get(row['directory_key'])
        if old and (old['latitude'], old['longitude']) != (row['latitude'], row['longitude']):
            raise ValueError('Repeated Phoenix lease site has conflicting pins')
        groups[row['directory_key']] = row
    return list(groups.values()), len(rows)


def parse_dito(content):
    tree = html.fromstring(content)
    if 'DITO BOOTHS AT PHOENIX' not in tree.xpath('string(//title)'):
        raise ValueError('Phoenix DITO list identity changed')
    lines = [text(p) for p in tree.xpath('//p') if text(p)]
    rows, index = [], 0
    while index < len(lines):
        name = lines[index]
        if name.startswith('PHOENIX ') and not name.startswith('PHOENIX GAS STATION'):
            address = lines[index + 1] if index + 1 < len(lines) else ''
            if not address or (address.startswith('PHOENIX ') and not address.startswith('PHOENIX GAS STATION')):
                raise ValueError('Phoenix DITO station missing address')
            rows.append(record('phoenix', name, address, PHOENIX_PAGES['dito']))
            index += 2
        else:
            index += 1
    if not rows:
        raise ValueError('Empty Phoenix DITO list')
    return rows


def parse_grab(content):
    tree = html.fromstring(content)
    if 'PTC-Grab participating stations' not in tree.xpath('string(//title)'):
        raise ValueError('Phoenix Grab list identity changed')
    rows = []
    for li in tree.xpath('//li[not(.//li)]'):
        line = text(li)
        if not line.lower().startswith('phoenix '):
            continue
        pair = re.split(r'\s[-–]\s*', line, maxsplit=1)
        rows.append(record('phoenix', pair[0], pair[1] if len(pair) == 2 else None, PHOENIX_PAGES['grab']))
    if not rows:
        raise ValueError('Empty Phoenix Grab list')
    return rows


def branch_key(name):
    value = ''.join(c for c in unicodedata.normalize('NFKD', name) if not unicodedata.combining(c))
    value = value.replace('\u200b', '').lower().strip()
    value = re.sub(r'^(?:pnx retail (?:codo |dodo |cojo )?|pspc (?:pnx |per )?afa |phoenix[. ]*)', '', value)
    return re.sub(r'[^a-z0-9]', '', value)


def fingerprint(row):
    fields = {k: row.get(k) for k in ('name', 'address', 'source_url', 'latitude', 'longitude')}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def apply_reviews(rows, registry):
    available = {fingerprint(row) for row in rows}
    excluded = set()
    for entry in registry['groups']:
        selected = entry['selected']
        aliases = set(entry['excluded'])
        if not entry.get('reason') or selected not in available or not aliases <= available or selected in aliases:
            raise ValueError('Phoenix review no longer matches the source evidence')
        excluded.update(aliases)
    return [r for r in rows if fingerprint(r) not in excluded], [r for r in rows if fingerprint(r) in excluded]

# Potential aliases only: these trigger review, never automatic physical merges.
POSSIBLE_ALIASES = {
    'tungkongmangga': 'tungkong', 'enrile': 'enrileave', 'aranetaaveii': 'garanetaaveii',
    'balagtas2': 'balagtas', 'toril1': 'toril', 'torres': 'ftorres', 'guagua': 'guaguaogroad',
    'malanday1': 'malanday', 'malanday2': 'malanday2mhdelpilar', 'northedsa': 'edsa',
    'soongmactan': 'soong', 'cabantian': 'cabantian1', 'tablon1': 'tablon',
    'liwayway': 'liwaywaytagum', 'gabicordova': 'cordova', 'calaca': 'calaca3',
    'potrero': 'malabon', 'alabangzapotepamplona': 'alabang', 'lanangmega': 'lanang',
    'sucatnearsmsucat': 'sucat', 'bulua': 'bulua1',
    'naiakabihasnan': 'naia',
    'eastservicerd': 'eservicerd', 'amangrodriguez': 'pasig', 'lsumulong': 'antipolo',
    'garanetaavesantol': 'garanetaaveii', 'northedsasouthbound': 'edsa',
    'mindanaoaveextnnearnlexexit': 'mindanaoave', 'molino1': 'molino1',
    'molinoblvdnearvcentral': 'molino1', 'molinordneargergetownheightsubd': 'molino4',
    'srp1smseasidebound': 'srp1', 'matinamcarthurhighway': 'matina',
    'westservicerdintercityvillage': 'westservicerd',
    'westservicerdrizalvillage': 'westservicerd', 'kawitcentennialhighway': 'kawit3',
}


def conservative_preview(rows, existing):
    by_key = {}
    for row in rows:
        # Exact repeated name/address is the same source identity. Keep provenance.
        key = row['directory_key']
        if key in by_key:
            by_key[key].setdefault('supporting_sources', []).append(row['source_url'])
        else:
            by_key[key] = dict(row, review_reasons=list(row['review_reasons']))
    known = {r['directory_key'] for r in existing if r['company_slug'] == 'phoenix' and r.get('directory_key')}
    canonical = lambda name: POSSIBLE_ALIASES.get(branch_key(name), branch_key(name))
    new = [r for r in by_key.values() if r['directory_key'] not in known]
    represented = [r for r in by_key.values() if r['directory_key'] in known]
    for row in new:
        matches = [r['id'] for r in existing if r['company_slug'] == 'phoenix' and canonical(r['name']) == canonical(row['name'])]
        if matches:
            row['review_reasons'].append('possible_existing_branch_name')
            row['branch_match_ids'] = matches
    # New name variants also need a reviewed canonical choice before import.
    groups = {}
    for row in new:
        groups.setdefault(canonical(row['name']), []).append(row)
    for group in groups.values():
        if len(group) > 1:
            for row in group:
                row['review_reasons'].append('multiple_source_branch_variants')
    checked = audit(hold_community_collisions(new, existing), existing)
    return represented + checked['stations'], checked['summary']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--existing-json', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--review', type=Path)
    args = parser.parse_args()
    folder = args.source_dir
    partners, lease_rows = parse_partners((folder/'partners.html').read_bytes())
    rows = (parse_phoenix((folder/'vismin.html').read_text()) + parse_phoenix_luzon((folder/'luzon.html').read_bytes())
            + parse_freedom((folder/'freedom.html').read_bytes()) + partners
            + parse_dito((folder/'dito.html').read_bytes()) + parse_grab((folder/'grab.html').read_bytes()))
    raw_rows = rows
    exclusions = []
    if args.review:
        rows, exclusions = apply_reviews(rows, json.loads(args.review.read_text()))
    stations, summary = conservative_preview(rows, json.loads(args.existing_json.read_text()))
    summary.update(source_rows=len(raw_rows), retained_source_rows=len(rows), reviewed_source_aliases=len(exclusions), partner_lease_rows=lease_rows,
                   source_counts=dict(Counter(r['source_url'] for r in raw_rows)))
    files = [folder/(name+'.html') for name in ['vismin', 'luzon', 'freedom', 'partners', 'dito', 'grab']] + [args.existing_json]
    if args.review:
        files.append(args.review)
    result = dict(generated_at=sync_time(), source_hashes={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in files},
                  summary=summary, stations=stations, reviewed_source_aliases=exclusions)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
