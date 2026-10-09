import type { DoeRegionCode } from '@/constants/regions';
import { supabase } from '@/lib/supabase';

export interface OfficialStation {
  id: string;
  name: string;
  address: string | null;
  operating_hours: string | null;
  fuel_types: string[];
  source_url: string | null;
  last_synced_at: string | null;
}

/** Directory metadata only: never join DOE estimates or infer branch prices. */
let directoryRequest: Promise<OfficialStation[]> | null = null;

export function fetchSeaoilDirectory(): Promise<OfficialStation[]> {
  if (!directoryRequest) directoryRequest = loadSeaoilDirectory().catch((error) => {
    directoryRequest = null;
    throw error;
  });
  return directoryRequest;
}

async function loadSeaoilDirectory(): Promise<OfficialStation[]> {
  const { data: company, error: companyError } = await supabase
    .from('oil_companies').select('id').eq('slug', 'seaoil').single();
  if (companyError) throw companyError;

  const stations: OfficialStation[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('fuel_stations')
      .select('id, name, address, operating_hours, fuel_types, source_url, last_synced_at')
      .eq('oil_company_id', company.id).eq('source_type', 'official_directory')
      .order('name').order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    stations.push(...(data ?? []).map((row) => ({
      ...row,
      fuel_types: Array.isArray(row.fuel_types)
        ? row.fuel_types.filter((fuel): fuel is string => typeof fuel === 'string' && !!fuel.trim())
        : [],
    })));
    if (!data || data.length < pageSize) return stations;
  }
}

export function stationSearchText(station: OfficialStation): string {
  return `${station.name} ${station.address ?? ''}`.toLowerCase();
}

// Deliberately limited to clear DOE labels and reviewed aliases. Unknown labels
// stay unsupported; do not decode malformed DOE labels or infer stored locality.
const AREA_ALIASES: Record<string, readonly string[]> = {
  rizal: ['rizal'], laguna: ['laguna'], cavite: ['cavite'], batangas: ['batangas'],
  calabarzon: ['cavite', 'laguna', 'batangas', 'rizal', 'quezon'],
  'region iv a': ['cavite', 'laguna', 'batangas', 'rizal', 'quezon'],
  'quezon city': ['quezon city'], 'manila city': ['manila', 'city of manila'],
  'caloocan city': ['caloocan', 'caloocan city'], 'makati city': ['makati', 'makati city'],
  'mandaluyong city': ['mandaluyong', 'mandaluyong city'],
  'marikina city': ['marikina', 'marikina city'], 'pasay city': ['pasay', 'pasay city'],
  'pasig city': ['pasig', 'pasig city'], 'taguig city': ['taguig', 'taguig city'],
  'paranaque city': ['paranaque', 'paranaque city'], 'navotas city': ['navotas', 'navotas city'],
  'valenzuela city': ['valenzuela', 'valenzuela city'],
};
const NCR_ALIASES = [
  ...['quezon city', 'manila city', 'caloocan city', 'makati city', 'mandaluyong city',
    'marikina city', 'pasay city', 'pasig city', 'taguig city', 'paranaque city',
    'navotas city', 'valenzuela city'].flatMap((city) => AREA_ALIASES[city]),
  'las pinas', 'las pinas city', 'malabon', 'malabon city', 'muntinlupa',
  'muntinlupa city', 'san juan city', 'pateros',
];
AREA_ALIASES.ncr = NCR_ALIASES;
AREA_ALIASES['metro manila'] = NCR_ALIASES;
AREA_ALIASES['national capital region'] = NCR_ALIASES;

