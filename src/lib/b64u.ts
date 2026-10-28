// Base64url encode/decode for Uint8Array. No native dependency, so
// this works in Expo Go, dev builds, and node tests alike.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>(
  Array.from(ALPHABET).map((c, i) => [c, i] as [string, number]),
);

export function bytesToB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) {
      out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    }
    if (i + 2 < bytes.length) {
      out += ALPHABET[b2 & 0x3f];
    }
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

export function b64uToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of normalized) {
    if (ch === '=') {
      break;
    }
    const v = LOOKUP.get(ch);
    if (v === undefined) {
      throw new Error('Invalid base64url character.');
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
