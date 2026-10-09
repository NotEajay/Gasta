const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/services/stationDirectory.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const companies = [{id:'seaoil-id',name:'SEAOIL',slug:'seaoil'}, {id:'petron-id',name:'Petron',slug:'petron'}, {id:'caltex-id',name:'Caltex',slug:'caltex'}, {id:'ptt-id',name:'PTT',slug:'ptt'}];
const station = (id,company,address,official=false) => ({id, oil_company_id:company, name:id,address,brand_label:null, source_type:official?'official_directory':'community',fuel_types:null,operating_hours:null,source_url:null,last_synced_at:null});
const rows = [station('sea-calamba','seaoil-id','CALAMBA CITY, LAGUNA',true), station('sea-other','seaoil-id','QUEZON CITY',true), station('petron-calamba','petron-id','CALAMBA CITY, LAGUNA'),station('petron-cebu','petron-id','CEBU CITY'),station('caltex-calamba','caltex-id','CALAMBA CITY, LAGUNA')];
function setup() {
  const calls=[]; let failure=false;
  const supabase = {from(table) {
    const filters={};const q={select(fields){calls.push({table,fields});return q},eq(k,v){filters[k]=v;return q},order(){return q},
      async range(start,end){assert.equal(table,'fuel_stations');assert(filters.oil_company_id);if(failure)return {error:new Error('network')};return {data:rows.filter(row=>row.oil_company_id===filters.oil_company_id).slice(start,end+1),error:null}},
      async single(){if(failure)return {error:new Error('network')};const data=(table==='oil_companies'?companies:rows).find(row=>Object.entries(filters).every(([k,v])=>row[k]===v));return {data,error:data?null:new Error('missing')}}};return q;
  }};
  const service={};vm.runInNewContext(source,{exports:service,require:()=>({supabase})});return {service,calls,setFailure:value=>failure=value};
}
test('company fetch isolates SEAOIL/Petron/Caltex; geography then narrows rows',async()=>{
 const {service,calls}=setup();
 for(const [slug,expected] of [['seaoil','sea-calamba'],['petron','petron-calamba'],['caltex','caltex-calamba']]){
  const result=await service.fetchCompanyReportStations(slug);
  assert(result.every(row=>row.company.slug===slug));
  assert.deepEqual(Array.from(service.filterStationGeography(result,'SOUTH_LUZON','Calamba'),row=>row.id),[expected]);
 }
 assert(calls.every(call=>!call.fields.includes('price')));
});
test('empty company has no fabricated stations',async()=>{
 assert.equal((await setup().service.fetchCompanyReportStations('ptt')).length,0);
});
test('ID lookup includes official records without structured region and null fuels',async()=>{
 const row=await setup().service.fetchReportStation('sea-calamba');
 assert.equal(row.id,'sea-calamba');assert.equal(row.company.id,'seaoil-id');assert.equal(row.source_type,'official_directory');assert.equal(row.fuel_types.length,0);
});
test('network error propagates and a subsequent retry works',async()=>{
 const {service,setFailure}=setup();setFailure(true);await assert.rejects(service.fetchCompanyReportStations('petron'),/network/);
 setFailure(false);assert.equal((await service.fetchCompanyReportStations('petron')).length,2);
});
test('missing selected station fails rather than creating a replacement',async()=>{
 await assert.rejects(setup().service.fetchReportStation('missing'),/missing/);
});
