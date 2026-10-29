// Onboarding welcome: flow-board section 01 screen 2. Required as the
// splash screen's Get-started target, so the splash never leads to a
// dead route. Board content verbatim; board light colors forced, not
// the app theme. Header hidden; system back returns to the splash.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { brand, fontSize, lightPalette, radius, spacing } from '../../src/theme/tokens';

const ROWS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  {
    icon: 'link-outline',
    title: 'Connect your host',
    sub: 'Use your existing Hermes or other supported host.',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Tell us what you want to achieve',
    sub: 'Answer a few questions (5WH).',
  },
  {
    icon: 'people-outline',
    title: 'We build your team',
    sub: 'Get the right bots, tools, and configuration.',
  },
  {
    icon: 'rocket-outline',
    title: 'Start working',
    sub: 'Approve and let them work.',
  },
];

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Welcome to GBots</Text>
        <Text style={styles.subtitle}>Your AI team on your phone.</Text>
        <View style={styles.rows}>
          {ROWS.map((row) => (
            <View key={row.title} style={styles.row}>
              <View style={styles.iconTile}>
                <Ionicons name={row.icon} size={24} color={brand.blue} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub}>{row.sub}</Text>
              </View>
            </View>
          ))}
        </View>
        <Pressable
          style={styles.button}
          onPress={() => router.push('/settings/connection')}
        >
          <Text style={styles.buttonText}>Let&apos;s start →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: lightPalette.tile },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.huge,
    paddingBottom: spacing.xl,
    gap: spacing.xxl,
  },
  title: { fontSize: fontSize.display, fontWeight: '700', color: lightPalette.text },
  subtitle: { fontSize: fontSize.body, color: lightPalette.secondary },
  rows: { gap: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: brand.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.body, fontWeight: '700', color: lightPalette.text },
  rowSub: { fontSize: fontSize.secondary, color: lightPalette.secondary },
  button: {
    backgroundColor: brand.blue,
    paddingVertical: spacing.lg,
    borderRadius: radius.capsule,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
});
