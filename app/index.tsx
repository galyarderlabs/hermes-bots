import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { GatewayClient } from '../src/lib/gateway';
import {
  getActiveHostId,
  listHosts,
  readDeviceCredential,
  setActiveHostId,
} from '../src/lib/auth';
import { setActiveHost } from '../src/lib/connection-store';
import { forwardChatEvent } from './chat/[sessionId]';

// Launch gate: the app must open on the onboarding splash, not on the
// tabs. Previously this file redirected straight to /(tabs)/bots, so the
// splash + welcome screens existed in the bundle but were unreachable on
// launch (only via deep link) — and nothing ever restored the saved host,
// so every cold start showed "Connect Hermes first" even after pairing.
//
// Now: restore the saved active host (same client construction as the
// connection screen's "Use" path) and go to tabs; otherwise go to splash.
// While the local storage read runs, render nothing so no wrong screen
// flashes first.
type LaunchTarget = '/(tabs)/bots' | '/onboarding/splash';

export default function Index() {
  const [target, setTarget] = useState<LaunchTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const activeId = await getActiveHostId();
        const hosts = await listHosts();
        const host = activeId ? hosts.find((h) => h.id === activeId) : undefined;
        if (host) {
          const client = new GatewayClient(host.url, {
            onEvent: forwardChatEvent,
            getAuthToken: () => readDeviceCredential(host.id),
          });
          if (!cancelled) {
            setActiveHost(host, client);
            setTarget('/(tabs)/bots');
          }
          return;
        }
        if (activeId) {
          // Stale active id pointing at a deleted host: clear it so the
          // next launch does not repeat the lookup miss.
          await setActiveHostId(null);
        }
      } catch {
        // Storage read failure: fall through to onboarding rather than
        // stranding the user on a blank launch screen.
      }
      if (!cancelled) setTarget('/onboarding/splash');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return null;
  return <Redirect href={target} />;
}
