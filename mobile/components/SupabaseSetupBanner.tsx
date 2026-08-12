import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';

export default function SupabaseSetupBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.title}>Supabase not configured</Text>
      <Text style={styles.body}>
        Copy mobile/.env.example to mobile/.env with your Supabase URL and anon key.
        Then run supabase/apply_all.sql in the Dashboard SQL Editor (one-time setup).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ffeeba',
  },
  title: {
    fontWeight: '700',
    color: '#856404',
    marginBottom: 4,
  },
  body: {
    color: '#856404',
    fontSize: 13,
    lineHeight: 18,
  },
});
