import { getTheme, type AppTheme } from '@/constants/Theme';

/** Always the GasTa light theme — matches web on every device. */
export function useTheme(): AppTheme & { scheme: 'light' | 'dark' } {
  return getTheme('light');
}
