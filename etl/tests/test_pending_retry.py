"""Daily pending-retry idles when the queue is empty."""

from __future__ import annotations

from unittest.mock import patch

from src.pending_retry import retry_pending_downloads


def test_retry_pending_idles_when_queue_empty() -> None:
    with patch("src.pending_retry.list_pending_downloads", return_value=[]):
        results = retry_pending_downloads(dry_run=True)

    assert len(results) == 1
    assert results[0].status == "idle"
