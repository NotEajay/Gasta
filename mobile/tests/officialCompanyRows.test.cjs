const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('../node_modules/typescript');const path=require('node:path');
const service={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../lib/officialCompanyRows.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:service});
const companies=['Shell','Clean Fuel','My Gas','Jetti','SEAOIL','Petron','Caltex'].map(name=>({id:name, name,slug:name.toLowerCase().replace(' ','-')}));
const scope={bulletinId:'week',region:'SOUTH_LUZON',area:'Calamba',fuelType:'RON_91'};
const price=(name,overrides={})=>({id:name,oil_company:companies.find(c=>c.name===name),price_per_liter:70,region:{code:scope.region},area_name:scope.area,fuel_type:{code:scope.fuelType},bulletin:{id:scope.bulletinId},...overrides});
const build=(prices=[],s=scope)=>Array.from(service.buildOfficialDoeRows(companies,prices,s));
test('catalog companies persist whether Clean Fuel has a price or not; order does not follow prices',()=>{
 const available=build([price('Clean Fuel'),price('SEAOIL'),price('Petron'),price('Shell'),price('Caltex')]);const unavailable=build([price('SEAOIL')]);
 assert.deepEqual(available.map(r=>r.brand),['Caltex','Clean Fuel','Jetti','My Gas','Petron','SEAOIL','Shell']);assert.deepEqual(unavailable.map(r=>r.id),available.map(r=>r.id));
 assert.equal(available.find(r=>r.brand==='Clean Fuel').price,70);assert.equal(unavailable.find(r=>r.brand==='Clean Fuel').price,null);
 for(const name of ['Jetti','My Gas'])assert.equal(available.find(r=>r.brand===name).price,null);
 for(const name of ['Petron','Shell','Caltex','SEAOIL'])assert.equal(available.find(r=>r.brand===name).price,70);
});
for(const [label,overrides] of [['area',{area_name:'Los Banos'}],['region',{region:{code:'NCR'}}],['fuel',{fuel_type:{code:'DIESEL'}}],['bulletin',{bulletin:{id:'older'}}]])test(`no fallback to another ${label}`,()=>assert.equal(build([price('Clean Fuel',overrides)]).find(r=>r.brand==='Clean Fuel').price,null));
test('region-only scope accepts only region-wide DOE rows',()=>{
 const rows=build([price('SEAOIL'),price('Petron',{area_name:''})],{...scope,area:''});assert.equal(rows.find(r=>r.brand==='SEAOIL').price,null);assert.equal(rows.find(r=>r.brand==='Petron').price,70);assert(rows.every(r=>r.status==='DOE Region-Wide Estimate'));
});
test('missing bulletin keeps every company visible without prices',()=>assert(build([price('SEAOIL')],{...scope,bulletinId:null}).every(r=>r.price===null)));
const {harness,find}=require('./componentHarness.cjs');
const theme={'@/constants/Theme':{GasTaColors:{},palette:{},radii:{},spacing:{sm:8,md:16}}};
test('unavailable company still expands and opens selector with active context, including SEAOIL',async()=>{
 const h=harness(path.resolve(__dirname,'../components/ui/StationPriceTable.tsx'),{...theme,'expo-router':{useRouter:()=>({push(){}})},'@/lib/format':{formatCurrency:n=>String(n)}});
 await h.flush({rows:[],areaRows:build(),fuelType:'RON_91',region:'SOUTH_LUZON',selectedArea:'Calamba'});
 find(h.tree,n=>n.props?.accessibilityLabel==='View supported companies').props.onPress();await h.flush();
 for(const slug of ['clean-fuel','jetti','my-gas','seaoil']){
 const card=find(h.tree,n=>n.props?.slug===slug||slug==='seaoil'&&n.props?.doeSummary);assert(card);assert.equal('price' in card.props?card.props.price:card.props.doeSummary?.price,null);assert.equal(card.props.unavailableLabel,'No available price in this area');card.props.onToggle();await h.flush();
 const expanded=find(h.tree,n=>(n.props?.slug===slug||slug==='seaoil'&&n.props?.doeSummary)&&n.props?.expanded);assert(expanded);expanded.props.onReport();await h.flush();
 const selector=find(h.tree,n=>n.props?.context?.slug===slug);assert(selector);assert.equal(selector.props.context.region,'SOUTH_LUZON');assert.equal(selector.props.context.area,'Calamba');assert.equal(selector.props.context.fuelType,'RON_91');assert(!('price' in selector.props.context));
 }
});
test('unavailable card avoids currency formatting, preserves logo and actions',async()=>{
 const h=harness(path.resolve(__dirname,'../components/ui/CompanyEstimateCard.tsx'),{...theme,
 'react-native':{Animated:{Value:class{setValue(){}},timing:()=>({start(){},stop(){}}),View:'Animated.View'}},
 '@/lib/format':{formatCurrency:()=>{throw Error('must not format missing price')}},
 });await h.flush({company:'My Gas',slug:'my-gas',price:null,sourceLabel:'DOE Area/Brand Estimate',unavailableLabel:'No available price in this area',children:'Directory',onReport(){},expanded:true});
 assert(find(h.tree,n=>n.props?.brand==='My Gas'));assert(find(h.tree,n=>n.props?.children==='No available price in this area'));assert(find(h.tree,n=>n.props?.children==='Report station price'));assert(find(h.tree,n=>n.props?.accessibilityState?.expanded===true));
});
