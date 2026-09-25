import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { createContext, useContext } from 'react';

export type TabScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

type TabBarVisibilityValue = {
  handleScroll: (event: TabScrollEvent) => void;
  reset: () => void;
};

const TabBarVisibilityContext = createContext<TabBarVisibilityValue | null>(null);

export function TabBarVisibilityProvider({
  children,
  handleScroll,
  reset,
}: {
  children: React.ReactNode;
  handleScroll: (event: TabScrollEvent) => void;
  reset: () => void;
}) {
  return (
    <TabBarVisibilityContext.Provider value={{ handleScroll, reset }}>
      {children}
    </TabBarVisibilityContext.Provider>
  );
}

function useTabBarVisibility() {
  const context = useContext(TabBarVisibilityContext);
  if (!context) {
    throw new Error('useTabBarVisibility must be used inside TabBarVisibilityProvider');
  }
  return context;
}

export function useTabBarScrollHandler() {
  return useTabBarVisibility().handleScroll;
}
