import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

/**
 * On web, transparent tab scenes can remain in the document flow when blurred,
 * so Vehicles / Budget / Profile paint on top of each other. Hide the subtree
 * entirely while unfocused. Native tabs already detach/hide inactive scenes.
 */
export default function HideWhenBlurred({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return (
    <View
      style={[styles.fill, !focused && styles.hidden]}
      pointerEvents={focused ? 'auto' : 'none'}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'yes' : 'no-hide-descendants'}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
});
