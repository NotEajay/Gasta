import { StyleSheet, TextInput as RNTextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';

interface LabeledInputProps extends TextInputProps {
  label: string;
}

export default function LabeledInput({ label, style, ...props }: LabeledInputProps) {
  const scheme = useColorScheme();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <RNTextInput
        {...props}
        style={[
          styles.input,
          {
            color: scheme === 'dark' ? '#fff' : '#000',
            borderColor: scheme === 'dark' ? '#444' : '#ccc',
            backgroundColor: scheme === 'dark' ? '#111' : '#fff',
          },
          style,
        ]}
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
