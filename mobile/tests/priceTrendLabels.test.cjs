const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('../node_modules/typescript');
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../components/prices/priceTrendLabels.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api});
const place=api.placePriceTrendLabels;
function check(points,width,height=124,labelWidth=52){
 const before=JSON.stringify(points),labels=place(points,width,height,labelWidth);
 assert.equal(JSON.stringify(points),before);assert.equal(labels[0].index,points.length-1,'latest value always has first priority');assert(labels.length<=3);
 for(const a of labels){assert(a.left>=0&&a.left+a.width<=width);assert(a.top>=-18&&a.top+a.height<=height);assert(points[a.index]);for(const b of labels){if(a===b)continue;assert(a.left>=b.left+b.width+6||a.left+a.width+6<=b.left||a.top>=b.top+b.height+4||a.top+a.height+4<=b.top,`labels ${a.index}/${b.index} collide`)}}
 return labels;
}
for(const width of [160,186,248,400])test(`${width}px annotations avoid early ₱53.90/₱47.82 collisions and retain the latest value`,()=>{
 const values=[53.9,47.82,54,60,59,58,90,86.79];
 const points=Object.freeze(values.map((value,i)=>Object.freeze({x:i/(values.length-1)*width,y:116-(value-45)*2,value})));
 const labels=check(points,width);assert(labels.length>=2);assert(labels.some(label=>label.index===values.indexOf(47.82)||label.index===values.indexOf(90)));
});
for(const pattern of ['flat','crowded','rising','falling','jagged'])test(`${pattern} series keeps exact data and collision-free labels across phone sizes`,()=>{
 for(const width of [160,186,248])for(const height of [104,124,144]){
  const points=Array.from({length:49},(_,i)=>{const value=pattern==='flat'?60:pattern==='crowded'?60+(i%3)*.01:pattern==='rising'?47.82+i:pattern==='falling'?100-i:70+Math.sin(i)*20;return{x:i/48*width,y:height*.8-(value-45)/60*height*.6,value}});
  check(points,width,height);
 }
});
test('latest value stays visible when it is adjacent to a competing high, with long currency labels',()=>{
 const points=[{x:0,y:50,value:53.9},{x:100,y:18,value:1000.01},{x:110,y:19,value:1000}];
 const labels=check(points,110,124,70);assert.equal(labels[0].index,2);assert(labels.every(label=>label.width===70));
});
test('latest annotation clamps safely at top/bottom edges; unknown layout draws no annotations',()=>{
 for(const y of [0,16])check([{x:0,y,value:47.82}],52,16);
 assert.equal(place([],180,124).length,0);assert.equal(place([{x:0,y:0,value:1}],0,124).length,0);
});
