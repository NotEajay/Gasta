const { test } = require('node:test');
const assert = require('node:assert/strict');
const { find } = require('./componentHarness.cjs');
const { currentLowest,presentation,flatten,theme } = require('./currentLowestHarness.cjs');
const expected = {RON_91:'#1D4F91',RON_95:'#523A9C',RON_97:'#8B5D12',RON_100:'#7A3154',DIESEL:'#245E43',DIESEL_PLUS:'#0A6267',KEROSENE:'#445266'};
function rgb(color,background=[255,255,255]) {
  if(color.startsWith('#'))return color.slice(1,7).match(/../g).map(n=>parseInt(n,16));
  const [r,g,b,a=1]=color.match(/[\d.]+/g).map(Number);
  return [r,g,b].map((v,i)=>v*a+background[i]*(1-a));
}
function luminance(rgb){const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function contrast(fg,bg){const a=luminance(rgb(fg,rgb(bg))),b=luminance(rgb(bg));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node==='string' || typeof node==='number' ? String(node) : node && typeof node==='object' ? text(node.props?.children) : '';
for(const [code,background] of Object.entries(expected)) test(`${code} uses its shared deep card background with readable price, labels and source badge`,async()=>{
  const s=currentLowest({fuelCode:code});await s.flush();assert(s.card);
  const style=flatten(s.card.props.style),fuel=presentation.getFuelTypePresentation(code);
  assert.equal(fuel.cardBackground,background);assert.equal(style.backgroundColor,background);
  assert.equal(style.borderColor,`${fuel.accent}66`);assert(style.shadowOpacity>0&&style.shadowOpacity<=.15);
  const price=find(s.card,n=>n.props?.numberOfLines===1&&n.props?.adjustsFontSizeToFit);
  assert.equal(price.props.children,'₱63.45');assert.equal(flatten(price.props.style).color,'#FFFDF8');
  assert(contrast(flatten(price.props.style).color,background)>=4.5);
  for(const value of ['Current lowest','/L']){
    const label=find(s.card,n=>n.props?.children===value);assert(label);assert(contrast(flatten(label.props.style).color,background)>=4.5);
  }
  const station=find(s.card,n=>n.props?.children==='Shell');
  assert(find(s.card,n=>n.props?.children==='Region-wide DOE price'));
  assert(station);assert(contrast(flatten(station.props.style).color,background)>=4.5);
  const badge=find(s.card,n=>Array.isArray(n.props?.children)&&n.props.children.some(c=>c?.props?.children==='DOE bulletin'));
  const badgeText=find(badge,n=>n.props?.children==='DOE bulletin');
  assert.equal(flatten(badge.props.style).backgroundColor,'#FFF5E7');
  assert.equal(flatten(badgeText.props.style).color,'#0E2A52');
  assert(contrast(flatten(badgeText.props.style).color,flatten(badge.props.style).backgroundColor)>=4.5);
  const graph=find(s.h.tree,n=>n.props?.points&&n.props?.caption);assert.equal(graph.props.fuelCode,code);
  s.h.unmount();
});
test('unknown fuel uses shared neutral slate without guessing a known fuel',async()=>{
  const s=currentLowest({fuelCode:'legacy'});await s.flush();
  assert.equal(flatten(s.card.props.style).backgroundColor,'#445266');assert.equal(presentation.getFuelTypePresentation('legacy').code,null);s.h.unmount();
});
test('fuel switching updates the card and graph together, retaining actual displayed prices and neutral range',async()=>{
  const s=currentLowest();await s.flush();const originalPrices=JSON.stringify(s.prices),originalTrend=JSON.stringify(s.trend);
  for(const [code,background] of Object.entries(expected)){
    await s.select(code);assert.equal(flatten(s.card.props.style).backgroundColor,background);
    assert(text(s.card).includes('₱63.45'));
    const graph=find(s.h.tree,n=>n.props?.points&&n.props?.caption);assert.equal(graph.props.fuelCode,code);
    assert.equal(s.queries.at(-1)[2],code);
  }
  assert.equal(JSON.stringify(s.prices),originalPrices);assert.equal(JSON.stringify(s.trend),originalTrend);
  const range=find(s.h.tree,n=>n.type==='View'&&Array.isArray(n.props?.children)&&n.props.children.some(c=>c?.props?.children?.some?.(t=>t?.props?.children==='Price range')));
  assert(range);assert.equal(flatten(range.props.style).backgroundColor,theme.designSystem.color.surface);
  const before=s.queries.length;await s.flush();assert.equal(s.queries.length,before);s.h.unmount();
});
for(const [name,values,arrow] of [['decrease',[65,63.45],'↓'],['increase',[62,63.45],'↑'],['flat',[63.45,63.45],null]])test(`${name} chip semantics stay independent of every fuel color and remain readable`,async()=>{
  let signature;
  for(const code of Object.keys(expected)){
    const s=currentLowest({fuelCode:code,trend:values});await s.flush();const movement=s.movement();assert(movement);
    const foreground=find(movement,n=>n.type==='Text');const ink=flatten(foreground.props.style).color;
    const bg=flatten(movement.props.style).backgroundColor;
    assert(contrast(ink,bg)>=4.5);const current=JSON.stringify([ink,bg]);if(signature)assert.equal(current,signature);else signature=current;
    if(arrow)assert(text(movement).startsWith(arrow));else assert.equal(text(movement),'No change vs last week');
    s.h.unmount();
  }
});
test('source semantics remain Community verified when the trusted lowest comes from the community',async()=>{
  const s=currentLowest({fuelCode:'RON_95',verified:true});await s.flush();
  assert(text(s.card).includes('₱62.00'));assert(text(s.card).includes('Community verified'));
  assert(!text(s.card).includes('DOE bulletin'));s.h.unmount();
});
