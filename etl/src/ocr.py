"""OCR fallback for DOE bulletins published as page scans.

GasTa prefers the PDF's native text layer. When that layer is missing or corrupt
(common for North Luzon), this module runs ocrmypdf + Tesseract once and returns
a sidecar `*.ocr.pdf` for the existing parser to consume.
"""

from __future__ import annotations

import os
import shutil
import subprocess
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


def _extract_full_text(path: Path) -> str:
    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


def pdf_needs_ocr(path: Path) -> bool:
    """True when the PDF has no usable text layer for price parsing."""
    # Lazy import avoids a circular dependency with parse_bulletin.
    from .parse_bulletin import BulletinNotMachineReadable, _reject_corrupt_text_layer

    text = _extract_full_text(path)
    if not text.strip():
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
    """Create a searchable PDF via ocrmypdf (--force-ocr)."""
    from .parse_bulletin import BulletinNotMachineReadable

    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    launcher = _require_ocr_tools()
    if launcher == "python":
        cmd = [
            "python",
            "-m",
            "ocrmypdf",
            "--force-ocr",
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
            "--force-ocr",
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
