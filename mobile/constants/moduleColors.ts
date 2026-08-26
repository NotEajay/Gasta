/** Accent colors per app module — used for heroes, tabs, and section highlights. */

export const moduleColors = {
  prices: {
    main: '#2563EB',
    soft: '#EFF6FF',
    dark: '#1D4ED8',
    gradientTop: '#1E40AF',
    gradientBottom: '#3B82F6',
  },
  trip: {
    main: '#7C3AED',
    soft: '#F5F3FF',
    dark: '#6D28D9',
    gradientTop: '#5B21B6',
    gradientBottom: '#8B5CF6',
  },
  vehicles: {
    main: '#0891B2',
    soft: '#ECFEFF',
    dark: '#0E7490',
    gradientTop: '#155E75',
    gradientBottom: '#06B6D4',
  },
  budget: {
    main: '#059669',
    soft: '#ECFDF5',
    dark: '#047857',
    gradientTop: '#065F46',
    gradientBottom: '#10B981',
  },
  community: {
    main: '#EA580C',
    soft: '#FFF7ED',
    dark: '#C2410C',
    gradientTop: '#9A3412',
    gradientBottom: '#F97316',
  },
} as const;

export type ModuleKey = keyof typeof moduleColors;

export const tabConfig = {
  prices: { label: 'Prices', module: 'prices' as ModuleKey, icon: 'local_gas_station' as const },
  trip: { label: 'Trip', module: 'trip' as ModuleKey, icon: 'route' as const },
  vehicles: { label: 'Vehicles', module: 'vehicles' as ModuleKey, icon: 'directions_car' as const },
  budget: { label: 'Budget', module: 'budget' as ModuleKey, icon: 'account_balance_wallet' as const },
};
