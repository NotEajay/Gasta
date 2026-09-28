import { useFonts } from 'expo-font';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AppProviders, RootStack } from '@/components/auth/AuthGate';
import { GasTaColors } from '@/constants/Theme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

const GasTaNavigationTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: GasTaColors.forest,
    background: GasTaColors.white,
    card: GasTaColors.cream,
    text: GasTaColors.textPrimary,
    border: GasTaColors.glassBorderSubtle,
    notification: GasTaColors.forest,
  },
};

function RootLayoutNav() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={GasTaNavigationTheme}>
        <StatusBar style="dark" />
        <AppProviders>
          <RootStack />
        </AppProviders>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
