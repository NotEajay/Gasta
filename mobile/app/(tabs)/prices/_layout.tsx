import { Stack } from 'expo-router';

export default function PricesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="community" />
      <Stack.Screen name="report" />
    </Stack>
  );
}
