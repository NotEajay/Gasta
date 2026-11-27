from types import SimpleNamespace

import pytest

from stations.brands import record
from stations.import_directory import insert_batch, payload, plan

COMPANIES = {'caltex': 'company'}
REGIONS = {'NCR': 'region'}


def sample():
    return record('caltex', 'Station', 'Main Road, Quezon City', 'https://www.caltex.com/ph/find-us.html', 'one', 14.6, 121)


def mapping(row):
    return {'company_slug': row['company_slug'], 'directory_key': row['directory_key'], 'address': row['address'], 'region_code': 'NCR'}


def test_payload_only_includes_station_fields_and_preserves_unknown_coordinates():
    row = sample();row.update(latitude=None, longitude=None, price=123)
    key = ('caltex', row['directory_key'])
    result = payload(row, COMPANIES, REGIONS, {key: mapping(row)}, 'now')
    assert result['region_id'] == 'region' and result['source_type'] == 'official_directory'
    assert 'price' not in result and 'latitude' not in result and 'id' not in result


@pytest.mark.parametrize('change', [{'source_url': 'https://wrong.example/'}, {'directory_key': 'different'}, {'latitude': 14, 'longitude': None}])
def test_invalid_provenance_identity_and_partial_coordinates_reject_before_writes(change):
    row = sample();row.update(change)
    with pytest.raises(ValueError):
        payload(row, COMPANIES, REGIONS, {('caltex', row['directory_key']): mapping(row)}, 'now')


def test_mapping_must_be_tied_to_exact_address_and_known_region():
    row = sample();entry = mapping(row);entry['address'] = 'Different'
    with pytest.raises(ValueError):
        payload(row, COMPANIES, REGIONS, {('caltex', row['directory_key']): entry}, 'now')


def test_reviewed_exclusions_and_new_existing_matches_never_enter_payload():
    row = sample();row['review_reasons'] = ['source_country_mismatch']
    result = plan([row], [], COMPANIES, REGIONS, [mapping(row)], 'now')
    assert result['payloads'] == [] and result['summary']['held_for_review'] == 1
    row['review_reasons'] = []
    old = {'id': 'existing', 'company_slug': 'caltex', 'name': 'Different name', 'latitude': 14.6001, 'longitude': 121.0001}
    result = plan([row], [old], COMPANIES, REGIONS, [mapping(row)], 'now')
    assert result['payloads'] == [] and result['review'][0]['existing_match_ids'] == ['existing']


def test_same_source_is_idempotent_without_replacing_uuid_or_existing_metadata():
    row = sample();old = dict(row, id='stable-id')
    result = plan([row], [old], COMPANIES, REGIONS, [mapping(row)], 'later')
    assert result['payloads'] == [] and result['summary']['already_present'] == 1
    assert old['id'] == 'stable-id'


def test_unknown_region_is_left_null():
    row = sample();entry = mapping(row);entry['region_code'] = None
    result = plan([row], [], COMPANIES, REGIONS, [entry], 'now')
    assert result['payloads'][0]['region_id'] is None
    assert result['summary']['new_records'] == 1


def test_insert_uses_company_scoped_conflict_key_and_does_not_update_duplicates():
    calls = []
    class Client:
        def table(self, name):
            assert name == 'fuel_stations';return self
        def upsert(self, batch, **kwargs):
            calls.append(kwargs);return self
        def execute(self):
            return SimpleNamespace(data=[])
    insert_batch(Client(), [])
    assert calls == [{'on_conflict': 'oil_company_id,directory_key', 'ignore_duplicates': True, 'default_to_null': False}]
