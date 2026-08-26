import { Stack } from 'expo-router';

import { useTheme } from '@/lib/useTheme';

export default function TripLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
