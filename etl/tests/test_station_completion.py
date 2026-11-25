from copy import deepcopy

import pytest

from stations.completion import (DOE_SOURCE, parse_doe, parse_mygas,
                                parse_phoenix_luzon, hold_community_collisions, review_previous_holds)
from stations.import_directory import payload
from stations.brands import record
from stations.expansion import audit
import json


def doe_row(number='1', publisher='TWA, INC. (Flying V)'):
    return [number, 'NCR', 'Metro Manila', 'Caloocan City', '171',
            '171 Bagumbong Road, Caloocan City', publisher, 'FV Marketing Corporation']


def test_doe_reads_complete_numbered_table_and_keeps_source_row_out_of_identity():
    rows, _ = parse_doe([[[['Item\nNo.', 'Region'], doe_row()]]], 1)
    row = rows[0]
    assert row['company_slug'] == 'flying-v' and row['published_row'] == 1
    assert row['directory_key'].startswith('address:') and row['source_station_id'] is None
    assert row['latitude'] is None and row['fuel_types'] is None
    assert row['address'] == '171 Bagumbong Road, Caloocan City, Metro Manila'
    assert row['source_url'] == DOE_SOURCE


@pytest.mark.parametrize('rows', [[doe_row('2')], [doe_row(), doe_row()], [doe_row()[:-1]]])
def test_doe_fails_closed_on_missing_rows_duplicate_numbers_or_schema_change(rows):
    with pytest.raises(ValueError):
        parse_doe([[rows]])


def test_doe_excludes_unmapped_publishers_without_guessing_a_brand():
    rows, excluded = parse_doe([[[doe_row(publisher='UNKNOWN')]]], 1)
    assert rows == [] and excluded == {'UNKNOWN': 1}


def mygas(href):
    return '<table id="stationTable"><tbody><tr><td>MY GAS TEST</td><td>Main Road, Davao City</td><td><a href="'+href+'">Map</a></td></tr></tbody></table>'


def test_mygas_uses_only_published_coordinates_and_holds_invalid_map_links():
    valid = parse_mygas(mygas('https://www.google.com/maps?q=7.1,125.6'))[0]
    assert valid['latitude'] == 7.1 and valid['longitude'] == 125.6
    for link in ['https://wrong.example/maps?q=7.1,125.6', 'https://www.google.com/maps?q=125.6,7.1', 'https://www.google.com/maps?q=0,0']:
        row = parse_mygas(mygas(link))[0]
        assert row['latitude'] is None and row['review_reasons']


def test_phoenix_handles_invisible_spaces_and_rejects_missing_address():
    start = '<title>Participating Phoenix Stations</title><p>NCR</p>'
    row = parse_phoenix_luzon(start+'<p>\u200bPHOENIX TEST</p><p>Test Road, Quezon City</p>')[0]
    assert row['name'] == 'PHOENIX TEST'
    with pytest.raises(ValueError):
        parse_phoenix_luzon(start+'<p>PHOENIX TEST</p><p>PHOENIX ANOTHER</p>')


def test_existing_community_address_is_held_even_when_operator_name_differs():
    rows, _ = parse_doe([[[doe_row()]]])
    before = deepcopy(rows)
    old = dict(id='keep-uuid', company_slug='flying-v', source_type='community',
               name='Flying V Bagumbong Road North Caloocan', address='Bagumbong Rd, North Caloocan')
    held = hold_community_collisions(rows, [old])
    assert held[0]['review_reasons'] == ['possible_community_branch_name']
    assert held[0]['community_match_ids'] == ['keep-uuid'] and rows == before
    assert hold_community_collisions(rows, [dict(old, company_slug='shell')])[0]['review_reasons'] == []


def test_doe_import_provenance_requires_exact_register_url():
    rows, _ = parse_doe([[[doe_row()]]])
    row = rows[0]
    mapping = {('flying-v', row['directory_key']): dict(address=row['address'], region_code='NCR')}
    assert payload(row, {'flying-v': 'brand'}, {'NCR': 'region'}, mapping, 'now')['region_id'] == 'region'
    row['source_url'] = 'https://doe.gov.ph/unrelated-page'
    with pytest.raises(ValueError):
        payload(row, {'flying-v': 'brand'}, {'NCR': 'region'}, mapping, 'now')


def test_shared_addresses_need_separated_pins_and_independent_brand_ids():
    def rows(brand, longitude):
        return [record(brand, 'Branch A', 'Main Road', 'https://example.com', 'a', 14.5, 121),
                record(brand, 'Branch B', 'Main Road', 'https://example.com', 'b', 14.5, longitude)]
    assert audit(rows('shell', 121.02), [])['summary']['candidate_new_records'] == 2
    assert audit(rows('shell', 121.00001), [])['summary']['review_required'] == 2
    assert audit(rows('ptt', 121.02), [])['summary']['review_required'] == 2
    missing = rows('caltex', 121.02);missing[0]['latitude'] = None
    assert audit(missing, [])['summary']['review_required'] == 2


def test_ptt_review_keeps_bad_gps_null_and_preserves_other_conflicts(tmp_path):
    row = record('ptt', 'PTT Test', 'Test Road, Tarlac', 'https://www.pttphilippines.com/find-a-station', '1')
    row['review_reasons'] = ['invalid_published_coordinates']
    reviewed = review_previous_holds({'stations': [row]}, tmp_path)[0]
    assert reviewed['review_reasons'] == [] and reviewed['latitude'] is None
    row['review_reasons'].append('shared_address')
    assert review_previous_holds({'stations': [row]}, tmp_path)[0]['review_reasons'] == row['review_reasons']


def test_shell_review_requires_exact_identity_country_active_fuel_and_valid_pin(tmp_path):
    row = record('shell', 'SH TEST', 'Main Road', 'https://find.shell.com/ph/fuel/one-sh-test', 'one')
    row['review_reasons'] = ['unknown_shell_site_type']
    detail = dict(location_id='one', name='SH TEST', country_code='PH', site_status='Active',
                  lat=14.5, lng=121, fuels=['fuelsave_regular_diesel'])
    def save(value):
        (tmp_path/'one.html').write_text('<script data-page="app" type="application/json">'+json.dumps({'props': {'location': value}})+'</script>')
    save(detail)
    assert review_previous_holds({'stations': [row]}, tmp_path)[0]['review_reasons'] == []
    for change in [dict(site_status='Closed'), dict(fuels=[]), dict(fuels=['shell_recharge']), dict(fuels=['unknown_future_type']), dict(lat=None)]:
        save(detail | change)
        assert review_previous_holds({'stations': [row]}, tmp_path)[0]['review_reasons']
    save(detail | dict(location_id='different'))
    with pytest.raises(ValueError):
        review_previous_holds({'stations': [row]}, tmp_path)
