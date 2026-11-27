import math
import pytest
from stations.expansion import audit, parse_caltex, parse_petron_tables, point


def station(**changes):
    return dict(id='one', siteType='Station', country='Philippines', name='Caltex Sample',
                street='Main Road', city='Manila', state='Metro Manila', latitude='14.6', longitude='121',
                fuelsName=['Silver with Techron', 'Lubricants (Delo & Havoline)'], **changes)


def test_only_philippine_fuel_stations_and_published_fuels():
    rows, excluded = parse_caltex([station(), {'siteType': 'WorkShop'}, {'siteType': 'Distributor'}])
    assert len(rows) == 1 and excluded == {'WorkShop': 1, 'Distributor': 1}
    assert rows[0]['fuel_types'] == ['Silver with Techron']
    assert rows[0]['latitude'] == 14.6 and rows[0]['city'] == 'Manila'
    assert 'region_id' not in rows[0] and 'price' not in rows[0]


@pytest.mark.parametrize('changes', [{'country': 'Thailand'}, {'id': ''}, {'name': ''}, {'fuelsName': 'Diesel'}])
def test_source_identity_or_schema_drift_is_not_silently_accepted(changes):
    item = station(); item.update(changes)
    with pytest.raises(ValueError):
        parse_caltex([item])


@pytest.mark.parametrize('coordinates', [(None, None), ('NaN', '121'), (0, 0), (91, 121), (14, math.inf)])
def test_invalid_coordinates_are_not_plotted(coordinates):
    assert point(*coordinates) is None


def test_petron_has_stable_address_identity_not_restarting_row_number():
    pages = [[[['NCR', None, None], ['', 'BUSINESS NAME', 'LOCATION'], ['1', 'Branch A', 'Road A']]],
             [[['SOUTH LUZON', None, None], ['1', 'Branch B', 'Road B'], ['2', 'Missing address', None]]]]
    rows = parse_petron_tables(pages)
    assert rows[0]['directory_key'] != rows[1]['directory_key']
    assert rows[0]['source_station_id'] is None and rows[0]['latitude'] is None
    assert rows[1]['directory_region'] == 'SOUTH LUZON' and rows[1]['source_page'] == 2
    assert rows[2]['review_reasons'] == ['missing_address']


def test_unrecognized_petron_tables_fail_instead_of_silently_skipping():
    for pages in [[], [[]], [[[['Unexpected', 'Heading', 'Changed']]]]]:
        with pytest.raises(ValueError):
            parse_petron_tables(pages)


def test_nearby_existing_records_require_review_without_merging():
    rows, _ = parse_caltex([station()])
    existing = [{'id': 'saved', 'company_slug': 'caltex', 'latitude': 14.6001, 'longitude': 121.0001}]
    result = audit(rows, existing)
    assert result['summary']['candidate_new_records'] == 0
    assert result['stations'][0]['existing_match_ids'] == ['saved']
    assert result['summary']['database_writes'] == 0
    assert rows[0]['review_reasons'] == []


def test_duplicate_ids_coordinates_addresses_and_site_ids_require_review():
    a, b = station(), station()
    a.update(siteId='published'); b.update(id='two', siteId='published')
    result = audit(parse_caltex([a, b])[0], [])
    assert result['summary']['review_required'] == 2
    for row in result['stations']:
        assert {'shared_coordinates', 'shared_address', 'repeated_published_site_id'} <= set(row['review_reasons'])


def test_brand_scoping_does_not_merge_different_company_locations():
    rows, _ = parse_caltex([station()])
    result = audit(rows, [{'id': 'other', 'company_slug': 'shell', 'latitude': 14.6, 'longitude': 121}])
    assert result['summary']['candidate_new_records'] == 1


def test_city_only_is_not_treated_as_a_complete_street_address():
    item = station(); item['street'] = ''
    result = audit(parse_caltex([item])[0], [])
    assert result['summary']['candidate_new_records'] == 0
    assert 'missing_street_address' in result['stations'][0]['review_reasons']
