const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('../node_modules/typescript');
const {harness,find}=require('./componentHarness.cjs');
const file=path.resolve(__dirname,'../lib/services/stationDirectory.ts');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function service(){
 const calls=[];let fail=false;let now=0;
 const supabase={from(table){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},
 async single(){return{data:{id:filters.slug},error:null}},async range(start,end){calls.push({brand:filters.oil_company_id,start,end});if(fail)return{error:Error('failed')};return{data:Array.from({length:filters.oil_company_id==='petron'?1201:2},(_,i)=>({id:`${filters.oil_company_id}-${i}`,fuel_types:i%2?null:['Diesel',123]})).slice(start,end+1),error:null}}};return q}};
 const exports={};vm.runInNewContext(code,{exports,require:()=>({supabase}),Date:class extends Date{static now(){return now}}});return{api:exports,calls,setFail:v=>fail=v,expire:()=>now+=300001};
}
test('brand directory reads all pages, isolates caches, normalizes fuel metadata, and expires',async()=>{
 const {api,calls,expire}=service();assert.equal((await api.fetchOfficialStationDirectory('petron')).length,1201);
 assert.deepEqual(calls.filter(x=>x.brand==='petron').map(x=>x.start),[0,500,1000]);
 assert((await api.fetchOfficialStationDirectory('caltex')).every(x=>x.id.startsWith('caltex-')));
 const before=calls.length;await api.fetchOfficialStationDirectory('petron');assert.equal(calls.length,before);
 assert.deepEqual(Array.from((await api.fetchOfficialStationDirectory('caltex'))[0].fuel_types),['Diesel']);
 expire();await api.fetchOfficialStationDirectory('petron');assert.equal(calls.length,before+3);
});
test('a failed brand request can retry while another brand stays cached',async()=>{
 const {api,calls,setFail}=service();await api.fetchSeaoilDirectory();setFail(true);await assert.rejects(api.fetchOfficialStationDirectory('caltex'));
 setFail(false);assert.equal((await api.fetchOfficialStationDirectory('caltex')).length,2);
 const before=calls.length;await api.fetchSeaoilDirectory();assert.equal(calls.length,before);
});
const pure={};vm.runInNewContext(code,{exports:pure,require:()=>({supabase:{}})});
const text=n=>Array.isArray(n)?n.map(text).join(' '):typeof n==='string'?n:n&&typeof n==='object'?text(n.props?.children):'';
test('directory changes company identity and rejects late results from another brand',async()=>{
 let resolveOld;const old=new Promise(r=>resolveOld=r);
 const h=harness(path.resolve(__dirname,'../components/OfficialStationDirectory.tsx'),{
 '@/constants/Theme':{GasTaColors:{},palette:{}},'@/constants/regions':{DOE_REGIONS:[]},
 '@/lib/services/stationDirectory':{...pure,fetchOfficialStationDirectory:slug=>slug==='caltex'?old:Promise.resolve([{id:'ptt',name:'PTT Main',address:'Calamba City, Laguna',fuel_types:[]}])}});
 await h.flush({slug:'caltex',company:'Caltex',selectedRegion:'SOUTH_LUZON'});
 await h.flush({slug:'ptt',company:'PTT',selectedRegion:'SOUTH_LUZON'});
 assert.match(text(h.tree),/PTT\s+Stations/);assert(!/Caltex\s+Stations/.test(text(h.tree)));
 const card=find(h.tree,n=>n.props?.company==='PTT');card.props.onViewStations();await h.flush();
 assert.equal(find(h.tree,n=>n.type==='Modal').props.visible,true);
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data[0].id,'ptt');
 resolveOld([{id:'wrong-brand',name:'Caltex',address:'Calamba City, Laguna',fuel_types:[]}]);await h.flush();
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data[0].id,'ptt');
});

test('all locations exposes unmapped addresses without assigning them to the selected region',async()=>{
 const h=harness(path.resolve(__dirname,'../components/OfficialStationDirectory.tsx'),{
 '@/constants/Theme':{GasTaColors:{},palette:{}},'@/constants/regions':{DOE_REGIONS:[]},
 '@/lib/services/stationDirectory':{...pure,fetchOfficialStationDirectory:async()=>[
  {id:'mapped',name:'Known',address:'Calamba City, Laguna',fuel_types:[]},
  {id:'unknown',name:'Unmapped',address:'Unconfirmed locality',fuel_types:[]}]} });
 await h.flush({slug:'petron',company:'Petron',selectedRegion:'SOUTH_LUZON'});
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data.length,1);
 find(h.tree,n=>n.props?.accessibilityLabel==='All locations').props.onPress();await h.flush();
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data.length,2);
 find(h.tree,n=>n.props?.accessibilityLabel==='Search station name or address').props.onChangeText('Unmapped');await h.flush();
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data[0].id,'unknown');
 find(h.tree,n=>n.props?.accessibilityLabel==='Selected area').props.onPress();await h.flush();
 assert.equal(find(h.tree,n=>n.type==='FlatList').props.data.length,1);
});

function regionService({missingBrand=false,failPage=false}={}){
 const calls=[];
 const supabase={from(table){let fields='';const filters={};const q={select(v){fields=v;return q},eq(k,v){filters[k]=v;return q},order(){return q},
 async single(){return{data:{id:'ncr'},error:null}},async range(start,end){calls.push({table,fields,start,region:filters.region_id});
 if(missingBrand&&fields.includes('brand_label'))return{error:{code:'42703',message:'column brand_label does not exist'}};
 if(failPage&&start>0)return{error:Error('page read failed')};
 return{data:Array.from({length:1002},(_,i)=>({id:String(i),name:'Station '+i})).slice(start,end+1),error:null}}};return q}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../lib/services/communityReports.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,require:()=>({supabase})});return{api,calls};
}
test('regional station query paginates and keeps the optional-column fallback',async()=>{
 for(const missingBrand of [false,true]){
 const {api,calls}=regionService({missingBrand});const rows=await api.fetchFuelStationsByRegion('NCR');
 assert.equal(rows.length,1002);assert.equal(rows.at(-1).id,'1001');
 assert(calls.every(x=>x.region==='ncr'));assert.deepEqual(calls.filter(x=>!missingBrand||!x.fields.includes('brand_label')).map(x=>x.start),[0,500,1000]);
 }
});
test('a failed later station page rejects rather than silently returning a partial directory',async()=>{
 const {api,calls}=regionService({failPage:true});await assert.rejects(api.fetchFuelStationsByRegion('NCR'),/page read failed/);
 assert.equal(calls.length,2);
});
