const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('../node_modules/typescript');
function load(file,req=()=>({})){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:req,URL});return exports}
const coverage=load('lib/doeCoverage.ts');
for(const [start,label,end] of [
 ['2026-09-29','September 29 - October 5, 2026','2026-10-05'],['2026-09-15','September 15-21, 2026','2026-09-21'],['2026-09-22','September 22–28, 2026','2026-09-28'],
 ['2025-12-30','December 30 - January 5, 2026','2026-01-05'],['2025-12-30','December 30, 2025 - January 5, 2026','2026-01-05'],['2026-09-15','15-21 September 2026','2026-09-21'],['2026-09-29','29 Sep to 5 Oct 2026','2026-10-05']
])test(`explicit period ${label} resolves to ${end}`,()=>assert.equal(coverage.resolveDoeCoverage({bulletin_date:start,notes:`ETL import - ${label}`},'NCR')?.coverage_end,end));
test('persisted source filename supplies missing range; query dates do not',()=>{
 const metadata={bulletin_date:'2026-09-29',notes:'ETL import - 2026-09-29',source_urls:{NCR:'https://example.test/NCR%2029%20Sep%20to%205%20Oct%202026.pdf?created_at=2026-10-09'}};
 assert.equal(coverage.resolveDoeCoverage(metadata,'NCR').coverage_end,'2026-10-05');assert.equal(coverage.resolveDoeCoverage({...metadata,source_urls:{NCR:'https://example.test/report.pdf?period=29%20Sep%20to%205%20Oct%202026'}},'NCR'),null);
});
test('hyphenated official filename is parsed and shared bulletin sources agree',()=>{
 assert.equal(coverage.resolveDoeCoverage({bulletin_date:'2026-09-29',source_urls:{MINDANAO:'https://example.test/39.-LFRO-Price-Monitoring-September-29-October-5-2026.pdf'}},'VISAYAS').coverage_end,'2026-10-05');
});
for(const label of ['2026-09-29','September 28 - October 5, 2026','September 29 - October 35, 2026','December 31, 2024 - January 6, 2025'])test(`unconfirmed/mismatching metadata does not manufacture dates: ${label}`,()=>assert.equal(coverage.resolveDoeCoverage({bulletin_date:'2026-09-29',notes:label},'NCR'),null));
test('conflicting ends are not silently chosen',()=>assert.equal(coverage.resolveDoeCoverage({bulletin_date:'2026-09-29',notes:'September 29 - October 5, 2026',source_urls:{NCR:'https://example.test/29%20Sep%20to%206%20Oct%202026.pdf'}},'NCR'),null));
test('timeline labels are compact local calendar dates',()=>assert.equal(coverage.formatDoeTimelineDate('2026-10-05'),'Oct 5'));
const trendRows=[['2026-09-29','September 29 - October 5, 2026',63.2],['2026-09-15','September 15-21, 2026',61.2],['2026-09-22','September 22-28, 2026',62.2]].map(([start,label,price])=>({price_per_liter:price,bulletin:{bulletin_date:start,notes:label}}));
function service(rows){const queries=[];const supabase={from(table){const log={table,filters:[]};queries.push(log);const q={select(fields){log.fields=fields;return q},eq(...pair){log.filters.push(pair);return q},single:async()=>({data:{id:table+'-id'},error:null}),then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve)}};return q}};return{queries,api:load('lib/services/fuelPrices.ts',name=>name==='@/lib/doeCoverage'?coverage:{supabase})}}
test('trend query preserves exact region/fuel/company scope, sorts coverage ends, retains prices, deduplicates bulletin IDs',async()=>{
 const {queries,api}=service([...trendRows,trendRows[0]]);const points=await api.fetchPriceTrend('NCR','RON_91','seaoil');assert.deepEqual(Array.from(points,p=>p.coverage_end),['2026-09-21','2026-09-28','2026-10-05']);assert.deepEqual(Array.from(points,p=>p.price_per_liter),[61.2,62.2,63.2]);assert.equal(points.at(-1).bulletin_date,'2026-09-29');
 const query=queries.find(q=>q.table==='fuel_prices');assert.deepEqual(query.filters,[['region_id','regions-id'],['fuel_type_id','fuel_types-id'],['oil_company_id','oil_companies-id'],['area_name','']]);assert(query.fields.includes('notes, source_urls, source_pdf_url'));
});
test('unknown coverage retains underlying trend price with null end',async()=>{
 const {api}=service([{price_per_liter:60,bulletin:{bulletin_date:'2026-09-08',notes:'2026-09-08'}}]);const points=await api.fetchPriceTrend('NCR','RON_91','seaoil');assert.equal(points[0].price_per_liter,60);assert.equal(points[0].coverage_end,null);
});
test('chart displays coverage ends, including latest Oct 5, and discloses undated points',()=>{
 const {find}=require('./componentHarness.cjs');const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};const react={useState:()=>[320,()=>{}],useMemo:fn=>fn(),useCallback:fn=>fn};
 const {default:Chart}=load('components/ui/PriceTrendChart.tsx',name=>name==='react'?{__esModule:true,default:react}:name==='react/jsx-runtime'?jsx:name==='react-native'?{View:'View',StyleSheet:{create:x=>x}}:name==='@/lib/doeCoverage'?coverage:name==='@/lib/format'?{formatCurrency:n=>'₱'+n}:name==='@/constants/Theme'?{GasTaColors:{},radii:{},spacing:{}}:{Text:'Text'});
 const points=trendRows.map(r=>({bulletin_date:r.bulletin.bulletin_date,coverage_end:coverage.resolveDoeCoverage(r.bulletin,'NCR').coverage_end,price_per_liter:r.price_per_liter}));points.push({bulletin_date:'2026-09-01',coverage_end:null,price_per_liter:99});
 const root=Chart({points});const plot=find(root,n=>typeof n.type==='function'&&n.type.name==='PlotCanvas');assert.deepEqual(plot.props.sampled.map(p=>p.coverage_end),['2026-09-21','2026-09-28','2026-10-05']);const rendered=plot.type(plot.props);assert(find(rendered,n=>n.props?.children==='Oct 5'));assert(!find(rendered,n=>n.props?.children==='Sep 29'));assert(find(root,n=>Array.isArray(n.props?.children)&&n.props.children.includes(' not plotted: coverage end date unavailable.')));
});
