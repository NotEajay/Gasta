import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type ColorValue, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { AuthBackground } from '@/components/ui/GlassSurface';
import AppBackground from '@/components/ui/AppBackground';
import { HomeColors } from '@/constants/home';
import { tabConfig } from '@/constants/moduleColors';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { TabBarVisibilityProvider, type TabScrollEvent } from '@/context/TabBarVisibility';

/**
 * The canvas that sits behind every tab scene.
 *
 * POSITION IS THE WHOLE POINT. This component wraps the `<SafeAreaView>` and the
 * `<Tabs>` themselves, so whatever it paints covers the real viewport — the
 * status bar at the top, and the home indicator / bottom edge at the bottom.
 *
 * A scene cannot do this job. Each scene is nested inside
 * `<SafeAreaView edges={['top']}>`, which pads the top by `insets.top`, and
 * `sceneStyle` pads the bottom by the floating tab bar's height plus the bottom
 * inset. A background painted from inside a scene therefore stops short of both
 * edges, and the parent canvas shows through those strips.
 *
 * `AuthBackground canvas="white"` remains the canvas for every other tab. Only
 * the screens running the cream GasTa experiment — Home, Profile, Budget and
 * Vehicles — swap in `AppBackground`. The floating tab bar is `position:
 * absolute` over this canvas and keeps its own opaque white surface, so the bar
 * reads as floating over cream rather than as a white navigation region.
 */
const CREAM_CANVAS_ROUTES = ['/home', '/profile', '/budget', '/vehicles'];

function isCreamCanvasRoute(pathname: string) {
  return CREAM_CANVAS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * The opaque fill for a tab scene, derived from the same route list the canvas
 * uses so the two can never disagree.
 *
 * WHY A SCENE MUST BE OPAQUE
 *
 * React Navigation's bottom tabs render every mounted scene in the same slot,
 * absolutely positioned on top of each other, with the focused scene at zIndex 0
 * and the rest at zIndex -1. Hiding the losers is `react-native-screens`' job.
 *
 * On native that works: `screensEnabled()` is true, so each scene is wrapped in a
 * real `Screen`, which detaches the inactive ones. On WEB it does not:
 * `screensEnabled()` returns `isNativePlatformSupported`, which is false for
 * `Platform.OS === 'web'`, so `MaybeScreen` silently degrades to a plain `View`
 * and every mounted scene stays painted. With a transparent scene background
 * that means the previously-visited tabs show straight through the active one —
 * the "previous page visible underneath" artefact, and the reason it was so much
 * more obvious in a browser than on a phone.
 *
 * An opaque per-scene background is the platform-agnostic fix: the focused
 * scene covers everything behind it everywhere. The trade-off is deliberate and
 * documented — the AppBackground gradient and its two 0.04-opacity orbs now sit
 * behind opaque scenes rather than showing through them. Both are far too faint
 * to carry the design, and correctness of "one visible page" outranks them.
 */
function canvasColorFor(pathname: string) {
  return isCreamCanvasRoute(pathname) ? GasTaColors.cream : GasTaColors.white;
}

function TabCanvas({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCreamCanvas = isCreamCanvasRoute(pathname);

  if (isCreamCanvas) {
    return <AppBackground>{children}</AppBackground>;
  }

  return <AuthBackground canvas="white">{children}</AuthBackground>;
}

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

/**
 * Bottom clearance a screen's own scroll content must reserve so its last row can
 * be scrolled clear of the floating bar.
 *
 * Exported because a screen may opt OUT of the scene-level padding below (the
 * Home tab does, so its content scrolls behind the bar instead of stopping at a
 * painted strip). When it does, it must reserve exactly the same distance, and
 * this is the single place that number is defined so the two can never drift.
 */
export function floatingNavContentInset(bottomInset: number): number {
  return NAV_BAR_HEIGHT + bottomInset + NAV_BAR_BOTTOM_GAP + spacing.md;
}

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
    previousOffset.current = 0;
    const hideForMapPicker = pathname.includes('pick-map');
    animateTabBar(!hideForMapPicker);
  }, [pathname, animateTabBar]);

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
  const sceneStyle = useMemo(
    () => ({
      // Opaque, and keyed to the route so the active scene always covers the
      // scenes stacked behind it. See `canvasColorFor` for why this matters, and
      // why it is specifically worse on web.
      backgroundColor: canvasColorFor(pathname),
      // Deliberately a static number rather than an Animated interpolation.
      //
      // `sceneStyle` is consumed as a plain style object by React Navigation, not
      // by an Animated component, so an interpolation here was never actually
      // animating; on web it serialised an interpolation object into a CSS
      // length. The bar itself still slides -- only this inset is now fixed,
      // which is the "correctness over animation" trade. The value is always the
      // fully-visible-bar padding, so the last row clears the bar in both states.
      paddingBottom: navBarScenePadding,
    }),
    [navBarScenePadding, pathname],
  );

  return (
    <TabBarVisibilityProvider handleScroll={handleTabBarScroll} reset={resetTabBar}>
      <TabCanvas>
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
                /*
                 * Home opts out of the scene-level bottom padding.
                 *
                 * That padding is a strip of SCENE BACKGROUND below the screen's
                 * own scroll view, and it is what produced the cream band above
                 * the floating bar: Home's dashboard body is `creamLight` while
                 * the scene is `cream`, so the two met in a hard horizontal line
                 * and the page looked like it stopped instead of scrolling.
                 *
                 * With no scene strip the ScrollView fills the screen and the
                 * dashboard body continues behind the floating bar, so there is
                 * no seam at all. Home then reserves the identical distance on
                 * its own content via `floatingNavContentInset`, which keeps the
                 * last row reachable. Every other tab keeps the scene padding, so
                 * this is a Home-only change.
                 *
                 * The scene background is untouched: it stays opaque so the
                 * previous-page stacking fix is preserved.
                 */
                sceneStyle: styles.homeScene,
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
      </TabCanvas>
    </TabBarVisibilityProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /**
   * Home's scene: still opaque (the stacking fix depends on it), but with no
   * painted bottom strip. Home reserves that clearance on its own scroll content
   * instead, so the dashboard body runs behind the floating bar.
   */
  homeScene: { backgroundColor: GasTaColors.cream, paddingBottom: 0 },
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
