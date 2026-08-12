/** Transport modes evaluated by the Trip Cost Optimizer MCDA engine. */

export const TRANSPORT_MODES = [
  { code: 'OWN_VEHICLE', name: 'Own Vehicle' },
  { code: 'JEEPNEY', name: 'Jeepney' },
  { code: 'TRICYCLE', name: 'Tricycle' },
  { code: 'RIDE_HAILING', name: 'Ride-hailing' },
  { code: 'WALKING', name: 'Walking' },
] as const;

export type TransportModeCode = (typeof TRANSPORT_MODES)[number]['code'];
