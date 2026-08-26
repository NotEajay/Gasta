import { useColorScheme } from '@/components/useColorScheme';
import { getTheme, type AppTheme } from '@/constants/theme';

export function useTheme(): AppTheme & { scheme: 'light' | 'dark' } {
  const scheme = useColorScheme();
  return { ...getTheme(scheme), scheme };
}
