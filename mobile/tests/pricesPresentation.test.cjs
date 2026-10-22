const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {harness,find}=require('./componentHarness.cjs');
const {theme,flatten}=require('./currentLowestHarness.cjs');
for(const platform of ['android','web'])test(`${platform} DOE expansion cancels motion and remains readable when reduced motion changes`,async()=>{
 let reduced=false,stopped=0;const calls=[];
 class Value{constructor(value){this.value=value}setValue(value){this.value=value}}
 const Animated={Value,View:'AnimatedView',timing:(value,options)=>{calls.push(options);return{start(){},stop(){stopped++}}}};
 const h=harness(path.resolve(__dirname,'../components/ui/CompanyEstimateCard.tsx'),{
  '@/constants/Theme':theme,'@/hooks/useReducedMotion':{useReducedMotion:()=>reduced},'react-native':{Animated},'@/lib/format':{formatCurrency:n=>'₱'+n},
 },platform);
 const props={company:'Caltex',slug:'caltex',price:91.29,sourceLabel:'DOE Area/Brand Estimate',fuelCode:'DIESEL',children:'Existing details',expanded:false};
 await h.flush(props);assert.equal(calls.length,0);
 await h.flush({...props,expanded:true});assert.equal(calls.length,1);assert.equal(calls[0].duration,180);assert.equal(calls[0].useNativeDriver,platform!=='web');
 await h.flush({...props,expanded:true,price:91.3});assert.equal(calls.length,1,'data updates do not replay the reveal');
 reduced=true;await h.flush({...props,expanded:true});assert(stopped>0);assert.equal(flatten(find(h.tree,n=>n.type==='AnimatedView').props.style).opacity,1);assert.equal(find(h.tree,n=>n.type==='AnimatedView').props.children[0],'Existing details');
 await h.flush(props);assert(!find(h.tree,n=>n.type==='AnimatedView'));await h.flush({...props,expanded:true});assert.equal(calls.length,1);assert.equal(flatten(find(h.tree,n=>n.type==='AnimatedView').props.style).opacity,1);h.unmount();
});
