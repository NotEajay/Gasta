const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {harness,find}=require('./componentHarness.cjs');
const row=(slug,price)=>({id:slug,slug,brand:slug,areaName:'NCR',price,source:'doe_area'});
const props={rows:[],region:'NCR',selectedArea:'',fuelType:'RON_91'};
function setup(){return harness(path.resolve(__dirname,'../components/ui/StationPriceTable.tsx'),{'@/constants/Theme':{GasTaColors:{},palette:{},radii:{},spacing:{}},'expo-router':{useRouter:()=>({push(){}})},'@/lib/format':{formatCurrency:n=>String(n)}})}
const disclosure=h=>find(h.tree,n=>n.props?.accessibilityLabel?.includes('companies')&&n.type==='Pressable');
function cards(n,result=[]){if(Array.isArray(n)){n.forEach(x=>cards(x,result));return result}if(!n||typeof n!=='object')return result;if(n.props?.slug&&n.props?.sourceLabel)result.push(n.props.slug);else if(n.props?.doeSummary)result.push('seaoil');cards(n.props?.children,result);return result}
const text=n=>Array.isArray(n)?n.map(text).join(''):typeof n==='string'?n:n&&typeof n==='object'?text(n.props?.children):'';
test('available cards first, unavailable hidden then revealed below with actual count; toggle hides',async()=>{
 const h=setup();await h.flush({...props,areaRows:[row('caltex',80),row('clean-fuel',null),row('jetti',null),row('my-gas',null),row('petron',70),row('seaoil',75),row('shell',90)]});
 assert.deepEqual(cards(h.tree),['caltex','petron','seaoil','shell']);assert(text(h.tree).includes('Show companies without available prices (3)'));assert.equal(disclosure(h).props.accessibilityState.expanded,false);
 disclosure(h).props.onPress();await h.flush();assert.deepEqual(cards(h.tree),['caltex','petron','seaoil','shell','clean-fuel','jetti','my-gas']);assert(text(h.tree).includes('Hide companies without available prices'));
 disclosure(h).props.onPress();await h.flush();assert.deepEqual(cards(h.tree),['caltex','petron','seaoil','shell']);
});
for(const [key,value] of [['region','SOUTH_LUZON'],['selectedArea','Calamba'],['fuelType','DIESEL']])test(`${key} change collapses disclosure and updates count`,async()=>{
 const h=setup();await h.flush({...props,areaRows:[row('caltex',80),row('jetti',null)]});disclosure(h).props.onPress();await h.flush();assert(cards(h.tree).includes('jetti'));
 await h.flush({...props,[key]:value,areaRows:[row('caltex',null),row('jetti',null)]});assert.deepEqual(cards(h.tree),[]);assert.equal(disclosure(h).props.accessibilityState.expanded,false);assert(text(h.tree).includes('View supported companies (2)'));
});
test('all-price case has no disclosure; zero is a valid numeric price',async()=>{const h=setup();await h.flush({...props,areaRows:[row('caltex',0),row('jetti',70)]});assert.equal(disclosure(h),null);assert.deepEqual(cards(h.tree),['caltex','jetti'])});
test('null, undefined, NaN, infinity and strings are unavailable; zero-price list has concise region/area state',async()=>{
 const h=setup();const areaRows=[row('a',null),row('b',undefined),row('c',NaN),row('d',Infinity),row('e','70')];await h.flush({...props,areaRows});assert.deepEqual(cards(h.tree),[]);assert(text(h.tree).includes('No DOE prices available for this region'));assert(text(h.tree).includes('View supported companies (5)'));disclosure(h).props.onPress();await h.flush();assert.equal(cards(h.tree).length,5);for(const slug of ['a','b','c','d','e'])assert.equal(find(h.tree,n=>n.props?.slug===slug).props.price,null);
 await h.flush({...props,selectedArea:'Calamba',areaRows});assert(text(h.tree).includes('No DOE prices available for this area'));assert.deepEqual(cards(h.tree),[]);
});
