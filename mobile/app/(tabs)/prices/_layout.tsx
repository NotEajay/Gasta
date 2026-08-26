import { Stack } from 'expo-router';

import { useTheme } from '@/lib/useTheme';

export default function PricesLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="community" />
      <Stack.Screen name="report" />
    </Stack>
  );
}
