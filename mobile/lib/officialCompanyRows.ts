import type { AreaPriceRow } from '@/components/ui/StationPriceTable';
import type { FuelPriceRow } from '@/lib/services/fuelPrices';

export type SupportedFuelCompany = { id: string; name: string; slug: string };

/** Company visibility comes from the catalog; prices only from this exact DOE scope. */
export function buildOfficialDoeRows(
  companies: SupportedFuelCompany[],
  prices: FuelPriceRow[],
  scope: { bulletinId: string | null; region: string; area: string; fuelType: string }
): AreaPriceRow[] {
  const matching = new Map(prices.filter((row) =>
    row.bulletin.id === scope.bulletinId && row.region.code === scope.region &&
    row.area_name === scope.area && row.fuel_type.code === scope.fuelType
  ).map((row) => [row.oil_company.id, row]));
  return [...companies].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)).map((company) => ({
    id: `doe-company-${company.id}`,
    slug: company.slug,
    brand: company.name,
    areaName: scope.area || scope.region,
    price: matching.get(company.id)?.price_per_liter ?? null,
    source: 'doe_area',
    status: scope.area ? 'DOE Area/Brand Estimate' : 'DOE Region-Wide Estimate',
  }));
}
