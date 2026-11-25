// Optional browser collector. Install Playwright separately; no app dependency changes.
// NODE_PATH=/path/to/node_modules node stations/collect_unioil.cjs SOURCE_DIRECTORY
// BROWSER_EXECUTABLE can select an existing Chromium installation.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const folder = process.argv[2];
if (!folder) throw Error('Usage: node stations/collect_unioil.cjs SOURCE_DIRECTORY');
const origin = 'https://www.unioil.com';
fs.mkdirSync(folder, { recursive: true });

async function collect() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(origin + '/stations', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#area').waitFor({ timeout: 45000 });
    fs.writeFileSync(path.join(folder, 'locator.html'), await page.content());

    async function get(filename, url) {
      if (new URL(url).origin !== origin) throw Error('Unexpected source host');
      const destination = path.join(folder, filename);
      if (fs.existsSync(destination)) return fs.readFileSync(destination, 'utf8');
      const response = await page.request.get(url, { timeout: 30000 });
      if (response.status() !== 200) throw Error('Locator request failed: ' + response.status());
      const content = await response.text();
      if (content.length > 4000000 || content.includes('You are being redirected')) {
        throw Error('Unexpected public locator response');
      }
      fs.writeFileSync(destination, content);
      await page.waitForTimeout(600);
      return content;
    }

    const script = await get('custom.js', origin + '/dist/js/custom.js');
    if (!script.includes('process/getCities') || !script.includes('process/station')) {
      throw Error('Published locator request contract changed');
    }
    const areas = await page.locator('#area option').evaluateAll(nodes => nodes.filter(n => n.value)
      .map(n => ({ id: n.value, name: n.textContent })));
    if (!areas.length || areas.length > 30) throw Error('Unexpected locator area count');
    const stations = new Map(), cities = [], issues = [];
    for (const area of areas) {
      if (!/^\d+$/.test(area.id)) throw Error('Unexpected area identity');
      const content = await get('cities-' + area.id + '.html', origin + '/process/getCities?area=' + area.id);
      if (content.includes('A PHP Error was encountered')) {
        issues.push({ area, reason: 'Publisher PHP error' });
        continue;
      }
      const options = await page.evaluate(source => Array.from(new DOMParser()
        .parseFromString('<select>' + source + '</select>', 'text/html').querySelectorAll('option[value]'))
        .filter(n => n.value).map(n => ({ town: n.value, city: n.getAttribute('data-id'), name: n.textContent })), content);
      if (!options.length) {
        issues.push({ area, reason: 'Empty publisher city list' });
        continue;
      }
      for (const city of options) {
        if (!/^\d+$/.test(city.city) || !/^\d+$/.test(city.town) || cities.length >= 300) {
          throw Error('Unexpected city identity or traversal limit');
        }
        const file = `stations-${area.id}-${city.city}-${city.town}.html`;
        const source = await get(file, origin + '/process/station?' + new URLSearchParams({
          area: area.id, city: city.city, town: city.town,
        }));
        const entries = await page.evaluate(source => Array.from(new DOMParser()
          .parseFromString('<ul>' + source + '</ul>', 'text/html').querySelectorAll('li'))
          .filter(n => n.getAttribute('onclick') || n.textContent.trim() !== 'No record found.')
          .map(n => ({ onclick: n.getAttribute('onclick'),
            name: n.querySelector('.station-details p')?.textContent.trim(),
            address: n.querySelector('.station-details span')?.textContent.trim() })), source);
        for (const item of entries) {
          const match = /^chgStation\((\d+),'([A-Za-z0-9]+)'\)$/.exec(item.onclick ?? '');
          if (!match || !item.name || !item.address) throw Error('Unrecognized station list schema');
          const row = { id: match[1], code: match[2], name: item.name, address: item.address };
          const old = stations.get(row.id);
          if (old && JSON.stringify(old) !== JSON.stringify(row)) throw Error('Conflicting station identity');
          stations.set(row.id, row);
          if (stations.size > 1000) throw Error('Station traversal limit exceeded');
        }
        cities.push({ ...city, area: area.id, count: entries.length, file });
        console.log('City:', area.name, city.name, entries.length);
      }
    }

    // At most two public GET requests in flight; cached responses need no request.
    const queue = Array.from(stations.values());
    let next = 0;
    async function details() {
      while (next < queue.length) {
        const row = queue[next++];
        const content = await get('detail-' + row.id + '.html', origin + '/process/station/?'
          + new URLSearchParams({ id: row.id, code: row.code }));
        row.detail = await page.evaluate(source => {
          const node = new DOMParser().parseFromString(source, 'text/html').querySelector('#mapcoords');
          return node ? Object.fromEntries(Array.from(node.attributes)
            .filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])) : null;
        }, content);
        if (!row.detail) throw Error('Branch detail missing');
        console.log('Detail:', row.id);
      }
    }
    await Promise.all([details(), details()]);
    const result = { collected_at: new Date().toISOString(), source: origin + '/stations',
      complete: issues.length === 0, areas, cities, issues, stations: queue };
    // A failed traversal never replaces the last completed collection manifest.
    fs.writeFileSync(path.join(folder, 'collected.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ stations: stations.size, cities: cities.length, issues }));
  } finally {
    await browser.close();
  }
}

collect().catch(error => { console.error(error.message); process.exitCode = 1; });
