const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {harness,find}=require('./componentHarness.cjs');
const theme={'@/constants/Theme':{GasTaColors:{},palette:{},radii:{},spacing:{}}};
const text=n=>Array.isArray(n)?n.map(text).join(' '):typeof n==='string'?n:n&&typeof n==='object'?text(n.props?.children):'';
const button=(h,label)=>find(h.tree,n=>n.type==='Pressable'&&text(n).trim()===label);
function screen({failConfirm=false,failDelete=false,status='pending'}={}){
 let own=[{id:'own',reported_by:'me',status:'pending',reported_price:70,station:{name:'My station'}}];
 const other={id:'other',reported_by:'someone',status:'pending',station:{name:'Other station'}};
 let confirms=0,deletes=0; const periods=[];const user={id:'me'};
 const h=harness(path.resolve(__dirname,'../app/(tabs)/prices/community.tsx'),{...theme,
 'expo-router':{useRouter:()=>({push(){},back(){}}),useLocalSearchParams:()=>({})},
 '@/context/AuthProvider':{useAuth:()=>({user,loading:false})},
 '@/lib/supabase':{isSupabaseConfigured:true},
 '@/lib/format':{formatCurrency:n=>`₱${n}`},
 '@/constants/communityReports':{VERIFY_CONFIRMATIONS_REQUIRED:3},
 '@/lib/services/communityReports':{
 fetchCommunityReports:async(_,args)=>{periods.push(args.recency);return[]},fetchPendingReports:async()=>[other],fetchMyCommunityReports:async()=>own,
 communityReportMatchesRecency:()=>true,canDeleteCommunityReport:s=>s==='pending',
 confirmCommunityReport:async()=>{confirms++;if(failConfirm)throw Error('private postgres')},fetchCommunityReportStatus:async()=>({status,confirmation_count:status==='verified'?3:2}),
 deleteCommunityReport:async()=>{deletes++;if(failDelete)throw Error('private postgres');own=[]},
 }});
 return{h,periods,get confirms(){return confirms},get deletes(){return deletes}};
}
test('community periods and global selector remain available',async()=>{
 const env=screen();await env.h.flush({});
 for(const label of ['Last 7 Days','Last 30 Days','Past']){button(env.h,label).props.onPress();await env.h.flush()}
 assert.deepEqual(env.periods,['recent','7days','30days','past']);
 find(env.h.tree,n=>n.props?.accessibilityLabel==='Report a price').props.onPress();await env.h.flush();
 assert.equal(find(env.h.tree,n=>n.props?.open!==undefined).props.open,true);
});
test('delete requires confirmation; cancel leaves own report intact; confirmed delete refreshes',async()=>{
 const env=screen();await env.h.flush({});button(env.h,'Delete report').props.onPress();await env.h.flush();
 assert.equal(env.deletes,0);assert(text(env.h.tree).includes('Delete price report?'));
 button(env.h,'Cancel').props.onPress();await env.h.flush();assert.equal(env.deletes,0);assert(button(env.h,'Delete report'));
 button(env.h,'Delete report').props.onPress();await env.h.flush();await button(env.h,'Delete').props.onPress();await env.h.flush();
 assert.equal(env.deletes,1);assert(text(env.h.tree).includes('Report deleted'));assert(!button(env.h,'Delete report'));
});
test('delete failure is friendly and preserves report',async()=>{
 const env=screen({failDelete:true});await env.h.flush({});button(env.h,'Delete report').props.onPress();await env.h.flush();await button(env.h,'Delete').props.onPress();await env.h.flush();
 assert(text(env.h.tree).includes("Couldn't delete report"));assert(!text(env.h.tree).includes('private postgres'));assert(button(env.h,'Delete report'));
});
for(const status of ['pending','verified'])test(`confirmation feedback uses actual ${status} status`,async()=>{
 const env=screen({status});await env.h.flush({});button(env.h,'Price is accurate').props.onPress();await env.h.flush();
 assert.equal(env.confirms,1);assert(text(env.h.tree).includes(status==='verified'?'Price verified':'2 of 3 confirmations received.'));
});
test('confirmation failure exposes no technical error',async()=>{
 const env=screen({failConfirm:true});await env.h.flush({});button(env.h,'Price is accurate').props.onPress();await env.h.flush();assert(text(env.h.tree).includes("Couldn't confirm price"));assert(!text(env.h.tree).includes('private postgres'));
});
for(const platform of ['ios','android'])test(`${platform} general report requires region and closes before station selector`,async()=>{
 const company={id:'sea',name:'SEAOIL',slug:'seaoil'};
 const h=harness(path.resolve(__dirname,'../components/GeneralReportFlow.tsx'),{...theme,
 '@/constants/regions':{DOE_REGIONS:[{code:'SOUTH_LUZON',name:'South Luzon'}]},
 '@/lib/services/communityReports':{fetchOilCompanies:async()=>[company]},
 '@/lib/services/stationDirectory':{isSupportedStationRegion:r=>r==='SOUTH_LUZON',supportedStationAreas:r=>r?['Calamba']:[]},
 },platform);
 await h.flush({open:true,onClose(){}});find(h.tree,n=>n.props?.accessibilityLabel==='Choose SEAOIL').props.onPress();await h.flush();
 assert.equal(find(h.tree,n=>n.props?.accessibilityLabel==='Choose station').props.disabled,true);
 button(h,'South Luzon').props.onPress();await h.flush();button(h,'Calamba').props.onPress();await h.flush();
 find(h.tree,n=>n.props?.accessibilityLabel==='Choose station').props.onPress();await h.flush();
 assert.equal(find(h.tree,n=>n.type==='Modal').props.visible,false);
 assert.equal(find(h.tree,n=>n.props&&'context' in n.props).props.context,null);
 if(platform==='ios')find(h.tree,n=>n.type==='Modal').props.onDismiss();else h.frame();await h.flush();
 const context=find(h.tree,n=>n.props&&'context' in n.props).props.context;
 assert.equal(context.region,'SOUTH_LUZON');assert.equal(context.area,'Calamba');assert.equal(context.source,'community-general');assert.equal(context.slug,'seaoil');
});
for(const [status,historical,label] of [['verified',false,'Verified'],['verified',true,'Verified · Historical'],['needs_review',false,'Needs review'],['rejected',false,'Rejected'],['pending',false,'Needs confirmation']])test(`card displays ${label} without inventing address`,async()=>{
 const h=harness(path.resolve(__dirname,'../components/CommunityReportCard.tsx'),{...theme,
 '@/constants/Theme':{GasTaColors:{},colors:{},palette:{},radii:{},spacing:{}},
 '@/constants/communityReports':{VERIFY_CONFIRMATIONS_REQUIRED:3},
 '@/lib/format':{formatCurrency:()=> '₱70.00',formatRelativeReportAge:()=> '2h ago',formatDate:()=> 'Oct 9'},
 '@/lib/services/communityReports':{isHistoricalCommunityReport:()=>historical},
 });
 await h.flush({report:{status,confirmation_count:2,reported_price:70,station:{name:'Real station'},fuel_type:{name:'RON 91'}},awaiting:true});
 assert(text(h.tree).includes(label));assert(text(h.tree).includes('₱70.00'));assert(text(h.tree).includes('RON 91'));assert(!text(h.tree).includes('Unknown address'));
});
