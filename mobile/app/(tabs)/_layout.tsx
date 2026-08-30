import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { AuthBackground } from '@/components/ui/GlassSurface';
import { tabConfig } from '@/constants/moduleColors';
import { GasTaColors, radii, spacing } from '@/constants/Theme';

function TabIcon({
  name,
  focused,
  color,
}: {
  name: 'local_gas_station' | 'route' | 'directions_car' | 'account_balance_wallet';
  focused: boolean;
  color: ColorValue;
}) {
  const inactive = typeof color === 'string' ? color : GasTaColors.textSoft;

  return (
    <View
      style={[
        styles.iconWrap,
        focused && { backgroundColor: 'rgba(1, 68, 33, 0.1)' },
      ]}>
      <SymbolView
        name={{ android: name }}
        tintColor={focused ? GasTaColors.forest : inactive}
        size={22}
      />
    </View>
  );
}

export default function TabLayout() {
  return (
    <AuthBackground canvas="white">
      <View style={styles.fill}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneContainerStyle: { backgroundColor: 'transparent' },
          tabBarActiveTintColor: GasTaColors.forest,
          tabBarInactiveTintColor: GasTaColors.textSoft,
          tabBarStyle: {
            backgroundColor: GasTaColors.cream,
            borderTopColor: GasTaColors.glassBorderSubtle,
            borderTopWidth: 1,
            paddingTop: spacing.sm,
            height: 64,
            elevation: 8,
            shadowColor: GasTaColors.forest,
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.08,
            shadowRadius: 12,
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
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="local_gas_station" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="trip"
          options={{
            title: tabConfig.trip.label,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="route" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="vehicles"
          options={{
            title: tabConfig.vehicles.label,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="directions_car" focused={focused} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="budget"
          options={{
            title: tabConfig.budget.label,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="account_balance_wallet" focused={focused} color={color} />
            ),
          }}
        />
      </Tabs>
      </View>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
