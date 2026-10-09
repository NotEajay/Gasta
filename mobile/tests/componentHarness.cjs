const fs=require('fs'),vm=require('vm');
const ts=require('../node_modules/typescript');
function harness(file,mods,platform='ios',globals={}){
 let slots=[],cursor=0,effects=[],dirty=true,tree,frames=[],props,focusCallbacks=[];
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((x,i)=>x!==b[i]);
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;dirty=true}]},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value})},useMemo(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value},useEffect(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps)){const prev=slots[i];slots[i]={deps};effects.push(()=>{prev?.cleanup?.();slots[i].cleanup=fn()})}}};react.memo=fn=>fn;react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const rn=new Proxy({Platform:{OS:platform},StyleSheet:{create:x=>x,hairlineWidth:1}},{get:(o,k)=>o[k]??mods['react-native']?.[k]??k});
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
 const exports={}; const requireMock=name=>name==='react'?react:name==='react/jsx-runtime'?jsx:name==='react-native'?rn:name==='@expo/vector-icons'?{Ionicons:'Ionicons',MaterialCommunityIcons:'MaterialCommunityIcons'}:name==='expo-router'?{...mods[name],useFocusEffect:fn=>{focusCallbacks.push(fn);react.useEffect(fn,[fn])}}:mods[name]??{default:name,Text:'Text'};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:requireMock,requestAnimationFrame:fn=>{frames.push(fn);return frames.length},cancelAnimationFrame:()=>{},...globals});
 const render=()=>{cursor=0;dirty=false;focusCallbacks=[];tree=exports.default(props);const batch=effects;effects=[];batch.forEach(fn=>fn())};
 return{async flush(p){if(p){props=p;dirty=true;}for(let i=0;i<12;i++){if(dirty)render();await Promise.resolve()}return tree},get tree(){return tree},focus(){focusCallbacks.forEach(fn=>fn())},unmount(){slots.forEach(slot=>slot?.cleanup?.())},frame(){const all=frames;frames=[];all.forEach(fn=>fn())}};
}
function find(tree,predicate){if(Array.isArray(tree)){for(const item of tree){const result=find(item,predicate);if(result)return result}return null}if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;const children=[tree.props?.children,tree.props?.action];for(const child of Array.isArray(children)?children:[children]){const result=find(child,predicate);if(result)return result}return null}
module.exports={harness,find};
