"""Source-ID identity, reviewed distinctness, quarantine and safe-subset regressions."""
import json
from dataclasses import replace
from pathlib import Path

import pytest

from stations.review import DEFAULT_REVIEW_FILE, listing_fingerprint, load_reviews, plan_import
from stations.seaoil import Station, parse_listing
from stations.sync import collect, load_sample
from test_station_directory import Client, DETAIL, LISTING


def pending_station():
    entry = next(iter(load_reviews().values()))
    return Station(name=entry['station_name'], address=entry['address'], source_url=entry['source_url'],
                   source_station_id=entry['source_station_id'], directory_key='source:'+entry['source_station_id'],
                   operating_hours=entry['evidence']['operating_hours'])


def approval(row):
    return {'status': 'approved_distinct', 'reason': 'Official station-specific evidence establishes distinctness',
            'listing_fingerprint': listing_fingerprint(row), 'reviewed_by': 'Test reviewer',
            'reviewed_at': '2026-10-09T00:00:00+00:00', 'evidence': {'test_fixture': 'distinct location evidence'}}


def test_real_manifest_preserves_all_ten_unresolved_source_records():
    registry = load_reviews()
    assert len(registry) == 10
    assert {entry['status'] for entry in registry.values()} == {'pending_review'}
    assert len({entry['pair'] for entry in registry.values()}) == 5
    assert all(entry['evidence']['detail_html_sha256'] for entry in registry.values())
    assert all(entry['source_url'].endswith(source_id) for source_id,entry in registry.items())


def test_known_pending_source_remains_quarantined_when_partner_is_absent():
    row = pending_station()
    plan = plan_import([row])
    assert not plan.eligible and len(plan.quarantined) == 1
    assert plan.quarantined[0]['record']['source_station_id'] == row.source_station_id
    assert plan.quarantined[0]['reason']


def test_safe_rows_upsert_twice_while_quarantine_is_explicit_and_untouched():
    safe = parse_listing(LISTING)[0][0]
    blocked = pending_station()
    client, reports = Client(), []
    for timestamp in ['2026-10-09T00:00:00+00:00','2026-10-10T00:00:00+00:00']:
        assert load_sample(client, [safe,blocked], timestamp, on_report=reports.append) == 1
    assert len(client.records) == 1
    assert ('company',blocked.directory_key) not in client.records
    assert client.records[('company',safe.directory_key)]['last_synced_at'].startswith('2026-10-10')
    assert all(json.loads(report)['quarantined_records'] == 1 for report in reports)
    assert all(json.loads(report)['safe_records'] == 1 for report in reports)
    assert all(json.loads(report)['quarantine'][0]['record']['source_station_id'] == blocked.source_station_id for report in reports)


def test_evidence_approved_distinct_station_ids_can_share_name_address():
    one = parse_listing(LISTING)[0][0]
    two = replace(one, source_station_id='distinct-site', directory_key='source:distinct-site', source_url='https://www.seaoil.com.ph/stations/distinct-site')
    reviews = {row.source_station_id: approval(row) for row in [one,two]}
    plan = plan_import([one,two],reviews)
    assert len(plan.eligible) == 2 and not plan.quarantined
    assert len(plan.warnings) == 1  # The matching-name signal survives approval.
    client = Client()
    for _ in range(2):
        assert load_sample(client,[one,two],'2026-10-09T00:00:00+00:00',reviews=reviews,on_report=lambda report:None) == 2
    assert len(client.records) == 2


def test_approved_listing_change_requires_re_review():
    row = parse_listing(LISTING)[0][0]
    changed = replace(row,address='Different published address')
    plan = plan_import([changed],{row.source_station_id:approval(row)})
    assert not plan.eligible and 'changed' in plan.quarantined[0]['reason']


def test_unknown_ambiguity_quarantines_only_that_pair_not_safe_rows():
    rows = parse_listing(LISTING)[0]
    alias = replace(rows[0],source_station_id='new-alias',directory_key='source:new-alias',source_url='https://www.seaoil.com.ph/stations/new-alias')
    plan = plan_import([*rows,alias],{})
    assert len(plan.eligible) == 4 and len(plan.quarantined) == 2 and len(plan.warnings) == 1
    assert {q['record']['source_station_id'] for q in plan.quarantined} == {rows[0].source_station_id,'new-alias'}


def test_primary_key_collision_or_mismatched_source_url_is_still_fatal():
    row = parse_listing(LISTING)[0][0]
    for batch in [[row,row], [replace(row,directory_key='other-key')], [replace(row,source_url='https://www.seaoil.com.ph/stations/another-id')]]:
        with pytest.raises(ValueError):
            plan_import(batch,{})


@pytest.mark.parametrize('mode',['missing','malformed','duplicate','approval_without_evidence'])
def test_registry_errors_never_disable_quarantine(tmp_path,mode):
    path = tmp_path/'review.json'
    if mode == 'missing':
        with pytest.raises(FileNotFoundError):load_reviews(path)
        return
    manifest = json.loads(DEFAULT_REVIEW_FILE.read_text())
    if mode == 'malformed':manifest['records'][0]['status'] = 'ignore'
    if mode == 'duplicate':manifest['records'].append(manifest['records'][0])
    if mode == 'approval_without_evidence':
        manifest['records'][0]['status'] = 'approved_distinct'
        manifest['records'][0].pop('evidence')
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):load_reviews(path)


def test_collect_retains_quarantine_evidence_without_fetching_blocked_detail():
    blocked = pending_station()
    # One safe card plus a known pending ID; the partner need not be in this page.
    from lxml import html,etree
    card = html.fromstring(LISTING).xpath('//*[@class="station-info-wrapper"]')[0]
    markup = '<html><body>'+etree.tostring(card,encoding='unicode')+f'<div class="station-info-wrapper"><a href="/stations/{blocked.source_station_id}"><h4 fs-cmsfilter-field="name">{blocked.name}</h4><div fs-cmsfilter-field="address">{blocked.address}</div></a></div></body></html>'
    calls=[]
    def get(url):
        calls.append(url)
        if url.endswith('/station-locations'):return markup
        assert url != blocked.source_url
        return DETAIL
    rows,stats = collect(get,limit=0)
    assert len(rows) == 1 and stats['listing_records_parsed'] == 2
    assert stats['quarantined_records'] == 1 and stats['complete_directory']
    assert stats['quarantine'][0]['record']['source_station_id'] == blocked.source_station_id
    assert len(calls) == 2
