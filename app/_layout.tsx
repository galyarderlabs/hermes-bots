import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/theme/theme-context';
import { GlassToastProvider } from '../src/components/glassyui/GlassToast';

// Root: theme resolved before paint (system default), toast viewport once.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <GlassToastProvider>
          <Stack screenOptions={{ headerShown: true }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[sessionId]" options={{ title: 'Chat' }} />
            <Stack.Screen name="chat/new" options={{ title: 'New chat' }} />
            <Stack.Screen name="group/[groupName]" options={{ title: 'Group chat' }} />
            <Stack.Screen name="group/new" options={{ title: 'New group' }} />
            <Stack.Screen name="bot/new" options={{ title: 'New bot' }} />
            <Stack.Screen name="bot/[profile]/settings" options={{ title: 'Bot settings' }} />
            <Stack.Screen name="bot/[profile]/capabilities" options={{ title: 'Capabilities' }} />
            <Stack.Screen name="bot/[profile]/routines" options={{ title: 'Routines' }} />
            <Stack.Screen name="bot/[profile]/computer" options={{ title: 'Computer' }} />
            <Stack.Screen name="tasks/new" options={{ title: 'New task' }} />
            <Stack.Screen name="tasks/[jobId]" options={{ title: 'Task detail' }} />
            <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
            <Stack.Screen name="settings/connection" options={{ title: 'Connection' }} />
            <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
            <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
            <Stack.Screen name="settings/about" options={{ title: 'About' }} />
            <Stack.Screen name="(modals)/clarify" options={{ presentation: 'modal', title: 'Clarification' }} />
            <Stack.Screen name="(modals)/approval" options={{ presentation: 'modal', title: 'Approval' }} />
          </Stack>
        </GlassToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
