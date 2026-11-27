"""Cache Shell's published Philippine city directory, then validate every city count.

Run from etl: python -m stations.shell --source-dir data/stations/brands-2026-11-11
Source HTML is reused on rerun. No database writes or private API/key usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from .brands import shell_props

COUNTRY_URL = 'https://find.shell.com/ph/fuel/locations'
USER_AGENT = 'GasTaStationDirectory/1.0'


class ShellPages:
    def __init__(self):
        self.last_request = 0.0
        self.robots = RobotFileParser()
        try:
            self.robots.parse(self._read('https://find.shell.com/robots.txt').decode().splitlines())
        except HTTPError as error:
            if error.code != 404:
                raise
            self.robots.parse([])

    def _read(self, url):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'find.shell.com' or parsed.query or parsed.fragment:
            raise ValueError('Unexpected Shell source URL')
        if parsed.path != '/robots.txt' and not parsed.path.startswith('/ph/fuel/locations'):
            raise ValueError('Request left the Philippine directory')
        time.sleep(max(0, .55-(time.monotonic()-self.last_request)))
        try:
            with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=30) as response:
                if response.geturl() != url or response.headers.get_content_type() not in {'text/html', 'text/plain'}:
                    raise ValueError('Unexpected Shell redirect/content type')
                raw = response.read(4_000_001)
                if len(raw) > 4_000_000:
                    raise ValueError('Shell document too large')
                return raw
        finally:
            self.last_request = time.monotonic()

    def get(self, url):
        if not self.robots.can_fetch(USER_AGENT, url):
            raise ValueError('Source robots directives disallow this page')
        return self._read(url)


def collect(folder: Path, get, progress=print):
    country = folder/'shell.html'
    if not country.exists():
        country.write_bytes(get(COUNTRY_URL))
    cities = shell_props(country.read_bytes())['geographicListProps']['locations']
    if not cities or len({item['link'] for item in cities}) != len(cities):
        raise ValueError('Shell city inventory missing or duplicated')
    cache = folder/'shell-cities';cache.mkdir(exist_ok=True)
    result = []
    for index, item in enumerate(cities):
        url = urljoin('https://find.shell.com', item['link'])
        parsed = urlparse(url)
        if parsed.netloc != 'find.shell.com' or not parsed.path.startswith('/ph/fuel/locations/') or parsed.query or parsed.fragment:
            raise ValueError('Unexpected Shell city link')
        slug = parsed.path.rsplit('/', 1)[-1]
        if not slug or not all(char.isalnum() or char == '-' for char in slug):
            raise ValueError('Unexpected Shell city slug')
        source = cache/(slug+'.html')
        if not source.exists():
            source.write_bytes(get(url))
        raw = source.read_bytes()
        locations = shell_props(raw)['stationListProps']['locations']
        if len(locations) != item['count']:
            raise ValueError('Shell city count mismatch: ' + item['name'])
        result.append(dict(city=item['name'], url=url, sha256=hashlib.sha256(raw).hexdigest(), locations=locations))
        if (index+1) % 25 == 0:
            progress(f'Shell cities {index+1}/{len(cities)}')
    return dict(complete=True, expected_cities=len(cities), cities=result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    args = parser.parse_args();args.source_dir.mkdir(parents=True, exist_ok=True)
    pages = None
    def get(url):
        nonlocal pages
        if pages is None:
            pages = ShellPages()
        return pages.get(url)
    result = collect(args.source_dir, get)
    (args.source_dir/'shell-collected.json').write_text(json.dumps(result, indent=2))
    print(f'Complete: {len(result["cities"])} cities; no database writes.')


if __name__ == '__main__':
    main()
