import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { moduleColors, tabConfig } from '@/constants/moduleColors';
import { radii, spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

function TabIcon({
  name,
  module,
  focused,
  color,
}: {
  name: 'local_gas_station' | 'route' | 'directions_car' | 'account_balance_wallet';
  module: keyof typeof moduleColors;
  focused: boolean;
  color: ColorValue;
}) {
  const scheme = useColorScheme();
  const accent = moduleColors[module];
  const inactive = typeof color === 'string' ? color : '#94A3B8';

  return (
    <View
      style={[
        styles.iconWrap,
        focused && {
          backgroundColor: scheme === 'dark' ? accent.gradientTop : accent.soft,
        },
      ]}>
      <SymbolView
        name={{ android: name }}
        tintColor={focused ? accent.main : inactive}
        size={22}
      />
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: moduleColors.prices.main,
        tabBarInactiveTintColor: colorScheme === 'dark' ? '#64748B' : '#94A3B8',
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? '#0F172A' : '#FFFFFF',
          borderTopColor: colorScheme === 'dark' ? '#1E293B' : '#E2E8F0',
          borderTopWidth: 1,
          paddingTop: spacing.sm,
          height: 64,
          elevation: 12,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginBottom: spacing.xs,
        },
      }}>
      <Tabs.Screen
        name="prices"
        options={{
          title: tabConfig.prices.label,
          tabBarActiveTintColor: moduleColors.prices.main,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="local_gas_station" module="prices" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="trip"
        options={{
          title: tabConfig.trip.label,
          tabBarActiveTintColor: moduleColors.trip.main,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="route" module="trip" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: tabConfig.vehicles.label,
          tabBarActiveTintColor: moduleColors.vehicles.main,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="directions_car" module="vehicles" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: tabConfig.budget.label,
          tabBarActiveTintColor: moduleColors.budget.main,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="account_balance_wallet" module="budget" focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
