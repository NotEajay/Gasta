import pytest

from stations.unioil import parse_city, parse_collected, fingerprint, apply_crosswalk, omit_reviewed_coordinates


CITY = "<li onclick=\"chgStation(63,'1060B')\"><div class='station-details'><p> MAKATI AVE POBLACION </p><span>Makati Avenue, Poblacion, Makati City</span></div></li>"


def fixture(tmp_path):
    (tmp_path/'stations-2-13-13.html').write_text(CITY)
    (tmp_path/'detail-63.html').write_text('<div id="mapcoords" data-name="MAKATI AVE POBLACION" data-address="Makati Avenue, Poblacion, Makati City" data-lat="14.567" data-lng="121.029"></div>')
    return dict(source='https://www.unioil.com/stations', complete=False,
                issues=[dict(area='5', reason='Publisher error')],
                cities=[dict(file='stations-2-13-13.html', count=1)],
                stations=[dict(parse_city(CITY)[0], detail={})])


def test_unioil_published_alphanumeric_codes_and_explicit_empty_city():
    assert parse_city(CITY)[0]['code'] == '1060B'
    assert parse_city('<li>No record found.</li>') == []
    with pytest.raises(ValueError):
        parse_city('<li>Something unexpected</li>')


def test_unioil_reads_published_pins_and_preserves_partial_coverage_metadata(tmp_path):
    data = fixture(tmp_path)
    row = parse_collected(data, tmp_path)[0]
    assert row['name'] == 'Unioil MAKATI AVE POBLACION'
    assert row['latitude'] == 14.567 and row['source_station_id'] == '63'
    assert row['fuel_types'] is None
    assert not data['complete'] and data['issues']


@pytest.mark.parametrize('change', ['missing_city', 'count', 'identity', 'map'])
def test_unioil_rejects_incomplete_or_changed_cached_evidence(tmp_path, change):
    data = fixture(tmp_path)
    if change == 'missing_city':
        data['cities'] = []
    elif change == 'count':
        data['cities'][0]['count'] = 2
    elif change == 'identity':
        data['stations'][0]['name'] = 'Different branch'
    else:
        (tmp_path/'detail-63.html').write_text('<div>Not a map detail</div>')
    with pytest.raises(ValueError):
        parse_collected(data, tmp_path)


def test_unioil_omits_invalid_coordinates_without_guessing_replacements(tmp_path):
    data = fixture(tmp_path)
    (tmp_path/'detail-63.html').write_text('<div id="mapcoords" data-name="MAKATI AVE POBLACION" data-address="Makati Avenue, Poblacion, Makati City" data-lat="121.029" data-lng="14.567"></div>')
    row = parse_collected(data, tmp_path)[0]
    assert row['latitude'] is None and row['longitude'] is None and row['coordinate_warning']


def test_crosswalk_preserves_existing_uuid_and_fails_when_either_listing_changes(tmp_path):
    row = parse_collected(fixture(tmp_path), tmp_path)[0]
    existing = dict(row, id='existing-uuid', name='Registered operator')
    decision = dict(source_station_id='63', existing_station_id='existing-uuid', status='covered',
                    source_fingerprint=fingerprint(row), existing_fingerprint=fingerprint(existing),
                    reason='Same published road, barangay and city; keep registered identity.')
    manifest = dict(version=1, reviewed_at='2026-11-12', records=[decision])
    checked = apply_crosswalk([row], [existing], manifest)[0]
    assert checked['review_reasons'] == ['covered_by_existing_station']
    assert existing['id'] == 'existing-uuid' and row['review_reasons'] == []
    for changed in [dict(existing, name='Changed operator'), dict(existing, company_slug='shell')]:
        with pytest.raises(ValueError):
            apply_crosswalk([row], [changed], manifest)
    with pytest.raises(ValueError):
        apply_crosswalk([dict(row, address='Changed address')], [existing], manifest)
    decision['status'] = 'pending_review'
    assert apply_crosswalk([row], [existing], manifest)[0]['review_reasons'] == ['possible_cross_source_station']


def test_coordinate_omissions_are_bound_to_exact_reviewed_identity_and_pin(tmp_path):
    row = parse_collected(fixture(tmp_path), tmp_path)[0]
    review = dict(version=1, reviewed_at='2026-11-12', records=[dict(source_station_id='63',
                  source_fingerprint=fingerprint(row), published_coordinates=[14.567, 121.029], reason='Conflicting source pin; retain address only.')])
    result = omit_reviewed_coordinates([row], review)[0]
    assert result['latitude'] is None and result['longitude'] is None and row['latitude'] == 14.567
    for changed in [dict(row, latitude=14.568), dict(row, name='Different branch')]:
        with pytest.raises(ValueError):
            omit_reviewed_coordinates([changed], review)
    with pytest.raises(ValueError):
        omit_reviewed_coordinates([], review)
