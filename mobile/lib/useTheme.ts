import { useColorScheme } from '@/components/useColorScheme';
import { getTheme, type AppTheme } from '@/constants/Theme';

export function useTheme(): AppTheme & { scheme: 'light' | 'dark' } {
  const scheme = useColorScheme();
  return { ...getTheme(scheme), scheme };
}
