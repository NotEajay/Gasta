const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('../node_modules/typescript');
const {test}=require('node:test');
const path=require('node:path');
const {harness,find}=require('./componentHarness.cjs');
const theme={'@/constants/Theme':{GasTaColors:{},radii:{},spacing:{},palette:{}},'@/constants/regions':{DOE_REGIONS:[{code:'SOUTH_LUZON',name:'South Luzon'}]}};
const reportFile=path.resolve(__dirname,'../app/(tabs)/prices/report.tsx');
function setup({manual=false,stationError=false,fuelError=false,submitError=false,platform='ios',deferFuel=false,general=false}={}){
 const events={},submitted=[],created=[],navigation=[],scrolls=[];let fuelCalls=0,fuelResolve,keyboardVisible=false;
 const selected={id:'official-id',name:'Real database station',address:'CALAMBA CITY, LAGUNA',source_type:'official_directory',brand_label:null,company:{id:'company-id',name:'SEAOIL',slug:'seaoil'}};
 const fuelPending=new Promise(resolve=>fuelResolve=resolve);
 const keyboard={isVisible:()=>keyboardVisible,metrics:()=>({screenY:400}),dismiss:()=>{keyboardVisible=false},addListener:(name,callback)=>{events[name]=callback;return{remove(){delete events[name]}}}};
 const h=harness(reportFile,{...theme,
 '@/constants/Theme':{GasTaColors:{},radii:{},spacing:{md:16,sm:8,lg:24,xxl:48},palette:{}},
 'react-native':{Keyboard:keyboard},
 'expo-router':{useRouter:()=>({canGoBack:()=>true,back:()=>navigation.push('back'),replace:route=>navigation.push(route),navigate:route=>navigation.push(route),push:()=>{}}),useLocalSearchParams:()=>manual?{region:'SOUTH_LUZON'}:{...(general?{source:'community-general',company_slug:'seaoil',area:'Calamba'}:{}),station_id:'official-id',station_name:'wrong route name',region:'SOUTH_LUZON',fuel_type:'RON_91'}},
 '@/constants/regions':{DOE_REGIONS:[{code:'SOUTH_LUZON',name:'South Luzon'}],REGION_CENTROIDS:{SOUTH_LUZON:{latitude:1,longitude:2}}},
 '@/constants/fuelTypes':{DOE_FUEL_TYPES:[{code:'RON_91',name:'RON 91'}]},
 '@/constants/communityReports':{VERIFY_CONFIRMATIONS_REQUIRED:3},
 '@/context/AuthProvider':{useAuth:()=>({user:{id:'user'},loading:false})},
 '@/lib/format':{formatCurrency:n=>`₱${n.toFixed(2)}`},
 '@/lib/services/stationDirectory':{fetchReportStation:async()=>{if(stationError)throw Error('secret postgres row');return selected}},
 '@/lib/services/communityReports':{fetchFuelStationsByRegion:async()=>[],fetchOilCompanies:async()=>[selected.company],findOilCompanyByName:async()=>selected.company.id,createFuelStation:async args=>{created.push(args);return 'created-id'},submitCommunityReport:async args=>{if(submitError)throw Error('secret postgres details');submitted.push(args)}},
 '@/lib/supabase':{isSupabaseConfigured:true,supabase:{from:()=>({select(){return this},eq(){return this},single:async()=>{fuelCalls++;if(deferFuel)return fuelPending;return fuelError?{error:{message:'secret postgres details'}}:{data:{id:'fuel-id'},error:null}}})}},
 },platform);
 return{h,selected,submitted,created,navigation,events,scrolls,get fuelCalls(){return fuelCalls},resolveFuel:()=>fuelResolve({data:{id:'fuel-id'},error:null}),showKeyboard(){keyboardVisible=true}};
}
const priceNode=h=>find(h.tree,n=>n.props?.accessibilityLabel==='Observed price per liter');
const submitNode=h=>find(h.tree,n=>n.props?.accessibilityLabel==='Submit report');
function collectText(n){if(Array.isArray(n))return n.map(collectText).join(' ');if(typeof n==='string')return n;if(!n||typeof n!=='object')return '';return collectText(n.props?.children)}
test('selected identity is locked and read from DB; fuel retained and price blank',async()=>{
 const {h}=setup();await h.flush({});
 for(const label of ['Region','Brand / station type','Or pick a known brand','Station','Or pick a listed station'])assert(!find(h.tree,n=>n.props?.label===label));
 assert(collectText(h.tree).includes('Real database station'));assert(collectText(h.tree).includes('CALAMBA CITY, LAGUNA'));assert(collectText(h.tree).includes('Official directory'));
 assert.equal(find(h.tree,n=>n.props?.label==='Fuel type').props.value,'RON_91');assert.equal(priceNode(h).props.value,'');
});
test('invalid price stays inline without calling backend',async()=>{
 const env=setup();await env.h.flush({});await submitNode(env.h).props.onPress();await env.h.flush();
 assert(collectText(env.h.tree).includes('Enter a valid price per liter.'));assert.equal(env.fuelCalls,0);
});
test('selected station ID submits; modal is explicitly Unverified; Report another resets values',async()=>{
 const env=setup();await env.h.flush({});priceNode(env.h).props.onChangeText('71.25');await env.h.flush();await submitNode(env.h).props.onPress();await env.h.flush();
 assert.equal(env.submitted[0].stationId,'official-id');assert.equal(env.submitted[0].price,71.25);assert.equal(env.created.length,0);
 assert.equal(find(env.h.tree,n=>n.type==='Modal').props.visible,true);assert(collectText(env.h.tree).includes('Unverified'));
 find(env.h.tree,n=>n.props?.label==='Report another').props.onPress();await env.h.flush();assert.equal(priceNode(env.h).props.value,'');assert(collectText(env.h.tree).includes('Real database station'));
});
for(const kind of ['fuelError','submitError'])test(`${kind} is friendly and preserves entered values`,async()=>{
 const env=setup({[kind]:true});await env.h.flush({});priceNode(env.h).props.onChangeText('71.25');find(env.h.tree,n=>n.props?.label==='Notes (optional)').props.onChangeText('Cash price');await env.h.flush();await submitNode(env.h).props.onPress();await env.h.flush();
 const text=collectText(env.h.tree);assert(!text.includes('secret postgres'));assert(text.includes(kind==='fuelError'?"We couldn't load this fuel type.":"We couldn't submit your report right now."));assert.equal(priceNode(env.h).props.value,'71.25');assert.equal(find(env.h.tree,n=>n.props?.label==='Notes (optional)').props.value,'Cash price');
});
test('double taps during fuel lookup cause only one submission',async()=>{
 const env=setup({deferFuel:true});await env.h.flush({});priceNode(env.h).props.onChangeText('71.25');await env.h.flush();const handler=submitNode(env.h).props.onPress;const first=handler();await handler();assert.equal(env.fuelCalls,1);env.resolveFuel();await first;assert.equal(env.submitted.length,1);
});
test('global/manual fallback keeps original fields and station creation',async()=>{
 const env=setup({manual:true});await env.h.flush({});find(env.h.tree,n=>n.props?.label==='Brand / station type').props.onChangeText('SEAOIL');find(env.h.tree,n=>n.props?.label==='Station').props.onChangeText('New real station');priceNode(env.h).props.onChangeText('71.25');await env.h.flush();await submitNode(env.h).props.onPress();assert.equal(env.created.length,1);assert.equal(env.created[0].name,'New real station');assert.equal(env.submitted[0].stationId,'created-id');
});
test('hydration errors are friendly and Change station returns cleanly',async()=>{
 const env=setup({stationError:true});await env.h.flush({});assert(collectText(env.h.tree).includes("We couldn't load the selected station."));assert(!collectText(env.h.tree).includes('secret postgres'));assert.equal(submitNode(env.h).props.disabled,true);find(env.h.tree,n=>n.props?.label==='Change station').props.onPress();assert.deepEqual(env.navigation,['back']);
});
for(const platform of ['ios','android'])test(`${platform} keyboard avoidance scrolls price/notes above keyboard`,async()=>{
 const env=setup({platform});await env.h.flush({});assert.equal(find(env.h.tree,n=>n.type==='KeyboardAvoidingView').props.behavior,platform==='ios'?'padding':'height');
 const scroll=find(env.h.tree,n=>n.type==='ScrollView');assert.equal(scroll.props.keyboardShouldPersistTaps,'handled');scroll.props.ref.current={getNativeScrollRef:()=>({measureInWindow:fn=>fn(0,0,320,600)}),scrollTo:value=>env.scrolls.push(value)};
 const priceContainer=find(env.h.tree,n=>n.type==='View'&&n.props?.ref&&find(n,x=>x.props?.accessibilityLabel==='Observed price per liter'));priceContainer.props.ref.current={measureInWindow:fn=>fn(0,500,320,110)};
 const notesContainer=find(env.h.tree,n=>n.type==='View'&&n.props?.ref&&find(n,x=>x.props?.label==='Notes (optional)'));notesContainer.props.ref.current={measureInWindow:fn=>fn(0,550,320,100)};
 env.showKeyboard();priceNode(env.h).props.onFocus();env.h.frame();assert(env.scrolls[0].y>0);find(env.h.tree,n=>n.props?.label==='Notes (optional)').props.onFocus();env.h.frame();assert(env.scrolls[1].y>env.scrolls[0].y);
});

test('Change station from Community resumes company and geography selector',async()=>{
 const env=setup({general:true});await env.h.flush({});find(env.h.tree,n=>n.type==='Pressable'&&collectText(n).trim()==='Change station').props.onPress();
 const route=env.navigation[0];assert.equal(route.pathname,'/(tabs)/prices/community');assert.equal(route.params.report_flow,'community-general');assert.equal(route.params.report_company,'seaoil');assert.equal(route.params.report_region,'SOUTH_LUZON');assert.equal(route.params.report_area,'Calamba');assert(route.params.report_request);
});