const QUALIFIED_AREAS: Record<string, { city: readonly string[]; province: string }> = {
  antipolo: { city: ['antipolo', 'antipolo city'], province: 'rizal' },
  'rizal antipolo': { city: ['antipolo', 'antipolo city'], province: 'rizal' },
  calamba: { city: ['calamba', 'calamba city'], province: 'laguna' },
  cabuyao: { city: ['cabuyao', 'cabuyao city'], province: 'laguna' },
  binan: { city: ['binan', 'binan city'], province: 'laguna' },
  'b i n a n': { city: ['binan', 'binan city'], province: 'laguna' },
  'sta rosa': { city: ['sta rosa', 'santa rosa', 'santa rosa city'], province: 'laguna' },
  'san pedro': { city: ['san pedro', 'san pedro city'], province: 'laguna' },
  'san pablo': { city: ['san pablo', 'san pablo city'], province: 'laguna' },
  bacoor: { city: ['bacoor', 'bacoor city'], province: 'cavite' },
  'cavite city': { city: ['cavite city'], province: 'cavite' },
  'general trias': { city: ['general trias', 'general trias city'], province: 'cavite' },
  'tagaytay city': { city: ['tagaytay', 'tagaytay city'], province: 'cavite' },
  'cavite tagaytay city': { city: ['tagaytay', 'tagaytay city'], province: 'cavite' },
  'batangas city': { city: ['batangas city'], province: 'batangas' },
  'lipa city': { city: ['lipa', 'lipa city'], province: 'batangas' },
};
// Macro-region membership follows DOE groups in etl/src/constants.py. Province
// geography: https://psa.gov.ph/classification/psgc/provinces
// Explicit aliases only, matched at the locality end of the official address.
const REGION_LOCALITIES: Record<DoeRegionCode, readonly string[]> = {
  NCR: NCR_ALIASES,
  NORTH_LUZON: [
    'ilocos norte', 'ilocos sur', 'la union', 'pangasinan', 'batanes', 'cagayan',
    'isabela', 'nueva vizcaya', 'quirino', 'aurora', 'bataan', 'bulacan',
    'nueva ecija', 'pampanga', 'tarlac', 'zambales', 'abra', 'apayao',
    'benguet', 'ifugao', 'kalinga', 'mountain province',
    'baguio city', 'angeles city', 'olongapo city',
  ],
  SOUTH_LUZON: [
    'cavite', 'laguna', 'batangas', 'rizal', 'quezon', 'marinduque',
    'occidental mindoro', 'oriental mindoro', 'palawan', 'romblon',
    'albay', 'camarines norte', 'camarines sur', 'catanduanes', 'masbate',
    'sorsogon', 'lucena city', 'puerto princesa city', 'naga city',
  ],
  VISAYAS: [
    'aklan', 'antique', 'capiz', 'guimaras', 'iloilo', 'negros occidental',
    'negros oriental', 'neg occ', 'neg or', 'bohol', 'cebu', 'siquijor',
    'biliran', 'eastern samar', 'northern samar', 'samar', 'western samar',
    'leyte', 'western leyte', 'southern leyte', 'bacolod city', 'iloilo city',
    'cebu city', 'lapu lapu city', 'mandaue city', 'tacloban city',
  ],
  MINDANAO: [
    'zamboanga del norte', 'zamboanga del sur', 'zamboanga sibugay',
    'bukidnon', 'camiguin', 'lanao del norte', 'lanao del sur',
    'misamis occidental', 'misamis oriental', 'davao de oro', 'compostela valley',
    'davao del norte', 'davao del sur', 'davao occidental', 'davao oriental',
    'cotabato', 'north cotabato', 'south cotabato', 'sarangani', 'sultan kudarat',
    'agusan del norte', 'agusan del sur', 'surigao del norte', 'surigao del sur',
    'dinagat islands', 'basilan', 'sulu', 'tawi tawi', 'maguindanao',
    'maguindanao del norte', 'maguindanao del sur', 'zamboanga city',
    'cagayan de oro city', 'iligan city', 'davao city', 'general santos city',
    'butuan city', 'cotabato city',
  ],
};
// Expose individual provinces only when explicit province aliases are known.
for (const tokens of Object.values(REGION_LOCALITIES)) {
  for (const token of tokens) {
    if (token !== 'quezon' && !AREA_ALIASES[token]) AREA_ALIASES[token] = [token];
  }
}
Object.assign(QUALIFIED_AREAS, {
  'laoag city': { city: ['laoag', 'laoag city'], province: 'ilocos norte' },
  'batac city': { city: ['batac', 'batac city'], province: 'ilocos norte' },
  'vigan city': { city: ['vigan', 'vigan city'], province: 'ilocos sur' },
});

export function isSupportedStationRegion(region: string): boolean {
  return !region || Object.prototype.hasOwnProperty.call(REGION_LOCALITIES, region);
}
export function matchesSelectedRegion(station: OfficialStation, region: string): boolean {
  if (!region) return true;
  if (!isSupportedStationRegion(region) || !station.address) return false;
  const matchingRegions = Object.entries(REGION_LOCALITIES).filter(([, aliases]) =>
    aliases.some((alias) => localityEndsWith(station.address!, alias)));
  // Conflicting identities must be reviewed, never assigned to two groups.
  return matchingRegions.length === 1 && matchingRegions[0][0] === region;
}
export function filterStationGeography<T extends OfficialStation>(
  stations: T[], region: string, area: string
): T[] {
  if (!isSupportedStationRegion(region) || !isSupportedStationArea(area)) return [];
  return stations.filter((station) => matchesSelectedRegion(station, region))
    .filter((station) => matchesSelectedArea(station, area));
}

