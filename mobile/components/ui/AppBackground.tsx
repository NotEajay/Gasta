import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/Theme';

/** One opaque canvas keeps inactive tab scenes from showing through. */
export default function AppBackground({ children }: { children?: ReactNode }) {
  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, overflow: 'hidden' },
});
