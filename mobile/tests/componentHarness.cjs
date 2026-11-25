const fs=require('fs'),vm=require('vm');
const ts=require('../node_modules/typescript');
function constantModule(file,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('path').join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>mocks[name]??{}});return exports}
const fuelColors=constantModule('constants/fuelTypeColors.ts');
const fuelTypes=constantModule('constants/fuelTypes.ts');
const fuelPresentation=constantModule('constants/fuelTypePresentation.ts',{'@/constants/fuelTypeColors':fuelColors,'@/constants/fuelTypes':fuelTypes});
const defaultModules={
 '@/hooks/useResponsive':{useResponsive:()=>({width:390,height:844,isCompact:false,isDesktop:false,contentMaxWidth:760,scale:n=>n,horizontalPadding:20})},
 '@/hooks/useReducedMotion':{useReducedMotion:()=>true},
 'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})},
 '@/app/(tabs)/_layout':{floatingNavContentInset:bottom=>bottom+100},
 '@/constants/fuelTypeColors':fuelColors,
 '@/constants/fuelTypePresentation':fuelPresentation,
};
function harness(file,mods,platform='ios',globals={},sourceModules={}){
 mods={...defaultModules,...mods};
 let slots=[],cursor=0,effects=[],dirty=true,tree,frames=[],props,focusCallbacks=[];
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((x,i)=>x!==b[i]);
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;dirty=true}]},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value})},useMemo(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value},useEffect(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps)){const prev=slots[i];slots[i]={deps};effects.push(()=>{prev?.cleanup?.();slots[i].cleanup=fn()})}}};react.useId=()=>{const id=react.useRef(`test-id-${cursor}`);return id.current};react.memo=fn=>fn;react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const rn=new Proxy({Platform:{OS:platform},StyleSheet:{create:x=>x,hairlineWidth:1},useWindowDimensions:()=>({width:390,height:844,scale:1,fontScale:1})},{get:(o,k)=>o[k]??mods['react-native']?.[k]??k});
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
 const cache={};
 const requireMock=name=>name==='react'?react:name==='react/jsx-runtime'?jsx:name==='react-native'?rn:name==='@expo/vector-icons'?{Ionicons:'Ionicons',MaterialCommunityIcons:'MaterialCommunityIcons'}:name==='expo-router'?{...mods[name],useFocusEffect:fn=>{const cleanup=react.useRef();focusCallbacks.push({focus(){cleanup.current?.();cleanup.current=fn()},blur(){cleanup.current?.();cleanup.current=undefined}});react.useEffect(()=>{cleanup.current=fn();return()=>{cleanup.current?.();cleanup.current=undefined}},[fn])}}:mods[name]??(sourceModules[name]?(cache[name]??(cache[name]=evaluate(sourceModules[name]))):{default:name,Text:'Text'});
 function evaluate(source){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:requireMock,requestAnimationFrame:fn=>{frames.push(fn);return frames.length},cancelAnimationFrame:()=>{},...globals});return exports}
 const exports=evaluate(file);
 const render=()=>{cursor=0;dirty=false;focusCallbacks=[];tree=exports.default(props);const batch=effects;effects=[];batch.forEach(fn=>fn())};
 return{async flush(p){if(p){props=p;dirty=true;}for(let i=0;i<12;i++){if(dirty)render();await Promise.resolve()}return tree},get tree(){return tree},focus(){focusCallbacks.forEach(callback=>callback.focus())},blur(){focusCallbacks.forEach(callback=>callback.blur())},unmount(){slots.forEach(slot=>slot?.cleanup?.())},frame(){const all=frames;frames=[];all.forEach(fn=>fn())}};
}
function find(tree,predicate){if(Array.isArray(tree)){for(const item of tree){const result=find(item,predicate);if(result)return result}return null}if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;const children=[tree.props?.children,tree.props?.action];for(const child of Array.isArray(children)?children:[children]){const result=find(child,predicate);if(result)return result}return null}
module.exports={harness,find,fuelColors};
