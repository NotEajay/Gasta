const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const { theme, currentLowest } = require('./currentLowestHarness.cjs');
const root = path.resolve(__dirname, '..');
const text = n => Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n && typeof n === 'object' ? text(n.props?.children) : '';
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
function backend(options={}) {
  let handler; const calls=[];
  const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'public',GOOGLE_MAPS_API_KEY:'server-only-key'};
  vm.runInNewContext(compile(path.join(root,'../supabase/functions/google-places-autocomplete/index.ts')), {
    exports:{}, require:()=>({createClient:()=>({auth:{getUser:async()=>({data:{user: options.invalidSession ? null : {id:'me'}},error:null})}})}),
    Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn}, Request,Response,AbortController,setTimeout,clearTimeout,
    fetch:async(url,init)=>{calls.push({url,init}); if(options.failure)throw options.failure;return new Response(JSON.stringify(options.payload??{}),{status:options.status??200})},
  });
  return {calls, async request(body, authenticated=true) {return handler(new Request('https://local.test',{method:'POST',headers: authenticated ? {Authorization:'Bearer session'} : {},body:JSON.stringify(body)}));}};
}
const place = (id,lat=13.62,extra={})=>({id,displayName:{text:'Caltex '+id},formattedAddress:'Naga City, Philippines',location:{latitude:lat,longitude:123.18},types:['gas_station'],businessStatus:'OPERATIONAL',...extra});
const body={stationBrand:'caltex',latitude:13.621,longitude:123.181};
test('station endpoint authenticates and rejects unknown brands, mixed modes and invalid coordinates before Google calls',async()=>{
  const env=backend(); assert.equal((await env.request(body,false)).status,401);
  for(const bad of [{...body,stationBrand:'unknown'},{...body,query:'secret'},{...body,placeId:'some-id'},{...body,latitude:45},{...body,longitude:null}])assert.equal((await env.request(bad)).status,400);
  assert.equal(env.calls.length,0);
});
test('station search scopes company and fuel-station type, excludes closed/wrong/far entries, deduplicates and sorts distance',async()=>{
  const env=backend({payload:{places:[place('Farther',13.65),place('Near'),place('Near'),place('Closed',13.62,{businessStatus:'CLOSED_TEMPORARILY'}),place('Shell',13.62,{displayName:{text:'Shell'}}),place('Shop',13.62,{types:['store']}),place('Davao',7.1),place('Invalid',99)]}});
  const res=await env.request(body), data=await res.json(); assert.equal(res.status,200);
  assert.deepEqual(data.stations.map(r=>r.name),['Caltex Near','Caltex Farther']);
  const sent=JSON.parse(env.calls[0].init.body); assert.equal(sent.textQuery,'Caltex gas station');assert.equal(sent.includedType,'gas_station');assert.equal(sent.strictTypeFiltering,true);assert.equal(sent.rankPreference,'DISTANCE');
  assert.equal(env.calls[0].url,'https://places.googleapis.com/v1/places:searchText');assert(!env.calls[0].init.headers['X-Goog-FieldMask'].includes('*'));assert(!JSON.stringify(data).includes('server-only-key'));
});
test('empty and failed Google searches remain distinguishable with friendly errors',async()=>{
  assert.deepEqual(await (await backend().request(body)).json(),{stations:[]});
  assert.equal((await backend({payload:{places:'bad'}}).request(body)).status,502);
  const res=await backend({status:429,payload:{error:{status:'RESOURCE_EXHAUSTED',message:'private provider detail'}}}).request(body);
  assert.equal(res.status,429);assert.equal((await res.json()).error.code,'quota');
  assert.equal((await backend({failure:new DOMException('aborted','AbortError')}).request(body)).status,504);
});
test('existing autocomplete and place-details request contracts continue to work',async()=>{
  const suggestions=backend({payload:{suggestions:[{placePrediction:{place:'places/a',text:{text:'Naga City'}}}]}});
  assert.equal((await suggestions.request({query:'Naga City'})).status,200);assert(suggestions.calls[0].url.endsWith('places:autocomplete'));
  const details=backend({payload:{id:'a',formattedAddress:'Naga City',location:{latitude:13.6,longitude:123.2}}});
  assert.equal((await details.request({placeId:'a'})).status,200);assert(details.calls[0].url.endsWith('places/a'));
});
const station={placeId:'places/caltex-branch',name:'Caltex Magsaysay',address:'Magsaysay Avenue, Naga City',latitude:13.63,longitude:123.19,distanceKm:1.3,attributions:[]};
function picker(options={}) {
  let closes=0;const published=[],navigated=[],searches=[]; let location=options.location??{latitude:13.62,longitude:123.18,city:'Naga City',regionCode:'SOUTH_LUZON'};
  class PlacesError extends Error {}
  const h=harness(path.join(root,'components/prices/NearbyStationPicker.tsx'),{
    '@/constants/Theme':theme,'@/hooks/useReducedMotion':{useReducedMotion:()=>true},
    'expo-router':{useRouter:()=>({navigate:value=>navigated.push(value)})},
    '@/lib/services/location':{resolveCurrentPlace:async()=>options.denied?null:location},
    '@/lib/services/googlePlacesAutocomplete':{STATION_BRANDS:['all','caltex','shell'],STATION_BRAND_LABELS:{all:'All companies',caltex:'Caltex',shell:'Shell'},PlacesAutocompleteError:PlacesError,searchNearbyFuelStations:async(...args)=>{searches.push(args);return options.search?options.search(...args):[station]}},
    '@/lib/services/routeSelection':{publishRouteSelection:value=>published.push(value)},
  },'ios',{AbortController});
  return {h,published,navigated,searches,get closes(){return closes}, async ready(){await h.flush({brand:'caltex',brandName:'Caltex',priceContext:'DOE estimate for Naga. Branch prices may differ.',priceContexts:options.priceContexts,onClose:()=>closes++});await h.flush();}};
}
test('choosing a branch hands exact current and station coordinates to Trip without copying the card price',async()=>{
  const s=picker();await s.ready();find(s.h.tree,n=>n.props?.stations&&n.props?.onSelect).props.onSelect(station.placeId);await s.h.flush();find(s.h.tree,n=>n.props?.accessibilityLabel?.startsWith('Plan trip to Caltex')).props.onPress();
  assert.equal(s.published.length,1);assert.equal(s.published[0].origin.directionsValue,'13.62,123.18');assert.equal(s.published[0].destination.directionsValue,'13.63,123.19');assert.equal(s.published[0].destination.displayName,'Caltex Magsaysay · Magsaysay Avenue, Naga City');
  assert.equal(s.navigated[0],'/(tabs)/trip');assert.equal(s.closes,1);assert(!JSON.stringify(s.published).includes('price'));s.h.unmount();
});
test('denied location and empty search never navigate or fabricate a station',async()=>{
  const denied=picker({denied:true});await denied.ready();assert.equal(denied.searches.length,0);assert(find(denied.h.tree,n=>n.props?.accessibilityRole==='alert'));assert.equal(denied.published.length,0);denied.h.unmount();
  const empty=picker({search:async()=>[]});await empty.ready();assert(text(empty.h.tree).includes('No matching Caltex stations found within 30 km.'));assert.equal(empty.navigated.length,0);empty.h.unmount();
});
test('retry reruns station search and closing aborts pending requests',async()=>{
  let calls=0;const s=picker({search:async()=>{if(calls++===0)throw Error('private key');return[station]}});await s.ready();assert(!find(s.h.tree,n=>n.props?.children==='private key'));
  find(s.h.tree,n=>n.props?.accessibilityLabel==='Retry nearby station search').props.onPress();await s.h.flush();await s.h.flush();assert.equal(s.searches.length,2);assert(find(s.h.tree,n=>n.props?.stations?.length===1&&n.props?.onSelect));
  const signal=s.searches.at(-1)[3];s.h.unmount();assert.equal(signal.aborted,true);
});
test('station finder works from the lowest-price card and independently when no trusted price exists',async()=>{
  const s=currentLowest();await s.flush();find(s.card,n=>n.props?.testID==='price-find-station').props.onPress();await s.flush();
  const modal=find(s.h.tree,n=>n.props?.brand==='shell'&&n.props?.brandName==='Shell');assert(modal);assert.match(modal.props.priceContext,/DOE estimate for National Capital Region/);s.h.unmount();
  const empty=currentLowest({prices:[]});await empty.flush();const button=find(empty.h.tree,n=>n.props?.testID==='price-find-station'); assert(button); button.props.onPress(); await empty.flush();
  const all=find(empty.h.tree,n=>n.props?.brand==='all'&&n.props?.brandName==='All companies');assert(all);assert.match(all.props.priceContext,/No DOE price is available/);assert.equal(empty.card,null);empty.h.unmount();
});
function clientService(data) {
  const exports={}, calls=[];
  vm.runInNewContext(compile(path.join(root,'lib/services/googlePlacesAutocomplete.ts')),{
    exports, require:()=>({supabase:{functions:{invoke:async(name,options)=>{calls.push({name,options});return{data,error:null}}}}}),
  });
  return {...exports,calls};
}
test('mobile station search sends only the selected company and current point through the protected function',async()=>{
  const service=clientService({stations:[station]});
  const rows=await service.searchNearbyFuelStations('caltex',13.62,123.18);
  assert.equal(rows[0].placeId,station.placeId);
  assert.equal(service.calls[0].name,'google-places-autocomplete');
  assert.equal(JSON.stringify(service.calls[0].options.body),JSON.stringify({stationBrand:'caltex',latitude:13.62,longitude:123.18}));
  assert(!JSON.stringify(service.calls).includes('price'));
});
test('mobile station search rejects unsupported requests and malformed provider results',async()=>{
  const service=clientService({stations:[station]});
  await assert.rejects(service.searchNearbyFuelStations('unknown',13.62,123.18),/Philippines/);
  await assert.rejects(service.searchNearbyFuelStations('caltex',NaN,123.18),/Philippines/);
  assert.equal(service.calls.length,0);
  for(const change of [{distanceKm:Infinity},{latitude:99},{attributions:[{name:'unsafe',uri:'javascript:bad'}]}]) {
    const invalid=clientService({stations:[{...station,...change}]});
    await assert.rejects(invalid.searchNearbyFuelStations('caltex',13.62,123.18),/unreadable/);
  }
});

