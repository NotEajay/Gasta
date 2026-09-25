import { Redirect } from 'expo-router';

/** Unknown routes never stay here — bounce to the home tab. */
export default function NotFoundScreen() {
  return <Redirect href="/(tabs)/home" />;
}
