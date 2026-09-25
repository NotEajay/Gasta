import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { AuthBackground } from '@/components/ui/GlassSurface';
import { HomeColors } from '@/constants/home';
import { tabConfig } from '@/constants/moduleColors';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { TabBarVisibilityProvider, type TabScrollEvent } from '@/context/TabBarVisibility';

/**
 * Floating nav bar metrics. Declared once so the bar geometry and the content
 * inset that keeps screens scrollable above it can never drift apart.
 */
const NAV_BAR_HEIGHT = 70;
const NAV_BAR_RADIUS = radii.lg;
const NAV_BAR_SIDE_MARGIN = 16;
const NAV_BAR_BOTTOM_GAP = 10;
const NAV_ICON_SIZE = 23;
const NAV_ICON_CHIP = 40;

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
  const iconName = focused ? tabIconNames[name].active : tabIconNames[name].inactive;

  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={iconName} size={NAV_ICON_SIZE} color={color} />
    </View>
  );
}

/** Rendered as a function so active/inactive weight can differ per tab state. */
function TabLabel({
  children,
  color,
  focused,
}: {
  children: string;
  color: ColorValue;
  focused: boolean;
}) {
  return (
    <Text numberOfLines={1} style={[styles.tabLabel, focused && styles.tabLabelActive, { color }]}>
      {children}
    </Text>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const navBarBottom = insets.bottom + NAV_BAR_BOTTOM_GAP;
  // Sides clear the display cutout when the device is rotated into landscape.
  const navBarInset = Math.max(NAV_BAR_SIDE_MARGIN, Math.max(insets.left, insets.right) + 8);
  // Slides fully below the viewport when hidden, so it can never swallow taps.
  const navBarHiddenOffset = NAV_BAR_HEIGHT + navBarBottom + spacing.sm;
  // Reserve room under every screen so the last row scrolls clear of the bar.
  const navBarScenePadding = NAV_BAR_HEIGHT + navBarBottom + spacing.md;

  const navBarVisibility = useRef(new Animated.Value(1)).current;
  const previousOffset = useRef(0);

  const animateTabBar = useCallback(
    (visible: boolean) => {
      // One driver for the bar, so its transform, fade and the content inset
      // that clears it can never animate out of sync.
      Animated.timing(navBarVisibility, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    },
    [navBarVisibility],
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
    resetTabBar();
  }, [pathname, resetTabBar]);

  const tabBarStyle = useMemo(
    () =>
      ({
        ...styles.tabBar,
        // The bar floats free of the screen edges, and the safe-area inset is
        // folded into `bottom` so it can never sit on a home indicator.
        start: navBarInset,
        end: navBarInset,
        left: navBarInset,
        right: navBarInset,
        bottom: navBarBottom,
        height: NAV_BAR_HEIGHT,
        // React Navigation injects its own inset padding; zero it so the inset
        // is applied exactly once, via `bottom` above.
        paddingTop: 0,
        paddingBottom: 0,
        paddingHorizontal: 0,
        opacity: navBarVisibility,
        transform: [
          {
            translateY: navBarVisibility.interpolate({
              inputRange: [0, 1],
              outputRange: [navBarHiddenOffset, 0],
            }),
          },
        ],
      }) as unknown as ViewStyle,
    [navBarBottom, navBarHiddenOffset, navBarInset, navBarVisibility],
  );

  // Applied to every tab scene, so no screen needs its own bottom padding.
  // Animating it keeps the reclaimed space in step with the sliding bar.
  const sceneStyle = useMemo(
    () => ({
      backgroundColor: 'transparent',
      paddingBottom: navBarVisibility.interpolate({
        inputRange: [0, 1],
        outputRange: [spacing.lg, navBarScenePadding],
      }),
    }),
    [navBarScenePadding, navBarVisibility],
  );

  return (
    <TabBarVisibilityProvider handleScroll={handleTabBarScroll} reset={resetTabBar}>
      <AuthBackground canvas="white">
        <SafeAreaView edges={['top']} style={styles.fill}>
          <Tabs
            initialRouteName="home"
            screenOptions={{
              headerShown: false,
              sceneStyle,
              tabBarActiveTintColor: HomeColors.primary,
              tabBarInactiveTintColor: HomeColors.muted,
              tabBarItemStyle: styles.tabBarItem,
              tabBarStyle: tabBarStyle as unknown as ViewStyle,
              tabBarLabel: ({ children, color, focused }) => (
                <TabLabel color={color} focused={focused}>
                  {children}
                </TabLabel>
              ),
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
    position: 'absolute',
    // Must stay visible so the iOS shadow is not clipped by the rounded corners.
    overflow: 'visible',
    zIndex: 10,
    borderRadius: NAV_BAR_RADIUS,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    shadowColor: HomeColors.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  tabBarItem: {
    // Vertical centring only. The 40px chip + 2px label gap + 14px line = 56px
    // of content in a 70px bar leaves 14px of slack, so 7px should sit above the
    // icon and 7px below the label. React Navigation's own item padding starts
    // the group at 5px, which leaves 9px underneath, so nudge it down 2px.
    paddingTop: 2,
  },
  iconWrap: {
    width: NAV_ICON_CHIP,
    height: NAV_ICON_CHIP,
    borderRadius: NAV_ICON_CHIP / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: HomeColors.primarySoft,
  },
  tabLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
