from datetime import date
from pathlib import Path
from unittest.mock import Mock

import pytest

from src import automation
from src.discover import DiscoveredBulletin
from src.download import RegionDownloadResult
from src.parse_bulletin import ParsedBulletin, ParsedPrice


def setup(monkeypatch, *, stored=None, errors=None):
    parsed = ParsedBulletin(region_code='NCR', bulletin_date=date(2026, 11, 17),
        week_label='November 17-23, 2026', source_path='source.pdf',
        prices=[ParsedPrice('Petron', 'RON_91', 70), ParsedPrice('Petron', 'DIESEL_PLUS', 80)],
        validation_errors=errors or [])
    monkeypatch.setattr(automation, '_newest_stored_week', lambda *_: stored)
    monkeypatch.setattr(automation, 'download_region_bulletins', lambda *_: RegionDownloadResult(
        paths=[Path('source.pdf')], urls=['https://example.test/source.pdf'], skipped=[]))
    monkeypatch.setattr(automation, 'parse_region_pdfs', lambda *_, **__: parsed)
    load = Mock()
    monkeypatch.setattr(automation, 'load_bulletin', load)
    return DiscoveredBulletin(region_code='NCR', week_start=parsed.bulletin_date, slugs=('source',)), load


def test_force_means_reload_not_bypass_source_validation(monkeypatch):
    discovered, load = setup(monkeypatch, errors=['Malformed table'])
    result = automation._sync_discovered(discovered, dest_dir='.', force=True, dry_run=True, today=date(2026, 11, 25))
    assert result.status == 'ERROR'
    assert 'Malformed table' in result.message
    load.assert_not_called()


def test_older_discovery_cannot_use_newer_stored_date_to_claim_refresh_success(monkeypatch):
    discovered, load = setup(monkeypatch, stored=date(2026, 11, 24))
    with pytest.raises(RuntimeError, match='older than stored'):
        automation._sync_discovered(discovered, dest_dir='.', force=True, dry_run=True, today=date(2026, 11, 25))
    load.assert_not_called()
