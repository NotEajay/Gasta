"""Read scanned DOE tables without letting grid lines hide headers and prices."""

from __future__ import annotations

import csv
import io
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def is_scanned_page(page) -> bool:
    area = page.width * page.height
    return any((image['x1'] - image['x0']) * (image['bottom'] - image['top']) > area * 0.8
               for image in page.images)


def _deskew(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    lines = cv2.HoughLinesP(binary, 1, np.pi / 1800, 200,
                            minLineLength=int(image.shape[1] * 0.6), maxLineGap=15)
    angles = []
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            if x2 == x1:
                continue
            angle = math.degrees(math.atan((y2 - y1) / (x2 - x1)))
            if abs(angle) < 3:
                angles.append(angle)
    if angles:
        angle = float(np.median(angles))
        height, width = image.shape[:2]
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
        image = cv2.warpAffine(image, matrix, (width, height), borderValue=(255, 255, 255))
    return image


def _table_images(image):
    """Remove long rules for body OCR; read the colored header separately."""
    image = _deskew(image)
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                                 cv2.getStructuringElement(cv2.MORPH_RECT, (max(60, width // 35), 1)))
    vertical = cv2.morphologyEx(binary, cv2.MORPH_CLOSE,
                               cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5)))
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_OPEN,
                               cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(100, height // 12))))
    contours, _ = cv2.findContours(horizontal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boundaries = sorted(y for x, y, w, h in map(cv2.boundingRect, contours)
                        if w >= width * 0.65 and y > height * 0.15)
    blue = (image[:, :, 0].astype(np.int16) > image[:, :, 2].astype(np.int16) + 15)
    blue_rows = np.flatnonzero(np.count_nonzero(blue, axis=1) > width * 0.35)
    bands = []
    for y in blue_rows.tolist():
        if not bands or y - bands[-1][-1] > 4:
            bands.append([])
        bands[-1].append(y)
    colored = next(((band[0] - 2, band[-1] + 3) for band in bands
                    if len(band) >= 8 and band[0] > height * 0.1), None)
    header, columns = None, []
    candidates = [colored] if colored else [(top, next((y for y in boundaries if y - top > 25), None)) for top in boundaries]
    for top, bottom in candidates:
        if bottom is None:
            continue
        positions = np.flatnonzero(np.count_nonzero(vertical[top:bottom], axis=0) >= (bottom - top) * 0.6)
        groups = []
        for x in positions.tolist():
            if not groups or x - groups[-1][-1] > 8:
                groups.append([])
            groups[-1].append(x)
        # Page titles may also sit inside a long rectangle. A price table has
        # multiple product/brand columns; a title box does not.
        if len(groups) >= 5:
            columns = [int(np.mean(group)) for group in groups]
            header = max(0, top - 5), min(height, bottom + 3)
            break
    rules = cv2.dilate(cv2.bitwise_or(horizontal, vertical), np.ones((3, 3), np.uint8))
    body = cv2.inpaint(image, rules, 3, cv2.INPAINT_TELEA)
    return image, body, header, columns


def _words(image, directory: Path, name: str, *, top: int = 0, left: int = 0, scale: int = 1, psm: int = 6):
    from .parse_bulletin import BulletinNotMachineReadable
    executable = shutil.which('tesseract')
    if not executable:
        raise BulletinNotMachineReadable('Tesseract is required for scanned table pages')
    path = directory / f'{name}.png'
    cv2.imwrite(str(path), image)
    result = subprocess.run([executable, str(path.resolve()), 'stdout', '--psm', str(psm), 'tsv'],
                            capture_output=True, text=True, check=True)
    words = []
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
        text = (row.get('text') or '').strip()
        if not text or int(row['level']) != 5:
            continue
        x, y = int(row['left']) / scale + left, int(row['top']) / scale + top
        words.append({'text': text, 'x0': x, 'x1': x + int(row['width']) / scale,
                      'top': y, 'bottom': y + int(row['height']) / scale})
    return words


def extract_scanned_words(page, source: Path, page_number: int) -> list[dict]:
    """Return image-derived words in PDF coordinates, cached with source mtime."""
    cache = source.with_name(source.stem + '.tables-v7') / f'{page_number}.json'
    mtime = [source.stat().st_mtime_ns, Path(__file__).stat().st_mtime_ns]
    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved.get('mtime') == mtime:
            return saved['words']
    image = np.array(page.to_image(resolution=300).original.convert('RGB'))[:, :, ::-1].copy()
    original, body, header, columns = _table_images(image)
    from .parse_bulletin import ALIAS_TO_COMPANY
    with tempfile.TemporaryDirectory(prefix='gasta-table-') as temporary:
        directory = Path(temporary)
        words = []
        if header:
            top, bottom = header
            for index, (left, right) in enumerate(zip(columns, columns[1:])):
                crop = original[top + 5:bottom - 5, left + 5:right - 5]
                if not crop.size:
                    continue
                crop = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
                detected = _words(crop, directory, f'header-{index}')
                label = ' '.join(word['text'] for word in detected).strip('|{}[]“”\"\':.,') or 'UNKNOWN'
                if label.upper().strip(':.,|{}[]_—–~ \t') not in ALIAS_TO_COMPANY:
                    alternative = ' '.join(word['text'] for word in _words(crop, directory, f'header-{index}-line', psm=7))
                    if alternative.upper().strip(':.,|{}[]_—–~ \t') in ALIAS_TO_COMPANY:
                        label = alternative
                words.append({'text': label, 'x0': (left + right) / 2, 'x1': right,
                    'top': top, 'bottom': bottom, 'table_header': True,
                    'column_left': left, 'column_right': right})
        recognized = {ALIAS_TO_COMPANY.get(word['text'].upper().strip(':.,|{}[]_—–~ \t')) for word in words}
        recognized.discard(None)
        if len(recognized) >= 3:
            body[header[0]:header[1]] = 255
        else:
            # A continuation page starts directly with products. Its grid can
            # be matched to the preceding header without discarding that row.
            words = [{'text': '', 'x0': 0, 'x1': 0, 'top': 0, 'bottom': 0,
                      'table_columns': columns, 'recognized_headers': len(recognized)}]
        words.extend(_words(body, directory, 'body'))
    sx, sy = page.width / image.shape[1], page.height / image.shape[0]
    for word in words:
        word['x0'] *= sx
        word['x1'] *= sx
        word['top'] *= sy
        word['bottom'] *= sy
        if word.get('table_header'):
            word['column_left'] *= sx
            word['column_right'] *= sx
        if 'table_columns' in word:
            word['table_columns'] = [column * sx for column in word['table_columns']]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({'mtime': mtime, 'words': words}))
    return words
