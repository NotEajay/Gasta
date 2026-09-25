import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthBackground } from '@/components/ui/GlassSurface';
import { TabBarVisibilityProvider, type TabScrollEvent } from '@/context/TabBarVisibility';
import { HomeColors } from '@/constants/home';
import { tabConfig } from '@/constants/moduleColors';
import { GasTaColors, radii, spacing } from '@/constants/Theme';

const tabIconNames = {
  home: { active: 'home', inactive: 'home-outline' },
  prices: { active: 'pricetag', inactive: 'pricetag-outline' },
  trip: { active: 'navigate', inactive: 'navigate-outline' },
  vehicles: { active: 'car', inactive: 'car-outline' },
  budget: { active: 'wallet', inactive: 'wallet-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
} as const;

type TabIconKey = keyof typeof tabIconNames;

function TabIcon({
  name,
  focused,
  color,
}: {
  name: TabIconKey;
  focused: boolean;
  color: ColorValue;
}) {
  const inactive = typeof color === 'string' ? color : GasTaColors.textSoft;
  const iconName = focused ? tabIconNames[name].active : tabIconNames[name].inactive;

  return (
    <View
      style={[
        styles.iconWrap,
        focused && { backgroundColor: HomeColors.primarySoft },
      ]}>
      <Ionicons
        name={iconName}
        size={22}
        color={focused ? HomeColors.primary : inactive}
      />
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tabBarHeight = 64 + insets.bottom;
  const tabBarHeightValue = useRef(new Animated.Value(tabBarHeight)).current;
  const tabBarPaddingTopValue = useRef(new Animated.Value(spacing.sm)).current;
  const tabBarPaddingBottomValue = useRef(new Animated.Value(insets.bottom)).current;
  const tabBarTranslateY = useRef(new Animated.Value(0)).current;
  const tabBarOpacity = useRef(new Animated.Value(1)).current;
  const tabBarBorderWidth = useRef(new Animated.Value(1)).current;
  const previousOffset = useRef(0);

  const animateTabBar = useCallback(
    (visible: boolean) => {
      Animated.parallel([
        Animated.timing(tabBarHeightValue, {
          toValue: visible ? tabBarHeight : 0,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(tabBarPaddingTopValue, {
          toValue: visible ? spacing.sm : 0,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(tabBarPaddingBottomValue, {
          toValue: visible ? insets.bottom : 0,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(tabBarTranslateY, {
          toValue: visible ? 0 : tabBarHeight,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(tabBarOpacity, {
          toValue: visible ? 1 : 0,
          duration: 180,
          useNativeDriver: false,
        }),
        Animated.timing(tabBarBorderWidth, {
          toValue: visible ? 1 : 0,
          duration: 180,
          useNativeDriver: false,
        }),
      ]).start();
    },
    [
      insets.bottom,
      tabBarBorderWidth,
      tabBarHeight,
      tabBarHeightValue,
      tabBarOpacity,
      tabBarPaddingBottomValue,
      tabBarPaddingTopValue,
      tabBarTranslateY,
    ],
  );

  const handleTabBarScroll = useCallback(
    (event: TabScrollEvent) => {
      const offset = Math.max(0, event.nativeEvent.contentOffset.y);
      const delta = offset - previousOffset.current;

      if (offset <= 24 || delta < -2) {
        animateTabBar(true);
      } else if (delta > 2 && offset > 72) {
        animateTabBar(false);
      }

      previousOffset.current = offset;
    },
    [animateTabBar],
  );

  const resetTabBar = useCallback(() => {
    previousOffset.current = 0;
    animateTabBar(true);
  }, [animateTabBar]);

  useEffect(() => {
    previousOffset.current = 0;
    const hideForMapPicker = pathname.includes('pick-map');
    animateTabBar(!hideForMapPicker);
  }, [pathname, animateTabBar]);

  const tabBarStyle = useMemo(
    () => ({
      ...styles.tabBar,
      height: tabBarHeightValue,
      paddingTop: tabBarPaddingTopValue,
      paddingBottom: tabBarPaddingBottomValue,
      opacity: tabBarOpacity,
      borderTopWidth: tabBarBorderWidth,
      transform: [{ translateY: tabBarTranslateY }],
    }),
    [
      tabBarHeightValue,
      tabBarOpacity,
      tabBarBorderWidth,
      tabBarPaddingBottomValue,
      tabBarPaddingTopValue,
      tabBarTranslateY,
    ],
  );

  return (
    <TabBarVisibilityProvider handleScroll={handleTabBarScroll} reset={resetTabBar}>
      <AuthBackground canvas="white">
        <SafeAreaView edges={['top']} style={styles.fill}>
          <Tabs
            initialRouteName="home"
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: 'transparent' },
              tabBarActiveTintColor: HomeColors.primary,
              tabBarInactiveTintColor: GasTaColors.textSoft,
              tabBarStyle: tabBarStyle as unknown as ViewStyle,
              tabBarLabelStyle: {
                fontSize: 11,
                fontWeight: '700',
                marginBottom: spacing.xs,
              },
            }}>
            <Tabs.Screen
              name="home"
              options={{
                title: 'Home',
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="home" focused={focused} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="prices"
              options={{
                title: tabConfig.prices.label,
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="prices" focused={focused} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="trip"
              options={{
                title: tabConfig.trip.label,
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="trip" focused={focused} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="vehicles"
              options={{
                title: tabConfig.vehicles.label,
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="vehicles" focused={focused} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="budget"
              options={{
                title: tabConfig.budget.label,
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="budget" focused={focused} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="profile"
              options={{
                title: tabConfig.profile.label,
                tabBarIcon: ({ color, focused }) => (
                  <TabIcon name="profile" focused={focused} color={color} />
                ),
              }}
            />
          </Tabs>
        </SafeAreaView>
      </AuthBackground>
    </TabBarVisibilityProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabBar: {
    overflow: 'hidden',
    backgroundColor: GasTaColors.cream,
    borderTopColor: GasTaColors.glassBorderSubtle,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
