"""A refresh keeps source dates honest and never deletes before a verified upload."""

from copy import deepcopy
from datetime import date
from types import SimpleNamespace

import pytest

from src import load_supabase
from src.parse_bulletin import ParsedBulletin, ParsedPrice


class Database:
    def __init__(self):
        self.rows = {
            'regions': [{'id': 'region', 'code': 'NCR'}],
            'fuel_types': [{'id': 'gas', 'code': 'RON_91'}, {'id': 'diesel', 'code': 'DIESEL_PLUS'}],
            'oil_companies': [{'id': 'petron', 'slug': 'petron', 'name': 'Petron'}],
            'fuel_price_bulletins': [{'id': 'week', 'bulletin_date': '2026-11-17', 'source_urls': {}}],
            'fuel_prices': [],
        }
        self.events = []
        self.fail_upload = False
        self.drop_upload = False

    def table(self, table):
        return Query(self, table)


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters = []
        self.operation = 'read'
        self.payload = None
        self.bounds = None
        self.single = False

    def select(self, fields):
        return self

    def eq(self, key, value):
        self.filters.append((key, lambda actual, value=value: actual == value))
        return self

    def in_(self, key, values):
        self.filters.append((key, lambda actual: actual in values))
        return self

    def order(self, *args, **kwargs):
        return self

    def range(self, first, last):
        self.bounds = first, last
        return self

    def maybe_single(self):
        self.single = True
        return self

    def update(self, payload):
        self.operation, self.payload = 'update', payload
        return self

    def upsert(self, payload, **kwargs):
        self.operation, self.payload = 'upsert', payload
        return self

    def delete(self):
        self.operation = 'delete'
        return self

    def execute(self):
        records = self.db.rows[self.table]
        selected = [row for row in records if all(test(row.get(key)) for key, test in self.filters)]
        self.db.events.append((self.table, self.operation, self.bounds))
        if self.operation == 'upsert':
            if self.db.fail_upload:
                raise RuntimeError('upload failed')
            if not self.db.drop_upload:
                for payload in self.payload:
                    keys = ('bulletin_id', 'region_id', 'oil_company_id', 'fuel_type_id', 'area_name')
                    existing = next((row for row in records if all(row[k] == payload[k] for k in keys)), None)
                    if existing is None:
                        records.append({'id': 'new-' + str(len(records)), **payload})
                    else:
                        existing.update(payload)
        elif self.operation == 'delete':
            records[:] = [row for row in records if row not in selected]
        elif self.operation == 'update':
            for row in selected:
                row.update(self.payload)
        if self.bounds:
            selected = selected[self.bounds[0]:self.bounds[1] + 1]
        result = deepcopy(selected)
        if self.table == 'fuel_prices':
            for row in result:
                row['oil_companies'] = next(c for c in self.db.rows['oil_companies'] if c['id'] == row['oil_company_id'])
                row['fuel_types'] = next(f for f in self.db.rows['fuel_types'] if f['id'] == row['fuel_type_id'])
        return SimpleNamespace(data=(result[0] if result else None) if self.single else result)


def source(prices=None):
    return ParsedBulletin(region_code='NCR', bulletin_date=date(2026, 11, 17),
        week_label='November 17-23, 2026', source_path='source.pdf',
        prices=prices if prices is not None else [ParsedPrice('Petron', 'RON_91', 70, 'Manila'),
                                                  ParsedPrice('Petron', 'DIESEL_PLUS', 80, 'Manila')])


def record(id, area='Manila', fuel='gas', price=70, week='week', region='region'):
    return {'id': id, 'bulletin_id': week, 'region_id': region, 'oil_company_id': 'petron',
            'fuel_type_id': fuel, 'area_name': area, 'price_per_liter': price}


@pytest.fixture
def db(monkeypatch):
    db = Database()
    monkeypatch.setattr(load_supabase, '_client', lambda: db)
    monkeypatch.setattr(load_supabase, 'require_history_schema', lambda: None)
    return db


