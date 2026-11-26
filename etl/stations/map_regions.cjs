// Reuse the app's conservative address rules; never infer a region from fleet sections.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ts = require('../../mobile/node_modules/typescript');
const [previewPath, outputPath] = process.argv.slice(2);
if (!previewPath || !outputPath) throw Error('Usage: node stations/map_regions.cjs PREVIEW OUTPUT');
const rulesPath = path.resolve(__dirname, '../../mobile/lib/services/stationDirectory.ts');
const rules = fs.readFileSync(rulesPath, 'utf8');
const preview = fs.readFileSync(previewPath);
const service = {};
vm.runInNewContext(ts.transpileModule(rules, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: service, require: () => ({ supabase: {} }) });
const regions = ['NCR', 'NORTH_LUZON', 'SOUTH_LUZON', 'VISAYAS', 'MINDANAO'];
const records = JSON.parse(preview).stations.filter(row => row.review_reasons.length === 0).map(row => {
  const matches = regions.filter(region => service.matchesSelectedRegion(row, region));
  return { company_slug: row.company_slug, directory_key: row.directory_key,
    address: row.address, region_code: matches.length === 1 ? matches[0] : null };
});
const hash = value => createHash('sha256').update(value).digest('hex');
fs.writeFileSync(outputPath, JSON.stringify({ preview_sha256: hash(preview), rules_sha256: hash(rules), records }, null, 2));
const counts = {};
for (const row of records) counts[row.region_code ?? 'unresolved'] = (counts[row.region_code ?? 'unresolved'] ?? 0) + 1;
console.log(JSON.stringify({ records: records.length, region_counts: counts }));
