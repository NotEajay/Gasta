"""Normalize cached public Unioil locator city lists and branch map metadata.

Collection uses the ordinary browser locator and its published GET requests, with
no login, price extraction, private API, or inferred coordinates. The publisher's
broken/empty areas remain explicit coverage issues rather than a completeness claim.
"""
from __future__ import annotations

import re
import hashlib
import json
import argparse
from pathlib import Path

from lxml import html

from .brands import record
from .expansion import point
from .seaoil import clean

SOURCE = 'https://www.unioil.com/stations'


def fingerprint(row):
    fields = ['id', 'company_slug', 'name', 'address', 'source_url', 'source_station_id', 'directory_key']
    return hashlib.sha256(json.dumps({key: row.get(key) for key in fields}, sort_keys=True).encode()).hexdigest()


def apply_crosswalk(rows, existing, decisions):
    if decisions.get('version') != 1 or not decisions.get('reviewed_at'):
        raise ValueError('Invalid Unioil source crosswalk')
    by_id = {row['id']: row for row in existing}
    source = {row['source_station_id']: row for row in rows}
    seen, reviewed = set(), {}
    for decision in decisions['records']:
        source_id = decision['source_station_id']
        row, target = source.get(source_id), by_id.get(decision['existing_station_id'])
        if (source_id in seen or not row or not target or not decision.get('reason')
                or decision.get('status') not in {'covered', 'pending_review'}
                or target['company_slug'] != 'unioil'
                or fingerprint(row) != decision['source_fingerprint']
                or fingerprint(target) != decision['existing_fingerprint']):
            raise ValueError('Unioil reviewed source/target identity changed')
        seen.add(source_id)
        reviewed[source_id] = decision
    result = []
    for original in rows:
        row = dict(original, review_reasons=list(original['review_reasons']))
        decision = reviewed.get(row['source_station_id'])
        if decision:
            row['review_reasons'].append('covered_by_existing_station' if decision['status'] == 'covered' else 'possible_cross_source_station')
            row['existing_match_ids'] = [decision['existing_station_id']]
            row['review_resolution'] = decision['reason']
        result.append(row)
    return result


def omit_reviewed_coordinates(rows, review):
    """Explicit source-bound decisions retain valid addresses with null GPS."""
    if review.get('version') != 1 or not review.get('reviewed_at'):
        raise ValueError('Invalid coordinate review')
    decisions = {}
    for item in review['records']:
        key = item['source_station_id']
        if key in decisions or not item.get('reason'):
            raise ValueError('Invalid/duplicate coordinate decision')
        decisions[key] = item
    result, seen = [], set()
    for original in rows:
        row = dict(original)
        decision = decisions.get(row['source_station_id'])
        if decision:
            if fingerprint(row) != decision['source_fingerprint'] or [row['latitude'], row['longitude']] != decision['published_coordinates']:
                raise ValueError('Reviewed Unioil coordinates/listing changed')
            row.update(latitude=None, longitude=None, coordinate_warning=decision['reason'])
            seen.add(row['source_station_id'])
        result.append(row)
    if seen != set(decisions):
        raise ValueError('Reviewed Unioil branch no longer listed')
    return result


def parse_city(content):
    rows = []
    for node in html.fromstring('<ul>'+content+'</ul>').xpath('//li'):
        if not node.get('onclick') and clean(node.text_content()) == 'No record found.':
            continue
        match = re.fullmatch(r"chgStation\((\d+),'([A-Za-z0-9]+)'\)", node.get('onclick', ''))
        name = clean(node.xpath('string(.//div[@class="station-details"]/p)'))
        address = clean(node.xpath('string(.//div[@class="station-details"]/span)'))
        if not match or not name or not address:
            raise ValueError('Unexpected Unioil station-list schema')
        rows.append(dict(id=match[1], code=match[2], name=name, address=address))
    return rows


def parse_collected(data, folder: Path):
    if data.get('source') != SOURCE or not isinstance(data.get('issues'), list):
        raise ValueError('Unioil source/coverage metadata changed')
    listed = {}
    for city in data['cities']:
        filename = city['file']
        if not re.fullmatch(r'stations-\d+-\d+-\d+\.html', filename):
            raise ValueError('Unexpected Unioil cache path')
        records = parse_city((folder/filename).read_text())
        if len(records) != city['count']:
            raise ValueError('Unioil city count mismatch')
        for row in records:
            old = listed.get(row['id'])
            if old and old != row:
                raise ValueError('Conflicting Unioil branch identity')
            listed[row['id']] = row
    captured = {row['id']: row for row in data['stations']}
    if not listed or set(listed) != set(captured) or len(captured) != len(data['stations']):
        raise ValueError('Unioil city/detail traversal incomplete')
    result = []
    for source_id, item in listed.items():
        cached = captured[source_id]
        if any((clean(cached.get(k)) if k in {'name', 'address'} else cached.get(k)) != v for k, v in item.items()):
            raise ValueError('Unioil collected identity differs from cached city list')
        # Read map attributes directly from the corresponding response, not a
        # possibly stale manifest field. No geocoding or coordinate swapping.
        detail = folder/('detail-'+source_id+'.html')
        root = html.fromstring(detail.read_text())
        nodes = root.xpath('//*[@id="mapcoords"]')
        if len(nodes) != 1:
            raise ValueError('Unioil branch map detail missing')
        attrs = nodes[0].attrib
        if (clean(attrs.get('data-name')) != item['name']
                or (clean(attrs.get('data-address')) or '').strip('" ') != item['address'].strip('" ')):
            raise ValueError('Unioil branch detail identity/address mismatch')
        coords = point(attrs.get('data-lat'), attrs.get('data-lng'))
        if coords and not (4 <= coords[0] <= 22.5 and 116 <= coords[1] <= 127):
            coords = None
        name = item['name'] if item['name'].lower().startswith('unioil ') else 'Unioil '+item['name']
        row = record('unioil', name, item['address'], SOURCE, source_id,
                     coords[0] if coords else None, coords[1] if coords else None,
                     published_branch_code=item['code'])
        if not coords:
            row['coordinate_warning'] = 'Published GPS omitted; address-only branch.'
        result.append(row)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--existing-json', type=Path, required=True)
    parser.add_argument('--crosswalk', type=Path, required=True)
    parser.add_argument('--coordinate-review', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    collected_path = args.source_dir/'collected.json'
    data = json.loads(collected_path.read_bytes())
    rows = parse_collected(data, args.source_dir)
    if args.coordinate_review:
        rows = omit_reviewed_coordinates(rows, json.loads(args.coordinate_review.read_bytes()))
    existing = json.loads(args.existing_json.read_bytes())
    rows = apply_crosswalk(rows, existing, json.loads(args.crosswalk.read_bytes()))
    from .expansion import audit
    from .completion import hold_community_collisions
    from .seaoil import sync_time
    result = audit(hold_community_collisions(rows, existing), existing)
    evidence = [collected_path, args.existing_json, args.crosswalk] + sorted(args.source_dir.glob('*.html'))
    if args.coordinate_review:
        evidence.append(args.coordinate_review)
    result.update(audited_at=sync_time(), coverage_issues=data['issues'],
                  confirmed_existing_coverage=sum('covered_by_existing_station' in row['review_reasons'] for row in rows),
                  source_hashes={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in evidence})
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
