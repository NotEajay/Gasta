import json
from copy import deepcopy

import pytest

from stations.brands import parse_cleanfuel, parse_jetti, parse_phoenix, parse_ptt, parse_shell
from stations.shell import collect


def payload(props):
    return '<html><script data-page="app" type="application/json">'+json.dumps({'props': props})+'</script></html>'


def shell_station(**changes):
    return {'id': '123', 'name': 'SH SAMPLE', 'formatted_address': 'Sample Road\nQuezon City\nPH',
            'link': '/ph/fuel/123-sh-sample', 'logo_url': 'https://assets.example/conventional-fuel-site.png'} | changes


def shell_input(*items):
    return dict(complete=True, expected_cities=1, cities=[{'locations': list(items)}])


def test_shell_excludes_pure_ev_sites_without_inventing_coordinates():
    rows, excluded = parse_shell(shell_input(shell_station(), shell_station(id='456', logo_url='https://assets.example/destination-charging-ev.png')))
    assert len(rows) == 1 and sum(excluded.values()) == 1
    assert rows[0]['latitude'] is None and rows[0]['fuel_types'] is None


@pytest.mark.parametrize('change', [{'link': 'https://evil.invalid/ph/fuel/123-test'}, {'formatted_address': 'Bangkok\nTH'}])
def test_shell_rejects_wrong_host_or_country(change):
    with pytest.raises(ValueError):
        parse_shell(shell_input(shell_station(**change)))


def test_shell_incomplete_and_conflicting_id_are_not_certified():
    with pytest.raises(ValueError):
        parse_shell(shell_input() | {'expected_cities': 2})
    with pytest.raises(ValueError):
        parse_shell(shell_input(shell_station(), shell_station(name='Different')))
    rows, _ = parse_shell(shell_input(shell_station(), shell_station()))
    assert len(rows) == 1


def test_shell_unknown_marker_requires_review():
    rows, _ = parse_shell(shell_input(shell_station(logo_url='https://assets.example/new-site-type.png')))
    assert rows[0]['review_reasons'] == ['unknown_shell_site_type']


def test_shell_crawler_uses_cache_and_checks_actual_city_count(tmp_path):
    (tmp_path/'shell.html').write_text(payload({'geographicListProps': {'locations': [{'name': 'Test', 'link': '/ph/fuel/locations/test', 'count': 1}]}}))
    calls = []
    def get(url):
        calls.append(url)
        return payload({'stationListProps': {'locations': [shell_station()]}}).encode()
    assert collect(tmp_path, get)['complete']
    assert collect(tmp_path, get)['complete'] and len(calls) == 1
    (tmp_path/'shell-cities/test.html').write_text(payload({'stationListProps': {'locations': []}}))
    with pytest.raises(ValueError, match='count mismatch'):
        collect(tmp_path, get)


def test_ptt_uses_published_products_and_flags_inverted_coordinates():
    stations = [{'id': 1, 'stationName': 'PTT Sample', 'status': 'operational', 'locationInfo': {'address': 'Sample Road', 'lat': 121, 'lng': 14},
                 'services': {'hasSavePlus': True, 'hasLubricants': True}}]
    flight = '1:' + json.dumps({'allStations': stations})
    markup = '<script>self.__next_f.push('+json.dumps([1, flight])+')</script>'
    rows, _ = parse_ptt(markup)
    assert rows[0]['latitude'] is None and rows[0]['longitude'] is None
    assert rows[0]['fuel_types'] == ['Save+ Diesel']
    assert rows[0]['review_reasons'] == ['invalid_published_coordinates']
    assert rows[0]['operating_hours'] is None


def test_cleanfuel_preserves_street_without_copying_broken_city_default():
    item = {'id': 1, 'country': 'United States', 'type': 'gd_place', 'status': 'publish', 'link': 'https://www.cleanfuel.ph/location/test/',
            'title': {'rendered': 'Sample &amp; Branch'}, 'street': 'Quezon City Road', 'city': 'Pasig', 'latitude': '14.6', 'longitude': '121'}
    rows = parse_cleanfuel([item], {'total': 1, 'items': [{'m': '1'}]})
    assert rows[0]['city'] is None and rows[0]['name'] == 'Cleanfuel Sample & Branch'
    assert rows[0]['review_reasons'] == ['source_country_mismatch']
    with pytest.raises(ValueError):
        parse_cleanfuel([item], {'total': 2, 'items': [{'m': '1'}]})


def test_phoenix_address_can_start_with_brand_without_becoming_another_station():
    markup = '<html><title>LIST OF OPERATIONAL PHOENIX STATIONS</title><p>Mindanao</p><p>Phoenix Villanueva</p><p>Phoenix Station, Brgy Katipunan</p></html>'
    rows = parse_phoenix(markup)
    assert len(rows) == 1 and rows[0]['address'] == 'Phoenix Station, Brgy Katipunan'
    assert rows[0]['latitude'] is None


def test_jetti_uses_address_fields_without_reading_discounts_as_prices_or_fuel_types():
    page = [[['1', 'JETTI SAMPLE', 'Province', 'City', 'Barangay', 'Main Road', '2.00', '2.00', '2.00', '']]]
    rows = parse_jetti([page])
    assert rows[0]['address'] == 'Main Road, Barangay, City, Province'
    assert rows[0]['fuel_types'] is None and 'price' not in rows[0]
    bad = deepcopy(page);bad[0][0][0] = '2'
    with pytest.raises(ValueError):
        parse_jetti([bad])