test('all-company discovery searches gas stations without requiring a DOE price or brand match',async()=>{
  const env=backend({payload:{places:[place('Caltex'),place('Shell',13.625,{displayName:{text:'Shell'}}),place('Shop',13.62,{types:['store']})]}});
  const response=await env.request({...body,stationBrand:'all'});
  assert.equal(response.status,200);assert.equal((await response.json()).stations.length,2);
  assert.equal(JSON.parse(env.calls[0].init.body).textQuery,'gas stations');
});
test('switching companies searches that brand and updates the estimate instead of reusing the original card price',async()=>{
  const s=picker({priceContexts:{shell:'Shell DOE estimate: ₱70.00/L for Naga. Branch prices may differ.'},search:async brand=>[{...station,name:brand==='shell'?'Shell Naga':'Caltex Naga'}]});
  await s.ready(); find(s.h.tree,n=>n.props?.label==='Company').props.onChange('shell');await s.h.flush();await s.h.flush();
  assert.equal(s.searches.at(-1)[0],'shell');assert(text(s.h.tree).includes('Shell DOE estimate: ₱70.00/L'));assert(!text(s.h.tree).includes('DOE estimate for Naga. Branch prices may differ.'));
  find(s.h.tree,n=>n.props?.label==='Company').props.onChange('all');await s.h.flush();await s.h.flush();
  assert.equal(s.searches.at(-1)[0],'all');assert(text(s.h.tree).includes('Stations near you'));assert(!text(s.h.tree).includes('₱70.00'));s.h.unmount();
});
test('a company without a DOE price remains searchable and says price unavailable',async()=>{
  const s=picker();await s.ready();find(s.h.tree,n=>n.props?.label==='Company').props.onChange('shell');await s.h.flush();await s.h.flush();
  assert.equal(s.searches.at(-1)[0],'shell');assert(text(s.h.tree).includes('Price unavailable for Shell'));s.h.unmount();
});
test('late results from a previous company cannot replace the newly selected company',async()=>{
  let finishOld;const old=new Promise(resolve=>finishOld=resolve);
  const s=picker({search:brand=>brand==='caltex'?old:Promise.resolve([{...station,name:'Shell Naga'}])});
  await s.ready();find(s.h.tree,n=>n.props?.label==='Company').props.onChange('shell');await s.h.flush();await s.h.flush();
  finishOld([station]);await s.h.flush();
  const shown=find(s.h.tree,n=>n.props?.stations&&n.props?.onSelect).props.stations;assert.equal(shown[0].name,'Shell Naga');assert(!shown.some(r=>r.name==='Caltex Magsaysay'));
  assert.equal(s.searches[0][3].aborted,true);s.h.unmount();
});
