const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../node_modules/typescript');
const {harness,find}=require('./componentHarness.cjs');
const {theme}=require('./currentLowestHarness.cjs');
const root=path.resolve(__dirname,'..');
const code=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const documentModule={};vm.runInNewContext(code('components/maps/stationMapDocument.ts'),{exports:documentModule});
const station={placeId:'places/caltex',name:'Caltex Naga',address:'Naga City',latitude:13.63,longitude:123.19,distanceKm:1,attributions:[]};
const origin={latitude:13.62,longitude:123.18};
const config={origin,stations:[station],apiKey:'public-display-key',mapId:'DEMO_MAP_ID',channel:'test-channel'};
test('map bridge accepts only current-map messages and known station IDs',()=>{
 const read=documentModule.readStationMapMessage,ids=new Set([station.placeId]);
 assert.equal(read('not JSON','test-channel',ids),null);
 assert.equal(read({type:'select',channel:'old-map',placeId:station.placeId},'test-channel',ids),null);
 assert.equal(read({type:'select',channel:'test-channel',placeId:'unknown'},'test-channel',ids),null);
 assert.equal(read({type:'select',channel:'test-channel',placeId:station.placeId},'test-channel',ids).placeId,station.placeId);
 assert.equal(read(JSON.stringify({type:'ready',channel:'test-channel'}),'test-channel',ids).type,'ready');
});
test('HTML safely encodes station names and does not turn provider labels into scripts',()=>{
 const html=documentModule.createStationMapHtml({...config,stations:[{...station,name:'</script><script>alert(1)</script>\u2028'}]});
 assert(!html.includes('</script><script>alert(1)'));
 assert(html.includes('\\u003c/script\\u003e'));
 assert(html.includes('pin.textContent=String(index+1)'));assert(!html.includes('innerHTML'));
});
function runtime(){
 const sent=[],created=[],markers=[],timers=[];
 function element(tag){const listeners={};const classes=new Set();const e={tag,listeners,classList:{add:n=>classes.add(n),remove:n=>classes.delete(n)},setAttribute(){},addEventListener:(n,f)=>listeners[n]=f};created.push(e);return e;}
 class Bounds{extend(){}}
 class Map{constructor(el,options){this.options=options;this.controls={TOP_LEFT:[]}}fitBounds(){}getZoom(){return 14}setZoom(){}panTo(){}}
 class Marker{constructor(options){this.options=options;this.listeners={};markers.push(this)}addListener(name,fn){this.listeners[name]=fn}}
 const google={maps:{importLibrary:async name=>name==='maps'?{Map}:{AdvancedMarkerElement:Marker},LatLngBounds:Bounds,event:{addListenerOnce(){}},ControlPosition:{TOP_LEFT:'TOP_LEFT'}}};
 const window={ReactNativeWebView:{postMessage:raw=>sent.push(JSON.parse(raw))}};
 const document={createElement:element,getElementById:()=>({}),head:{appendChild:el=>created.push(el)}};
 const context={window,document,google,setTimeout:fn=>{timers.push(fn);return 1},clearTimeout(){}};
 const html=documentModule.createStationMapHtml(config);vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 return {sent,created,markers,timers,window};
}
test('Google map draws origin and station pins; selecting a pin sends only its ID',async()=>{
 const s=runtime();await s.window.initStationMap();
 assert.equal(s.markers.length,2);assert.equal(s.markers[1].options.title,'Caltex Naga');
 assert.equal(s.sent[0].type,'ready');s.markers[1].listeners.click();
 assert.equal(s.sent[1].type,'select');assert.equal(s.sent[1].placeId,station.placeId);assert(!JSON.stringify(s.sent).includes('public-display-key'));
 const script=s.created.find(e=>e.tag==='script');assert(script.src.startsWith('https://maps.googleapis.com/maps/api/js?'));assert(script.src.includes('libraries=marker'));
});
test('SDK load, authentication and timeout failures send a friendly error state',()=>{
 for(const fail of [s=>s.window.gm_authFailure(),s=>s.created.find(e=>e.tag==='script').onerror(),s=>s.timers[0]()]){const s=runtime();fail(s);assert.equal(s.sent.at(-1).type,'error')}
});
test('map controller ignores stale document messages after a retry',async()=>{
 const selected=[];const h=harness(path.join(root,'components/maps/GoogleStationMap.tsx'),{'@/constants/Theme':theme,'./stationMapDocument':documentModule},'web',{process:{env:{EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:'public'}}});
 await h.flush({origin,stations:[station],onSelect:id=>selected.push(id)});
 const surface=()=>find(h.tree,n=>n.props?.html&&n.props?.onMessage);
 const initial=surface().props;const channel=JSON.parse(initial.html.match(/var config=(.*);/)[1]).channel;
 initial.onMessage({type:'select',channel,placeId:station.placeId});assert.equal(selected.length,1);
 initial.onMessage({type:'error',channel});await h.flush();find(h.tree,n=>n.props?.accessibilityLabel==='Retry Google Maps').props.onPress();await h.flush();
 surface().props.onMessage({type:'select',channel,placeId:station.placeId});assert.equal(selected.length,1);h.unmount();
});
test('native WebView passes bridge messages and blocks unrelated top-level navigation',async()=>{
 const messages=[],links=[];const h=harness(path.join(root,'components/maps/StationMapSurface.native.tsx'),{'react-native-webview':{WebView:'WebView'},'react-native':{Linking:{openURL:async url=>links.push(url)}}},'ios',{process:{env:{EXPO_PUBLIC_SITE_URL:'https://app.example'}},URL});
 await h.flush({html:'<html></html>',onMessage:v=>messages.push(v),onError(){}});
 assert.equal(h.tree.props.source.baseUrl,'https://app.example/');
 h.tree.props.onMessage({nativeEvent:{data:'selected'}});assert.equal(messages[0],'selected');
 assert.equal(h.tree.props.onShouldStartLoadWithRequest({url:'about:blank'}),true);
 assert.equal(h.tree.props.onShouldStartLoadWithRequest({url:'https://unrelated.example/'}),false);
 assert.equal(h.tree.props.onShouldStartLoadWithRequest({url:'https://www.google.com/maps'}),false);assert.equal(links.length,1);h.unmount();
});
