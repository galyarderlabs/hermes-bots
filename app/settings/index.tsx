import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { useConnection, disconnectActiveHost } from '../../src/lib/connection-store';
import { fontSize, spacing } from '../../src/theme/tokens';

export default function SettingsHub() {
  const { palette } = useTheme();
  const { activeHost, status, lastProbeAt, lastSyncAt, pendingJournalCount } = useConnection();
  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Settings</Text>
        <Text style={[styles.meta, { color: palette.secondary }]}>
          Host: {activeHost ? `${activeHost.name} (${activeHost.url})` : 'None configured'} · Status: {status}
        </Text>
        <Text style={[styles.meta, { color: palette.secondary }]}>
          Last probe: {lastProbeAt ? new Date(lastProbeAt).toLocaleString() : '—'} · Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'} · Pending journal intents: {pendingJournalCount}
        </Text>
        <Link href="/settings/connection" asChild>
          <GlassButton title="Connection and pairing" variant="primary" onPress={() => {}} />
        </Link>
        <Link href="/settings/notifications" asChild>
          <GlassButton title="Notifications" variant="primary" onPress={() => {}} />
        </Link>
        <Link href="/settings/appearance" asChild>
          <GlassButton title="Appearance" variant="primary" onPress={() => {}} />
        </Link>
        <Link href="/settings/about" asChild>
          <GlassButton title="About" variant="primary" onPress={() => {}} />
        </Link>
        {activeHost ? <GlassButton title="Disconnect host" variant="ghost" destructive onPress={() => void disconnectActiveHost()} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: '600' },
  meta: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
});
