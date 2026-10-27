// Connection + pairing rules (port-spec §6/§7) and credential handling.
// Device credentials live ONLY in SecureStore, never AsyncStorage, never
// logs, never query strings (except the two deliberate single-use tickets
// minted per connection by the gateway client).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteCredential, getCredential, saveCredential } from './secure-storage';
import type { GatewayInfo } from './types';

export interface SavedHost {
  id: string;
  name: string;
  url: string;
}

export const REMOTE_UNAUTHENTICATED_MESSAGE =
  'This remote gateway is reachable but does not require authentication. Secure remote pairing requires an authenticated Hermes gateway.';

export const LOOPBACK_MESSAGE =
  'That address points back at this phone, not at your Hermes host. Enter your host’s Tailscale hostname or HTTPS address instead.';

export const NO_SECURE_SIGNIN_MESSAGE =
  'This Hermes gateway does not advertise secure native phone sign-in.';

/** 127.0.0.1 / localhost / ::1 are never a valid phone gateway URL. */
export function isLoopbackGatewayUrl(raw: string): boolean {
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    const trimmed = raw.trim().toLowerCase();
    host = trimmed.split(':')[0].split('/')[0];
  }
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function validateGatewayUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return 'Enter a gateway address.';
  if (isLoopbackGatewayUrl(url)) return LOOPBACK_MESSAGE;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Gateway address must start with http:// or https://.';
    }
  } catch {
    return 'That gateway address does not look like a URL.';
  }
  return null;
}

/**
 * Refusal rule: a remote gateway with auth_required !== true is refused.
 * Returns the exact refusal message, or null when pairing may proceed.
 */
export function refusalForStatus(info: GatewayInfo): string | null {
  if (info.auth_required !== true) return REMOTE_UNAUTHENTICATED_MESSAGE;
  return null;
}

export function supportsSecureSignin(info: GatewayInfo): boolean {
  return (info.auth_flows ?? []).includes('native_pkce');
}

const HOSTS_KEY = 'hermes.saved-hosts.v1';
const ACTIVE_HOST_KEY = 'hermes.active-host.v1';

function credentialKey(hostId: string): string {
  return `hermes.device-credential.${hostId}`;
}

export async function listHosts(): Promise<SavedHost[]> {
  const raw = await AsyncStorage.getItem(HOSTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SavedHost[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHost(host: SavedHost): Promise<void> {
  const hosts = await listHosts();
  const next = [...hosts.filter((h) => h.id !== host.id), host];
  await AsyncStorage.setItem(HOSTS_KEY, JSON.stringify(next));
}

export async function removeHost(hostId: string): Promise<void> {
  const hosts = await listHosts();
  await AsyncStorage.setItem(HOSTS_KEY, JSON.stringify(hosts.filter((h) => h.id !== hostId)));
  await deleteCredential(credentialKey(hostId));
}

export async function getActiveHostId(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_HOST_KEY);
}

export async function setActiveHostId(hostId: string | null): Promise<void> {
  if (hostId) await AsyncStorage.setItem(ACTIVE_HOST_KEY, hostId);
  else await AsyncStorage.removeItem(ACTIVE_HOST_KEY);
}

export async function storeDeviceCredential(hostId: string, token: string): Promise<void> {
  await saveCredential(credentialKey(hostId), token);
}

export async function readDeviceCredential(hostId: string): Promise<string | null> {
  return getCredential(credentialKey(hostId));
}

/**
 * Disconnect: delete the stored credential, close the socket (via the
 * callback the connection store passes in), and clear pending journal
 * intents for that host. Returns to the pairing screen by clearing the
 * active host. The caller supplies the journal clear + socket close so
 * this module never owns the socket.
 */
export async function disconnectHost(hostId: string, closeSocket: () => void, clearJournal: (host: string) => Promise<void>): Promise<void> {
  closeSocket();
  await deleteCredential(credentialKey(hostId));
  await clearJournal(hostId);
  const active = await getActiveHostId();
  if (active === hostId) await setActiveHostId(null);
}
