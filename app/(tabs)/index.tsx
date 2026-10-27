import { Redirect } from 'expo-router';

// The (tabs) group itself has no screen: navigating to /(tabs) directly
// also fell through to "Unmatched Route". Default it to the Bots tab.
export default function TabsIndex() {
  return <Redirect href="/(tabs)/bots" />;
}
