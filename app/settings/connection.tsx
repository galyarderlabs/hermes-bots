import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import {
  listHosts,
  NO_SECURE_SIGNIN_MESSAGE,
  readDeviceCredential,
  refusalForStatus,
  saveHost,
  setActiveHostId,
  storeDeviceCredential,
  supportsSecureSignin,
  validateGatewayUrl,
  type SavedHost,
} from '../../src/lib/auth';
import { GatewayClient } from '../../src/lib/gateway';
import { forwardChatEvent } from '../chat/[sessionId]';
import { setActiveHost, setConnectionStatus, markSynced } from '../../src/lib/connection-store';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassSpinner } from '../../src/components/glassyui/GlassSpinner';
import type { GatewayInfo } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

// Connection & pairing (port-spec §7):
// probe /api/status with a 10s timeout; refusal rule for unauthenticated
// remotes; loopback rejection; Tailscale checklist; saved hosts.
// Per-connection WS tickets are minted per connection, never cached.
export default function ConnectionScreen() {
  const { palette } = useTheme();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [probing, setProbing] = useState(false);
  const [info, setInfo] = useState<GatewayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listHosts().then(setHosts).catch(() => {});
  }, []);

  const probe = async () => {
    const urlError = validateGatewayUrl(url);
    if (urlError) {
      setError(urlError);
      return;
    }
    setProbing(true);
    setError(null);
    setInfo(null);
    try {
      const client = new GatewayClient(url.trim());
      const status = await client.probeStatus();
      setInfo(status);
      const refusal = refusalForStatus(status);
      if (refusal) {
        setError(refusal);
        return;
      }
      if (!supportsSecureSignin(status)) {
        setError(NO_SECURE_SIGNIN_MESSAGE);
        return;
      }
      setNotice('Secure device sign-in is available for this gateway.');
    } catch {
      setError('Could not reach that gateway. Likely causes: off-tailnet (100.x unreachable), host bound to loopback only, host firewall, or a wrong URL.');
    } finally {
      setProbing(false);
    }
  };

  const pair = async () => {
    if (!info || !url.trim() || !name.trim()) return;
    const host: SavedHost = { id: `host_${Date.now().toString(36)}`, name: name.trim(), url: url.trim() };
    await saveHost(host);
    // Device credential placeholder: the real native-PKCE exchange runs
    // against the host's advertised flow at sign-in time; the token is
    // stored in SecureStore only, never in AsyncStorage or logs.
    await storeDeviceCredential(host.id, '');
    const client = new GatewayClient(host.url, {
      onEvent: forwardChatEvent,
      getAuthToken: () => readDeviceCredential(host.id),
    });
    setActiveHost(host, client);
    setConnectionStatus('checking');
    await setActiveHostId(host.id);
    try {
      await client.connect();
      markSynced();
      router.replace('/(tabs)/bots');
    } catch (e) {
      setConnectionStatus('offline', e instanceof Error ? e.message : 'Could not connect to Hermes.');
      setError(e instanceof Error ? e.message : 'Could not connect to Hermes.');
    }
    setHosts(await listHosts());
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Connection</Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          Tailscale checklist: this phone and your Hermes host must be on the same tailnet. Never open port 9119 to the public internet. Never use 127.0.0.1 or localhost here — that address points back at this phone.
        </Text>
        <GlassInput label="Host name" value={name} onChangeText={setName} placeholder="Home PC" />
        <GlassInput label="Gateway URL" value={url} onChangeText={setUrl} placeholder="https://host.tailnet.ts.net:9119" autoCapitalize="none" autoCorrect={false} />
        {probing ? <GlassSpinner label="Probing gateway" /> : <GlassButton title="Probe gateway" variant="primary" onPress={() => void probe()} />}
        {info ? (
          <Text style={[styles.body, { color: palette.secondary }]}>
            Gateway version: {info.version ?? 'unknown'} · Auth required: {info.auth_required ? 'yes' : 'no'} · Flows: {(info.auth_flows ?? []).join(', ') || 'none advertised'}
          </Text>
        ) : null}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        {notice ? <GlassAlert tone="success" message={notice} /> : null}
        {info && !error ? <GlassButton title="Pair this host" variant="prominent" disabled={!name.trim()} onPress={() => void pair()} /> : null}
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
