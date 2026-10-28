// QR pairing screen (analysis/gbots-pairing-design.md §3):
// scan the QR the host printed, or type the URL + code by hand.
// The fingerprint check runs before any credential is sent; a mismatch
// refuses hard. Manual entry without a fingerprint proceeds with an
// on-screen warning (tailnet traffic is already WireGuard-encrypted).
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../src/theme/theme-context';
import {
  readDeviceCredential,
  saveHost,
  setActiveHostId,
  storeDeviceCredential,
  storeDeviceSignKey,
  validateGatewayUrl,
  type SavedHost,
} from '../src/lib/auth';
import { GatewayClient } from '../src/lib/gateway';
import {
  fingerprintMatches,
  generateSigningKeypair,
  normalizePairCode,
  parsePairLink,
  sealPairPayload,
} from '../src/lib/pairing';
import { forwardChatEvent } from './chat/[sessionId]';
import { markSynced, setActiveHost, setConnectionStatus } from '../src/lib/connection-store';
import { GlassAlert } from '../src/components/glassyui/GlassAlert';
import { GlassButton } from '../src/components/glassyui/GlassButton';
import { GlassInput } from '../src/components/glassyui/GlassInput';
import { GlassSpinner } from '../src/components/glassyui/GlassSpinner';
import { fontSize, spacing } from '../src/theme/tokens';

type Mode = 'scan' | 'manual';

export default function ScanScreen() {
  const { palette } = useTheme();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'manual' ? 'manual' : 'scan');
  const [name, setName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualFp, setManualFp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  const hostNameFor = (url: string): string => {
    if (name.trim()) {
      return name.trim();
    }
    try {
      return new URL(url).hostname;
    } catch {
      return 'Hermes host';
    }
  };

  const pairFromParts = async (url: string, code: string, fp: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const urlError = validateGatewayUrl(url);
      if (urlError) {
        throw new Error(urlError);
      }
      const probeClient = new GatewayClient(url);
      let info;
      try {
        info = await probeClient.gbotsInfo();
      } catch {
        throw new Error(
          'Could not reach that gateway. Likely causes: off-tailnet (100.x unreachable), host bound to loopback only, host firewall, or a wrong URL.',
        );
      }
      if (info.app !== 'gbots') {
        throw new Error('That server is not a GBots gateway. Check the URL and try again.');
      }
      if (fp) {
        if (!fingerprintMatches(fp, info)) {
          throw new Error(
            "This code is for a different server key than the one this phone paired with. Don't continue on this network; pair again from the server.",
          );
        }
      } else {
        setNotice('No fingerprint to check — only continue on a network you trust (your tailnet).');
      }
      const keypair = generateSigningKeypair();
      const sealed = sealPairPayload(info.sealing, {
        code: normalizePairCode(code),
        name: hostNameFor(url),
        platform: 'android',
        sign_key: keypair.publicKeyB64u,
      });
      const { token } = await probeClient.pairRequest(sealed);
      const host: SavedHost = {
        id: `host_${Date.now().toString(36)}`,
        name: hostNameFor(url),
        url: url.trim(),
      };
      await saveHost(host);
      await storeDeviceCredential(host.id, token);
      await storeDeviceSignKey(host.id, keypair.secretKeyB64u);
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
        throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleScan = ({ data }: { data: string }) => {
    if (scannedRef.current || busy) {
      return;
    }
    scannedRef.current = true;
    const link = parsePairLink(data);
    if (!link) {
      setError('That QR code is not a GBots pairing code.');
      return;
    }
    void pairFromParts(link.url, link.code, link.fp);
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Pair a host</Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          On your host, run `hermes-gateway pair --public-url http://&lt;tailnet-ip&gt;:9120` and
          scan the QR it prints. The code works once and expires after 10 minutes.
        </Text>
        <View style={styles.modeRow}>
          <GlassButton
            title="Scan QR"
            variant={mode === 'scan' ? 'prominent' : 'primary'}
            onPress={() => setMode('scan')}
          />
          <GlassButton
            title="Enter manually"
            variant={mode === 'manual' ? 'prominent' : 'primary'}
            onPress={() => setMode('manual')}
          />
        </View>
        <GlassInput label="Host name" value={name} onChangeText={setName} placeholder="Home PC" />
        {mode === 'scan' ? (
          <View style={styles.section}>
            {permission === null ? (
              <GlassSpinner label="Checking camera permission" />
            ) : !permission.granted ? (
              <View style={styles.section}>
                <Text style={[styles.body, { color: palette.secondary }]}>
                  Camera permission is needed to scan the pairing QR.
                </Text>
                <GlassButton
                  title="Allow camera"
                  variant="primary"
                  onPress={() => void requestPermission()}
                />
              </View>
            ) : (
              <View style={styles.section}>
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scannedRef.current ? undefined : handleScan}
                />
                <Text style={[styles.body, { color: palette.secondary }]}>
                  Point the camera at the QR on your host&apos;s terminal.
                </Text>
              </View>
            )}
            {error ? (
              <GlassButton
                title="Scan again"
                variant="primary"
                onPress={() => {
                  scannedRef.current = false;
                  setError(null);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <GlassInput
              label="Gateway URL"
              value={manualUrl}
              onChangeText={setManualUrl}
              placeholder="http://100.x.y.z:9120"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <GlassInput
              label="Pair code"
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="ABCD-2345"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <GlassInput
              label="Fingerprint (optional)"
              value={manualFp}
              onChangeText={setManualFp}
              placeholder="64 hex characters from the terminal"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {busy ? (
              <GlassSpinner label="Pairing" />
            ) : (
              <GlassButton
                title="Pair this host"
                variant="prominent"
                disabled={!manualUrl.trim() || !manualCode.trim()}
                onPress={() =>
                  void pairFromParts(manualUrl.trim(), manualCode.trim(), manualFp.trim() || null)
                }
              />
            )}
          </View>
        )}
        {busy && mode === 'scan' ? <GlassSpinner label="Pairing" /> : null}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        {notice ? <GlassAlert tone="success" message={notice} /> : null}
        <GlassButton title="Back to Connection" variant="primary" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  body: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  modeRow: { flexDirection: 'row', gap: spacing.md },
  camera: { height: 320 },
});
