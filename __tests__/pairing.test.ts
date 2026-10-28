import { describe, expect, it, vi } from 'vitest';

// pairing.ts pulls auth.ts, which pulls AsyncStorage + SecureStore;
// neither runs in node tests, so both are mocked before import. Only
// the pure pairing rules and the sealed-box construction are under test.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  fingerprintMatches,
  normalizePairCode,
  parsePairLink,
  sealBoxWithEphemeral,
  unsealBoxWithRecipient,
} from '../src/lib/pairing';
import { b64uToBytes, bytesToB64u } from '../src/lib/b64u';
import type { GbotInfo } from '../src/lib/types';

// Libsodium-generated vector (same constants as the gateway's Rust
// test): recipient secret 0x11*32, ephemeral secret 0x22*32, plaintext
// "gbots-pair-vector", sealed with crypto_box_seal.
const VECTOR_RECIPIENT_SK_B64U = 'ERERERERERERERERERERERERERERERERERERERERERE';
const VECTOR_RECIPIENT_PK_B64U = 'e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM';
const VECTOR_SEALED_B64U =
  'D6poTtKIZ7l_Smot7l34zpdOdrcBjj8iocTPJnhXDyDEstseASUkiA_ZOsRNl680vbnRBGqw52w8m2VMZHE6vf8';
const VECTOR_PLAINTEXT = 'gbots-pair-vector';

const gbotInfo = (fingerprint: string): GbotInfo => ({
  app: 'gbots',
  version: '0.1.0',
  server_id: fingerprint.slice(0, 16),
  fingerprint,
  identity: 'identity',
  sealing: 'sealing',
});

describe('parsePairLink', () => {
  it('parses a full QR link', () => {
    const fp = 'a'.repeat(64);
    expect(parsePairLink(`http://100.1.2.3:9120/#pair=ABCD2345&fp=${fp}`)).toEqual({
      url: 'http://100.1.2.3:9120',
      code: 'ABCD2345',
      fp,
    });
  });

  it('normalizes a dashed code from the link', () => {
    const fp = 'b'.repeat(64);
    expect(parsePairLink(`http://100.1.2.3:9120/#pair=abcd-2345&fp=${fp}`)?.code).toBe('ABCD2345');
  });

  it('rejects loopback URLs, missing fingerprints, and non-pair QR data', () => {
    const fp = 'c'.repeat(64);
    expect(parsePairLink(`http://127.0.0.1:9120/#pair=ABCD2345&fp=${fp}`)).toBeNull();
    expect(parsePairLink('http://100.1.2.3:9120/#pair=ABCD2345')).toBeNull();
    expect(parsePairLink('http://100.1.2.3:9120/#pair=&fp=' + fp)).toBeNull();
    expect(parsePairLink('https://example.com/some-page')).toBeNull();
    expect(parsePairLink('')).toBeNull();
  });
});

describe('normalizePairCode', () => {
  it('strips separators and uppercases', () => {
    expect(normalizePairCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizePairCode(' ab cd 2345 ')).toBe('ABCD2345');
  });
});

describe('fingerprintMatches', () => {
  it('compares case-insensitively and refuses mismatches', () => {
    const fp = 'Ab'.repeat(32);
    expect(fingerprintMatches(fp.toLowerCase(), gbotInfo(fp))).toBe(true);
    expect(fingerprintMatches('00'.repeat(32), gbotInfo(fp))).toBe(false);
  });
});

describe('b64u', () => {
  it('round-trips and matches the standard vector', () => {
    const hello = new TextEncoder().encode('hello');
    expect(bytesToB64u(hello)).toBe('aGVsbG8');
    expect(Array.from(b64uToBytes('aGVsbG8'))).toEqual(Array.from(hello));
    expect(b64uToBytes(VECTOR_SEALED_B64U).length).toBe(65);
  });
});

describe('sealed box against the libsodium vector', () => {
  it('encrypts byte-for-byte like libsodium sealed box', () => {
    const message = new TextEncoder().encode(VECTOR_PLAINTEXT);
    const recipientPk = b64uToBytes(VECTOR_RECIPIENT_PK_B64U);
    const ephemeralSk = new Uint8Array(32).fill(0x22);
    const sealed = sealBoxWithEphemeral(message, recipientPk, ephemeralSk);
    expect(bytesToB64u(sealed)).toBe(VECTOR_SEALED_B64U);
  });

  it('opens the libsodium vector and rejects tampering', () => {
    const sealed = b64uToBytes(VECTOR_SEALED_B64U);
    const recipientSk = b64uToBytes(VECTOR_RECIPIENT_SK_B64U);
    const opened = unsealBoxWithRecipient(sealed, recipientSk);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(VECTOR_PLAINTEXT);
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(unsealBoxWithRecipient(tampered, recipientSk)).toBeNull();
    expect(unsealBoxWithRecipient(new Uint8Array(10), recipientSk)).toBeNull();
  });
});
