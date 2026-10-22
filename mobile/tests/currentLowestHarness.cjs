const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => mocks[name] ?? {}, console });
  return exports;
}
const fuels = load('constants/fuelTypes.ts');
const theme = load('constants/Theme.ts');
const presentation = load('constants/fuelTypePresentation.ts', { '@/constants/fuelTypes': fuels });
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? style : {};
function currentLowest(options = {}) {
  let fuelType = options.fuelCode ?? 'RON_91';
  const user = { id: 'me' }, queries = [];
  const companies = [{ id:'shell',slug:'shell',name:'Shell' },{ id:'petron',slug:'petron',name:'Petron' }];
  const prices = options.prices ?? [63.45,70];
  const values = options.trend ?? [65,63.45];
  const trend = values.map((price_per_liter,i)=>({ bulletin_date:i ? '2026-10-13':'2026-10-06',coverage_end:i ? '2026-10-19':'2026-10-12',price_per_liter }));
  const rows = () => prices.map((price_per_liter,i)=>({
    id:String(i),price_per_liter,area_name:'',oil_company:companies[i],
    bulletin:{id:'week',bulletin_date:'2026-10-13'},region:{code:'NCR'},fuel_type:{code:fuelType},
  }));
  const h = harness(path.join(root,'app/(tabs)/prices/index.tsx'), {
    'expo-router': { useRouter:()=>({push(){}}) },
    '@/constants/Theme':theme, '@/constants/fuelTypes':fuels, '@/constants/fuelTypePresentation':presentation,
    '@/constants/regions':{DOE_REGIONS:[{code:'NCR',name:'National Capital Region'}]},
    '@/constants/communityReports':{VERIFY_CONFIRMATIONS_REQUIRED:3},
    '@/context/AuthProvider':{useAuth:()=>({user})},
    '@/context/TabBarVisibility':{useTabBarScrollHandler:()=>()=>{}},
    '@/hooks/useResponsive':{useResponsive:()=>({isCompact:(options.width ?? 390)<360})},
    '@/hooks/useFuelPriceDefault':{useFuelPriceDefault:()=>({fuelType,selectFuelType:next=>{fuelType=next},vehicleLabel:null})},
    '@/lib/supabase':{isSupabaseConfigured:true}, '@/lib/useTheme':{useTheme:()=>({})},
    '@/lib/format':{formatCurrency:n=>`₱${n.toFixed(2)}`,formatShortDate:()=> 'Oct 6',formatBulletinRange:()=> 'Oct 13–19',formatDate:()=> 'Oct 13'},
    '@/lib/officialCompanyRows':load('lib/officialCompanyRows.ts'),
    '@/lib/services/location':{resolveCurrentPlace:async()=>null,matchBulletinArea:()=>null},
    '@/lib/services/fuelPrices':{
      fetchLatestBulletinForRegion:async()=>({id:'week',bulletin_date:'2026-10-13'}),
      fetchBulletinsForRegion:async()=>[],fetchBulletinAreas:async()=>[],
      fetchFuelPricesForBulletin:async(...args)=>{queries.push(args);return rows()},
      fetchPriceTrend:async()=>trend,
      getBulletinFreshness:()=>({status:'fresh',daysOld:3,label:'Current'}),
    },
    '@/lib/services/communityReports':{
      fetchCommunityReports:async()=>[],fetchPendingReports:async()=>[],fetchOilCompanies:async()=>companies,
      fetchConfirmedReportIds:async()=>new Set(),
      fetchFreshVerifiedPrices:async()=>options.verified ? [{station_id:'station',reported_price:62,verified_at:'2026-10-20'}] : [],
      fetchFuelStationsByRegion:async()=>options.verified ? [{id:'station',name:'Verified station',oil_company:companies[0]}] : [],
    },
  });
  return { h,queries,prices,trend,
    get card(){return find(h.tree,n=>n.props?.testID==='current-lowest-card')},
    async flush(){await h.flush({})},
    async select(code){find(h.tree,n=>n.props?.label==='Fuel').props.onChange(code);await h.flush({})},
    movement(){const node=find(this.card,n=>typeof n.type==='function'&&n.type.name==='HeroDelta');return node ? node.type(node.props) : null},
  };
}
module.exports={currentLowest,fuels,theme,presentation,flatten};
