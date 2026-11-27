import pytest
from stations.brands import parse_phoenix, record
from stations.phoenix import (parse_freedom, parse_partners, parse_dito, parse_grab,
                             conservative_preview, apply_reviews, fingerprint, PHOENIX_PAGES)
from stations.import_directory import payload


def test_operational_names_with_invisible_prefixes_and_punctuation():
    rows = parse_phoenix('<title>OPERATIONAL PHOENIX STATIONS</title><p>Mindanao</p>'
                         '<p>\u200bPhoenix Tandag</p><p>Tandag City</p>'
                         '<p>Phoenix. Catalunan Grande</p><p>Davao City</p>'
                         '<p>Phoenix Villanueva</p><p>Phoenix Station, Katipunan, Villanueva</p>')
    assert len(rows) == 3 and rows[0]['name'] == 'Phoenix Tandag'
    assert rows[-1]['address'].startswith('Phoenix Station,')


def test_promotion_rejects_lpg_pages_and_incomplete_tables():
    with pytest.raises(ValueError):
        parse_freedom('<h1>Bawat Refill May Pa-Grocery</h1><table><tr><td>LPG</td><td>Cebu</td></tr></table>')
    with pytest.raises(ValueError):
        parse_freedom('<h1>Your Freedom Drive Deserves a Treat</h1><table><tr><td>PNX</td></tr></table>')
    rows = parse_freedom('<h1>Your Freedom Drive Deserves a Treat</h1><table><tr><td>PNX PUAN</td><td>Puan, Davao City</td></tr></table>')
    assert len(rows) == 1 and rows[0]['fuel_types'] is None and rows[0]['latitude'] is None


def lease(pin='14.5, 121.0'):
    return '<div>' + ''.join(f'<div class="col-xs-4 col-sm-2">{v}</div>' for v in ['PNX Site', 'Makati City', pin, 'LUZON', '50 sqm', 'LEASE']) + '</div>'


def test_repeated_lease_spaces_are_one_station_and_conflicting_pins_fail():
    rows, count = parse_partners('<h1>Be a Locator Partner</h1>' + lease() + lease())
    assert count == 2 and len(rows) == 1 and rows[0]['latitude'] == 14.5
    with pytest.raises(ValueError):
        parse_partners('<h1>Be a Locator Partner</h1>' + lease() + lease('14.6, 121.1'))
    rows, _ = parse_partners('<h1>Be a Locator Partner</h1>' + lease('invalid'))
    assert rows[0]['latitude'] is None and rows[0]['longitude'] is None


def test_dito_pairs_and_grab_missing_address_are_not_guessed():
    rows = parse_dito('<title>DITO BOOTHS AT PHOENIX</title><p>PHOENIX MINTAL 2</p><p>Sto Nino, Tugbok, Davao City</p>')
    assert rows[0]['name'] == 'PHOENIX MINTAL 2'
    with pytest.raises(ValueError):
        parse_dito('<title>DITO BOOTHS AT PHOENIX</title><p>PHOENIX MINTAL 2</p>')
    rows = parse_grab('<title>PTC-Grab participating stations</title><ol><li>Phoenix Babag</li><li>Phoenix Pitogo -Bo. Pitogo, Cebu</li><li>LPG SUPER Hub - Cebu</li></ol>')
    assert len(rows) == 2 and rows[0]['review_reasons'] == ['missing_address']
    assert rows[1]['address'].startswith('Bo. Pitogo')


def test_aliases_hold_duplicates_and_preserve_existing_station():
    old = dict(record('phoenix', 'PHOENIX MALANDAY', 'McArthur Highway, Valenzuela', PHOENIX_PAGES['dito']), id='stable', source_type='official_directory')
    variant = record('phoenix', 'PNX RETAIL CODO MALANDAY 1', 'Valenzuela City', PHOENIX_PAGES['freedom'])
    rows, summary = conservative_preview([old, variant], [old])
    assert summary['candidate_new_records'] == 0 and rows[0]['id'] == 'stable'
    assert 'possible_existing_branch_name' in rows[1]['review_reasons']


def test_reviews_are_bound_to_source_identity_and_import_sources_are_allowlisted():
    a = record('phoenix', 'Phoenix Area H', 'Area H, Bulacan', PHOENIX_PAGES['dito'])
    b = record('phoenix', 'PNX AREA H', 'Area H, Bulacan', PHOENIX_PAGES['freedom'])
    registry = {'groups': [{'selected': fingerprint(a), 'excluded': [fingerprint(b)], 'reason': 'Same published street.'}]}
    kept, excluded = apply_reviews([a, b], registry)
    assert kept == [a] and excluded == [b]
    b['address'] = 'Another town'
    with pytest.raises(ValueError):
        apply_reviews([a, b], registry)
    mapping = {('phoenix', a['directory_key']): {'address': a['address'], 'region_code': 'NCR'}}
    result = payload(a, {'phoenix': 'company'}, {'NCR': 'region'}, mapping, 'now')
    assert result['region_id'] == 'region' and 'id' not in result and 'price' not in result
    a['source_url'] = 'https://www.phoenixfuels.ph/bawat-refill-may-pa-grocery/'
    with pytest.raises(ValueError):
        payload(a, {'phoenix': 'company'}, {'NCR': 'region'}, mapping, 'now')
