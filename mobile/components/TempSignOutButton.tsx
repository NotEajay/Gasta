import { View, Button, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { signOut } from '@/lib/auth';

export function TempSignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert('Sign out failed', error);
      return;
    }
    router.replace('/');
  };

  return (
    <View style={{ padding: 16 }}>
      <Button title="Sign Out (temp)" onPress={handleSignOut} />
    </View>
  );
}