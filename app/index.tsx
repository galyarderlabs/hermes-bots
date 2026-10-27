import { Redirect } from 'expo-router';

// Root route: there was no index file, so launching the app resolved
// "/" to Expo Router's "Unmatched Route" screen (hermes:///) instead of
// the Bots tab. Redirect the launch route to the Bots tab.
export default function Index() {
  return <Redirect href="/(tabs)/bots" />;
}
