// Connection & pairing: saved hosts + entry points to the QR scan /
// manual code screens (analysis/gbots-pairing-design.md). The old
// probe + placeholder pair flow is gone: discovery is GET /api/gbots,
// pairing is POST /api/pair, and the credential stored here is the
// per-device token the pair exchange returned.
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import {
  listHosts,
  readDeviceCredential,
  setActiveHostId,
  type SavedHost,
} from '../../src/lib/auth';
import { GatewayClient } from '../../src/lib/gateway';
import { forwardChatEvent } from '../chat/[sessionId]';
import { setActiveHost } from '../../src/lib/connection-store';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { fontSize, spacing } from '../../src/theme/tokens';

export default function ConnectionScreen() {
  const { palette } = useTheme();
  const [hosts, setHosts] = useState<SavedHost[]>([]);

  useEffect(() => {
    listHosts().then(setHosts).catch(() => {});
  }, []);

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Connection</Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          Tailscale checklist: this phone and your Hermes host must be on the same tailnet. Never
          open port 9119 to the public internet. Never use 127.0.0.1 or localhost here — that
          address points back at this phone.
        </Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          To pair a new host, run `hermes-gateway pair --public-url http://&lt;tailnet-ip&gt;:9120`
          on the host and scan the QR it prints.
        </Text>
        <GlassButton
          title="Scan QR code"
          variant="prominent"
          onPress={() => router.push('/scan')}
        />
        <GlassButton
          title="Enter code manually"
          variant="primary"
          onPress={() => router.push('/scan?mode=manual')}
        />
        <Text style={[styles.label, { color: palette.text }]}>Saved hosts</Text>
        {hosts.length === 0 ? (
          <Text style={[styles.body, { color: palette.secondary }]}>No saved hosts yet.</Text>
        ) : (
          hosts.map((h) => (
            <View key={h.id} style={styles.hostRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.hostName, { color: palette.text }]}>{h.name}</Text>
                <Text style={[styles.body, { color: palette.secondary }]}>{h.url}</Text>
              </View>
              <GlassButton
                title="Use"
                variant="primary"
                onPress={() => {
                  const client = new GatewayClient(h.url, {
                    onEvent: forwardChatEvent,
                    getAuthToken: () => readDeviceCredential(h.id),
                  });
                  setActiveHost(h, client);
                  void setActiveHostId(h.id);
                  router.replace('/(tabs)/bots');
                }}
              />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  body: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  label: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.lg },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hostName: { fontSize: fontSize.body, fontWeight: '600' },
});
