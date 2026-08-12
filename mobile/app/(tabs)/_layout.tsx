import { SymbolView } from 'expo-symbols';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/lib/auth';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, signOut } = useAuth();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        headerShown: true,
        headerRight: () =>
          user ? (
            <Pressable onPress={() => signOut()} style={{ marginRight: 16 }}>
              <SymbolView name={{ android: 'logout' }} size={22} tintColor={Colors[colorScheme].text} />
            </Pressable>
          ) : (
            <Link href="/login" asChild>
              <Pressable style={{ marginRight: 16 }}>
                <SymbolView name={{ android: 'login' }} size={22} tintColor={Colors[colorScheme].tint} />
              </Pressable>
            </Link>
          ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Fuel Prices',
          tabBarLabel: 'Prices',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ android: 'local_gas_station' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="trip"
        options={{
          title: 'Trip Optimizer',
          tabBarLabel: 'Trip',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ android: 'route' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: 'My Vehicles',
          tabBarLabel: 'Vehicles',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ android: 'directions_car' }} tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: 'Fuel Budget',
          tabBarLabel: 'Budget',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ android: 'account_balance_wallet' }} tintColor={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}