function normalizeArea(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Accept a terminal locality, optionally followed by postcode / Philippines /
// Metro Manila. This excludes street and barangay references earlier in addresses.
function localityEndsWith(address: string, alias: string): boolean {
  const text = normalizeArea(address).replace(/[,]+/g, ' ')
    .replace(/\s+(?:philippines|ph)\s*$/, '').replace(/\s+\d{4}\s*$/, '')
    .replace(/\s+metro manila\s*$/, '').replace(/\s+/g, ' ').trim();
  const lastSegment = normalizeArea(address.split(',').pop() ?? '');
  const excludedPrefixes = alias.endsWith(' city') ? ['brgy', 'barangay']
    : ['brgy', 'barangay', 'street', 'st', 'road', 'rd', 'avenue', 'ave'];
  if (excludedPrefixes.some((prefix) =>
    lastSegment.endsWith(`${prefix} ${alias}`))) return false;
  return text === alias || text.endsWith(` ${alias}`);
}
export function isSupportedStationArea(area: string): boolean {
  const key = normalizeArea(area);
  return !key || key === 'all' || !!AREA_ALIASES[key] || !!QUALIFIED_AREAS[key];
}
export function matchesSelectedArea(station: OfficialStation, area: string): boolean {
  const key = normalizeArea(area);
  if (!key || key === 'all') return true;
  if (!station.address) return false;
  const qualified = QUALIFIED_AREAS[key];
  if (qualified) {
    if (!localityEndsWith(station.address, qualified.province)) return false;
    return qualified.city.some((city) => localityEndsWith(station.address!, `${city} ${qualified.province}`));
  }
  return (AREA_ALIASES[key] ?? []).some((alias) => localityEndsWith(station.address!, alias));
}

export interface ReportStation extends OfficialStation {
  source_type: 'community' | 'official_directory';
  brand_label: string | null;
  company: { id: string; name: string; slug: string };
}

const REPORT_STATION_FIELDS = 'id, brand_label, name, address, operating_hours, fuel_types, source_url, last_synced_at, source_type';
function reportStation(row: {
  id: string; name: string; address: string | null; operating_hours: string | null;
  fuel_types: unknown; source_url: string | null; last_synced_at: string | null;
  source_type: 'community' | 'official_directory';
  brand_label: string | null;
}, company: ReportStation['company']): ReportStation {
  return { ...row, company, fuel_types: Array.isArray(row.fuel_types)
    ? row.fuel_types.filter((fuel): fuel is string => typeof fuel === 'string') : [] };
}

/** Read existing physical station records only; DOE rows are never stations. */
export async function fetchCompanyReportStations(slug: string): Promise<ReportStation[]> {
  const { data: company, error: companyError } = await supabase.from('oil_companies')
    .select('id, name, slug').eq('slug', slug).single();
  if (companyError) throw companyError;
  const result: ReportStation[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('fuel_stations').select(REPORT_STATION_FIELDS)
      .eq('oil_company_id', company.id).order('name').order('id').range(offset, offset + 499);
    if (error) throw error;
    result.push(...(data ?? []).map((row) => reportStation(row, company)));
    if (!data || data.length < 500) return result;
  }
}

/** Re-read route-selected identity rather than trusting editable route metadata. */
export async function fetchReportStation(id: string): Promise<ReportStation> {
  const { data: station, error } = await supabase.from('fuel_stations')
    .select(`${REPORT_STATION_FIELDS}, oil_company_id`).eq('id', id).single();
  if (error) throw error;
  const { data: company, error: companyError } = await supabase.from('oil_companies')
    .select('id, name, slug').eq('id', station.oil_company_id).single();
  if (companyError) throw companyError;
  return reportStation(station, company);
}

/** Approved address aliases for geography selection; not inferred locality data. */
export function supportedStationAreas(region: string): string[] {
  if (!isSupportedStationRegion(region) || !region) return [];
  const provinces = REGION_LOCALITIES[region as DoeRegionCode];
  const qualified = Object.entries(QUALIFIED_AREAS).filter(([, location]) => provinces.includes(location.province)).map(([area]) => area);
  return [...new Set([...provinces, ...qualified])]
    .filter((area) => isSupportedStationArea(area))
    .map((area) => area.replace(/\b\w/g, (letter) => letter.toUpperCase()));
}
