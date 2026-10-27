import { describe, expect, it, vi } from 'vitest';

// auth.ts pulls AsyncStorage + SecureStore; neither runs in node tests,
// so both are mocked before import. Only the pure rules are under test.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  LOOPBACK_MESSAGE,
  REMOTE_UNAUTHENTICATED_MESSAGE,
  isLoopbackGatewayUrl,
  refusalForStatus,
  supportsSecureSignin,
  validateGatewayUrl,
} from '../src/lib/auth';

describe('loopback rejection', () => {
  it.each(['http://127.0.0.1:9119', 'http://localhost:9119', 'https://localhost/', 'http://127.0.0.1'])(
    'rejects %s',
    (url) => {
      expect(isLoopbackGatewayUrl(url)).toBe(true);
      expect(validateGatewayUrl(url)).toBe(LOOPBACK_MESSAGE);
    },
  );
  it('accepts a Tailscale hostname and an HTTPS tunnel URL', () => {
    expect(validateGatewayUrl('https://host.tailnet.ts.net:9119')).toBeNull();
    expect(validateGatewayUrl('http://100.64.0.5:9119')).toBeNull();
  });
  it('rejects empty and non-URL input with plain language', () => {
    expect(validateGatewayUrl('')).toMatch(/Enter a gateway address/);
    expect(validateGatewayUrl('not a url')).toMatch(/does not look like a URL/);
  });
});

describe('unauthenticated-remote refusal', () => {
  it('refuses with the spec exact message when auth_required !== true', () => {
    expect(refusalForStatus({ auth_required: false })).toBe(REMOTE_UNAUTHENTICATED_MESSAGE);
    expect(refusalForStatus({})).toBe(REMOTE_UNAUTHENTICATED_MESSAGE);
    expect(refusalForStatus({ auth_required: undefined })).toBe(REMOTE_UNAUTHENTICATED_MESSAGE);
  });
  it('allows pairing when the remote gateway requires auth', () => {
    expect(refusalForStatus({ auth_required: true })).toBeNull();
  });
  it('native_pkce is the preferred phone sign-in flow', () => {
    expect(supportsSecureSignin({ auth_required: true, auth_flows: ['native_pkce'] })).toBe(true);
    expect(supportsSecureSignin({ auth_required: true, auth_flows: ['password'] })).toBe(false);
    expect(supportsSecureSignin({ auth_required: true })).toBe(false);
  });
});
