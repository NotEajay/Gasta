import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack>
      <Stack.Screen name="etl" options={{ title: 'ETL Status & Workflows' }} />
      <Stack.Screen name="users" options={{ title: 'User Management' }} />
    </Stack>
  );
}
