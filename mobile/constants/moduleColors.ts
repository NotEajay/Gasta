/** Accent colors per app module — aligned with GasTa cream + forest auth UI. */

const forest = {
  main: '#014421',
  soft: 'rgba(1, 68, 33, 0.08)',
  dark: '#013019',
  gradientTop: '#014421',
  gradientBottom: '#013019',
} as const;

export const moduleColors = {
  prices: forest,
  trip: forest,
  vehicles: forest,
  budget: forest,
  profile: forest,
  community: forest,
} as const;

export type ModuleKey = keyof typeof moduleColors;

export const tabConfig = {
  prices: { label: 'Prices', module: 'prices' as ModuleKey, icon: 'pricetag' as const },
  trip: { label: 'Trip', module: 'trip' as ModuleKey, icon: 'navigate' as const },
  vehicles: { label: 'Vehicles', module: 'vehicles' as ModuleKey, icon: 'car' as const },
  budget: { label: 'Budget', module: 'budget' as ModuleKey, icon: 'wallet' as const },
  profile: { label: 'Profile', module: 'profile' as ModuleKey, icon: 'person' as const },
};