def test_upload_is_verified_before_obsolete_rows_are_removed_and_other_scopes_survive(db):
    db.rows['fuel_prices'] = [record('same'), record('old-copy', 'Baguio', price=60),
                              record('prior-week', 'Baguio', week='prior'),
                              record('other-region', 'Baguio', region='other')]
    result = load_supabase.load_bulletin(source())
    remaining = {row['id']: row for row in db.rows['fuel_prices']}
    assert 'same' in remaining
    assert 'old-copy' not in remaining
    assert 'prior-week' in remaining and 'other-region' in remaining
    assert result['price_rows'] == 2
    operations = [operation for table, operation, _ in db.events if table == 'fuel_prices']
    assert operations.index('upsert') < operations.index('delete')
    assert 'read' in operations[operations.index('upsert') + 1:operations.index('delete')]
    assert load_supabase.stored_prices_match(source())


def test_failed_upload_keeps_existing_prices_and_never_deletes(db):
    db.rows['fuel_prices'] = [record('original')]
    before = deepcopy(db.rows['fuel_prices'])
    db.fail_upload = True
    with pytest.raises(RuntimeError, match='upload failed'):
        load_supabase.load_bulletin(source())
    assert db.rows['fuel_prices'] == before
    assert not any(operation == 'delete' for _, operation, _ in db.events)


def test_incomplete_upload_fails_verification_without_removing_old_prices(db):
    db.rows['fuel_prices'] = [record('original'), record('old-copy', 'Baguio')]
    before = deepcopy(db.rows['fuel_prices'])
    db.drop_upload = True
    with pytest.raises(RuntimeError, match='verification failed'):
        load_supabase.load_bulletin(source())
    assert db.rows['fuel_prices'] == before
    assert not any(operation == 'delete' for _, operation, _ in db.events)


@pytest.mark.parametrize('change', ['missing', 'changed', 'extra'])
def test_skip_requires_exact_source_facts_not_merely_core_fuel_presence(db, change):
    db.rows['fuel_prices'] = [record('gas'), record('diesel', fuel='diesel', price=80)]
    assert load_supabase.stored_prices_match(source())
    if change == 'missing':
        db.rows['fuel_prices'].pop()
    elif change == 'changed':
        db.rows['fuel_prices'][0]['price_per_liter'] = 71
    else:
        db.rows['fuel_prices'].append(record('prior-copy', 'Baguio', price=60))
    assert not load_supabase.stored_prices_match(source())


def test_price_comparison_and_upload_read_more_than_one_database_page(db):
    prices = [ParsedPrice('Petron', 'RON_91', 70, f'Area {index}') for index in range(1201)]
    db.rows['fuel_prices'] = [record(str(index), f'Area {index}') for index in range(1201)]
    assert load_supabase.stored_prices_match(source(prices))
    ranges = [bounds for table, operation, bounds in db.events if table == 'fuel_prices']
    assert ranges == [(0, 499), (500, 999), (1000, 1499)]
    load_supabase.load_bulletin(source(prices))
    assert len(db.rows['fuel_prices']) == 1201


@pytest.mark.parametrize('prices', [[], [ParsedPrice('Petron', 'RON_91', float('nan'))],
    [ParsedPrice('Petron', 'RON_91', 0)],
    [ParsedPrice('Petron', 'RON_91', 70), ParsedPrice('Petron', 'RON_91', 71)]])
def test_invalid_or_empty_source_fails_before_any_database_access(db, prices):
    with pytest.raises(ValueError):
        load_supabase.load_bulletin(source(prices))
    assert db.events == []


def test_recovered_subregion_preserves_siblings_and_recomputes_region_minimum(db):
    db.rows['fuel_prices'] = [record('manila', price=70), record('naga', 'Naga', price=90),
        record('missing-from-new-source', 'Naga', fuel='diesel', price=100),
        record('regional', '', price=70), record('regional-diesel', '', fuel='diesel', price=100)]
    result = load_supabase.merge_bulletin_prices(source([
        ParsedPrice('Petron', 'RON_91', 72, 'Naga'), ParsedPrice('Petron', 'RON_91', 72)]))
    rows = db.rows['fuel_prices']
    assert next(row for row in rows if row['id'] == 'manila')['price_per_liter'] == 70
    assert next(row for row in rows if row['id'] == 'naga')['price_per_liter'] == 72
    assert next(row for row in rows if row['area_name'] == '')['price_per_liter'] == 70
    assert all(row['fuel_type_id'] != 'diesel' for row in rows)
    assert result['merged'] == 1
