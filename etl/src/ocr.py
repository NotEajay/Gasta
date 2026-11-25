"""OCR fallback for DOE bulletins published as page scans.

GasTa prefers the PDF's native text layer. When that layer is missing or corrupt
(common for North Luzon), this module runs ocrmypdf + Tesseract once and returns
a sidecar `*.ocr.pdf` for the existing parser to consume.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pdfplumber


class OcrUnavailableError(RuntimeError):
    """ocrmypdf / Tesseract is not installed or not runnable."""


def ocr_disabled() -> bool:
    return os.environ.get("GASTA_ETL_DISABLE_OCR", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _page_text_layers(path: Path) -> list[tuple[str, bool]]:
    """Inspect every page, including scans inside an otherwise searchable PDF."""
    with pdfplumber.open(path) as pdf:
        return [(page.extract_text() or "", bool(page.images)) for page in pdf.pages]


def pdf_needs_ocr(path: Path) -> bool:
    """True when the PDF has no usable text layer for price parsing."""
    # Lazy import avoids a circular dependency with parse_bulletin.
    from .parse_bulletin import BulletinNotMachineReadable, _reject_corrupt_text_layer

    pages = _page_text_layers(path)
    if not any(text.strip() for text, _ in pages):
        return True
    for text, has_images in pages:
        if not text.strip() and has_images:
            return True
        try:
            _reject_corrupt_text_layer(path.name, text)
        except BulletinNotMachineReadable:
            return True
    return False


def ocr_sidecar_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.ocr{path.suffix}")


def _require_ocr_tools() -> str:
    """Return 'ocrmypdf' binary or 'python' (module mode)."""
    exe = shutil.which("ocrmypdf")
    if exe:
        if not shutil.which("tesseract"):
            raise OcrUnavailableError(
                "OCR is required for this scanned DOE bulletin, but Tesseract is not "
                "on PATH. Install tesseract-ocr (and ghostscript) then retry."
            )
        return exe

    try:
        import ocrmypdf  # noqa: F401
    except ImportError as exc:
        raise OcrUnavailableError(
            "OCR is required for this scanned DOE bulletin, but ocrmypdf is not "
            "installed. Install with: pip install ocrmypdf && "
            "apt/brew install tesseract ghostscript"
        ) from exc

    if not shutil.which("tesseract"):
        raise OcrUnavailableError(
            "OCR is required for this scanned DOE bulletin, but Tesseract is not "
            "on PATH. Install tesseract-ocr (and ghostscript) then retry."
        )
    return "python"


def run_ocr(input_path: Path, output_path: Path) -> Path:
    """OCR image pages while retaining usable native text and its coordinates."""
    from .parse_bulletin import BulletinNotMachineReadable, _reject_corrupt_text_layer

    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    launcher = _require_ocr_tools()
    mode = "--skip-text"
    for text, _ in _page_text_layers(input_path):
        try:
            _reject_corrupt_text_layer(input_path.name, text)
        except BulletinNotMachineReadable:
            mode = "--force-ocr"
            break
    if launcher == "python":
        cmd = [
            sys.executable,
            "-m",
            "ocrmypdf",
            mode,
            "--jobs", "2",
            "--language",
            "eng",
            "--optimize",
            "0",
            "--quiet",
            str(input_path),
            str(output_path),
        ]
    else:
        cmd = [
            launcher,
            mode,
            "--jobs", "2",
            "--language",
            "eng",
            "--optimize",
            "0",
            "--quiet",
            str(input_path),
            str(output_path),
        ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise OcrUnavailableError(
            "Failed to launch ocrmypdf. Install ocrmypdf, tesseract-ocr, and ghostscript."
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip() or str(exc)
        raise BulletinNotMachineReadable(
            f"OCR failed for {input_path.name}: {detail}"
        ) from exc

    if not output_path.exists():
        raise BulletinNotMachineReadable(
            f"OCR did not produce an output file for {input_path.name}"
        )
    return output_path


def ensure_machine_readable_pdf(path: Path | str) -> Path:
    """Return a PDF path with a usable text layer, OCR'ing when necessary."""
    from .parse_bulletin import BulletinNotMachineReadable

    path = Path(path)
    if not pdf_needs_ocr(path):
        return path

    if ocr_disabled():
        raise BulletinNotMachineReadable(
            f"{path.name} contains no usable text layer and OCR is disabled "
            "(GASTA_ETL_DISABLE_OCR)."
        )

    sidecar = ocr_sidecar_path(path)
    if (
        sidecar.exists()
        and sidecar.stat().st_mtime >= path.stat().st_mtime
        and not pdf_needs_ocr(sidecar)
    ):
        return sidecar

    try:
        run_ocr(path, sidecar)
    except OcrUnavailableError as exc:
        raise BulletinNotMachineReadable(
            f"{path.name} contains no usable text layer; {exc}"
        ) from exc

    if pdf_needs_ocr(sidecar):
        raise BulletinNotMachineReadable(
            f"{path.name} remained unreadable after OCR; prices cannot be trusted."
        )
    return sidecar
