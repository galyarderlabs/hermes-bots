import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';

// Tabs: Bots | Sessions | Tasks only. Settings is a header action, not a tab.
export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.secondary,
        headerRight: () => (
          <Link href="/settings" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Open settings" style={{ paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: palette.accent, fontSize: 17 }}>Settings</Text>
            </Pressable>
          </Link>
        ),
      }}
    >
      <Tabs.Screen name="bots" options={{ title: 'Bots' }} />
      <Tabs.Screen name="sessions" options={{ title: 'Sessions' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
    </Tabs>
  );
}
