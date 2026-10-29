import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/theme/theme-context';
import { useConnection } from '../../../src/lib/connection-store';
import { GlassButton } from '../../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../../src/components/glassyui/GlassAlert';
import type { DisplayPaneState, DisplayStatus } from '../../../src/lib/types';
import { fontSize, spacing } from '../../../src/theme/tokens';

function paneState(status: DisplayStatus): DisplayPaneState {
  if (!status.supported) return { kind: 'unsupported' };
  if (!status.installed) return { kind: 'needs-install', command: status.install_command ?? 'Install the display helper on the host.' };
  if (status.blocker) return { kind: 'blocked', reason: status.blocker };
  if (!status.running) return { kind: 'stopped' };
  return { kind: 'running', heldByHuman: status.lease.holder === 'human', controllable: status.lease.holder === 'agent', watching: true };
}

// v1 viewer (honest limitation): thumbnail stream + read-only fallback.
// No native VNC component was verified at build time, so NO control
// affordance is shown that the transport cannot honour: "Take control"
// appears only when a lease is actually acquirable AND a control path
// exists — in v1 it is labelled as unavailable until verified.
export default function ComputerScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [status, setStatus] = useState<DisplayStatus | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerId] = useState(() => `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

  const load = async () => {
    if (!gateway) return;
    try {
      const s = (await gateway.request('display.status', { profile })) as DisplayStatus;
      setStatus(s);
      if (s.running) {
        const t = (await gateway.request('display.thumbnail', { profile })) as { data_url?: string; suppressed?: boolean };
        if (t.data_url) setThumbnail(t.data_url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load display status.');
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, profile]);

  const pane = status ? paneState(status) : null;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Text style={[styles.title, { color: palette.text }]}>Computer · {profile}</Text>
      {error ? <GlassAlert tone="error" message={error} /> : null}
      {!gateway ? (
        <GlassAlert tone="warning" message="Connect a host first to view this display." />
      ) : !status ? (
        <Text style={[styles.body, { color: palette.secondary }]}>Checking display status…</Text>
      ) : pane?.kind === 'unsupported' ? (
        <GlassAlert tone="warning" message="Display control is not supported on this host." />
      ) : pane?.kind === 'needs-install' ? (
        <GlassAlert tone="warning" message={`Display helper is not installed on the host. Install command: ${pane.command}`} />
      ) : pane?.kind === 'blocked' ? (
        <GlassAlert tone="warning" message={`Display is blocked: ${pane.reason}`} />
      ) : pane?.kind === 'stopped' ? (
        <View style={styles.actions}>
          <Text style={[styles.body, { color: palette.secondary }]}>Display is stopped.</Text>
          <GlassButton title="Start display" variant="prominent" onPress={() => void gateway?.request('display.start', { profile }).then(() => load())} />
        </View>
      ) : (
        <View style={styles.actions}>
          {pane?.kind === 'running' && pane.heldByHuman ? (
            <GlassAlert tone="info" message="A human is watching — the agent keeps working while you watch." />
          ) : null}
          {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.thumbnail} resizeMode="contain" /> : <Text style={[styles.body, { color: palette.secondary }]}>No thumbnail available.</Text>}
          <GlassAlert tone="info" message="v1 viewer: thumbnail stream with read-only fallback. Remote control is not available until a native VNC component is verified — no control button is shown that the transport cannot honour." />
          <GlassButton
            title="Release lease"
            variant="ghost"
            onPress={() => void gateway?.request('display.lease.release', { profile, viewer_id: viewerId }).then(() => load())}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  body: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  actions: { gap: spacing.md },
  thumbnail: { width: '100%', height: 240, borderRadius: 20 },
});
