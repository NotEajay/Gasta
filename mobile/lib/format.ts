export function formatCurrency(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString('en-PH', { month: 'long' });
}

export function transportModeLabel(code: string): string {
  const labels: Record<string, string> = {
    OWN_VEHICLE: 'Own Vehicle',
    JEEPNEY: 'Jeepney',
    TRICYCLE: 'Tricycle',
    RIDE_HAILING: 'Ride-hailing',
    WALKING: 'Walking',
  };
  return labels[code] ?? code;
}
