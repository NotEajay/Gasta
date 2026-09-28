"""Unit tests for OCR fallback helpers (no Tesseract required)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from src.ocr import (
    OcrUnavailableError,
    ensure_machine_readable_pdf,
    ocr_disabled,
    ocr_sidecar_path,
    pdf_needs_ocr,
)
from src.parse_bulletin import BulletinNotMachineReadable


def test_ocr_sidecar_path() -> None:
    assert ocr_sidecar_path(Path("data/foo.pdf")) == Path("data/foo.ocr.pdf")


def test_ocr_disabled_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GASTA_ETL_DISABLE_OCR", raising=False)
    assert ocr_disabled() is False
    monkeypatch.setenv("GASTA_ETL_DISABLE_OCR", "1")
    assert ocr_disabled() is True


def test_ensure_skips_ocr_when_text_is_usable(tmp_path: Path) -> None:
    pdf = tmp_path / "good.pdf"
    pdf.write_bytes(b"%PDF-1.4")  # placeholder; extractor is mocked

    with (
        patch("src.ocr.pdf_needs_ocr", return_value=False) as needs,
        patch("src.ocr.run_ocr") as run,
    ):
        assert ensure_machine_readable_pdf(pdf) == pdf
        needs.assert_called_once()
        run.assert_not_called()


def test_ensure_raises_when_ocr_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GASTA_ETL_DISABLE_OCR", "true")
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    with patch("src.ocr.pdf_needs_ocr", return_value=True):
        with pytest.raises(BulletinNotMachineReadable, match="OCR is disabled"):
            ensure_machine_readable_pdf(pdf)


def test_ensure_maps_missing_tools_to_unreadable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GASTA_ETL_DISABLE_OCR", raising=False)
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    with (
        patch("src.ocr.pdf_needs_ocr", return_value=True),
        patch("src.ocr.run_ocr", side_effect=OcrUnavailableError("no tesseract")),
    ):
        with pytest.raises(BulletinNotMachineReadable, match="no tesseract"):
            ensure_machine_readable_pdf(pdf)


def test_ensure_reuses_fresh_sidecar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GASTA_ETL_DISABLE_OCR", raising=False)
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    sidecar = ocr_sidecar_path(pdf)
    sidecar.write_bytes(b"%PDF-1.4-ocr")

    def needs(path: Path) -> bool:
        return path == pdf  # original needs OCR; sidecar is fine

    with (
        patch("src.ocr.pdf_needs_ocr", side_effect=needs),
        patch("src.ocr.run_ocr") as run,
    ):
        assert ensure_machine_readable_pdf(pdf) == sidecar
        run.assert_not_called()
