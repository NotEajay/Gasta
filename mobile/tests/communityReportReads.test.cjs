const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('../node_modules/typescript');
function setup(){
 const queries=[];const row={id:'report',reported_price:'70',confirmation_count:2,status:'pending',reported_by:'me',created_at:new Date().toISOString(),station:{name:'Official station',address:'Calamba, Laguna',brand_label:null,oil_company:{name:'SEAOIL',slug:'seaoil'},region:null},fuel_type:{name:'RON 91',code:'RON_91'}};
 const supabase={from:()=>{const query={fields:'',filters:[]};queries.push(query);const q={select(fields){query.fields=fields;return q},eq(...args){query.filters.push(args);return q},order(){return q},limit(){return q},gte(){return q},lt(){return q},in(){return q},then(resolve){return Promise.resolve({data:[row],error:null}).then(resolve)}};return q}};
 const service={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').resolve(__dirname,'../lib/services/communityReports.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:service,require:()=>({supabase}),Date});return{service,queries};
}
for(const method of ['fetchPendingReports','fetchCommunityReports'])test(`${method} unfiltered read retains official null-region station and address`,async()=>{
 const {service,queries}=setup();const rows=await service[method](50);assert.equal(rows[0].station.name,'Official station');assert.equal(rows[0].station.address,'Calamba, Laguna');assert(queries[0].fields.includes('region:regions ('));assert(!queries[0].fields.includes('region:regions!inner'));
});
for(const method of ['fetchPendingReports','fetchCommunityReports'])test(`${method} explicit region filter still requires matching region`,async()=>{
 const {service,queries}=setup();await service[method](50,{regionCode:'SOUTH_LUZON'});assert(queries[0].fields.includes('region:regions!inner'));assert(queries[0].filters.some(([key,value])=>key==='station.region.code'&&value==='SOUTH_LUZON'));
});
