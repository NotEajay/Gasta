import { StyleSheet, View, type ViewProps } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';

export default function Card({ style, ...props }: ViewProps) {
  const scheme = useColorScheme();
  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          backgroundColor: scheme === 'dark' ? '#1a1a1a' : '#f7f9fc',
          borderColor: scheme === 'dark' ? '#333' : '#e2e8f0',
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
});
