// QR pairing (analysis/gbots-pairing-design.md): parse the QR link,
// check the server fingerprint, seal the pair request, exchange the
// one-time code for a per-device credential.
//
// The sealed request is a libsodium sealed box (X25519 + XSalsa20-
// Poly1305, nonce = BLAKE2b-24 of ephemeral_pk || recipient_pk). The
// gateway side must open exactly what this side seals; the vector test
// in __tests__/pairing.test.ts pins both sides against one
// libsodium-generated vector.
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';
import { b64uToBytes, bytesToB64u } from './b64u';
import { validateGatewayUrl } from './auth';
import type { GbotInfo } from './types';

export type PairLink = {
  url: string;
  code: string;
  fp: string;
};

export function parsePairLink(raw: string): PairLink | null {
  const text = raw.trim();
  const marker = '/#pair=';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const url = text.slice(0, markerIndex);
  const rest = text.slice(markerIndex + marker.length);
  const [codePart, ...queryParts] = rest.split('&');
  const fpPart = queryParts.find((p) => p.startsWith('fp='));
  const code = (codePart ?? '').trim();
  const fp = fpPart ? fpPart.slice('fp='.length).trim() : '';
  if (!url || !code || !fp) {
    return null;
  }
  // Loopback and malformed URLs are refused here, same as manual entry.
  if (validateGatewayUrl(url) !== null) {
    return null;
  }
  return { url, code: normalizePairCode(code), fp };
}

/// Typed codes may carry dashes or spaces ("ABCD-2345"); the server
/// normalizes the same way, so stripping here is safe.
export function normalizePairCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/// The QR fingerprint (trusted: it came from the operator's own screen)
/// must equal the fingerprint the reached server reports. A mismatch
/// means the phone is talking to a different server than the QR came
/// from — refuse, never proceed.
export function fingerprintMatches(qrFp: string, info: GbotInfo): boolean {
  return qrFp.trim().toLowerCase() === info.fingerprint.trim().toLowerCase();
}

export type SigningKeypair = {
  publicKeyB64u: string;
  secretKeyB64u: string;
};

export function generateSigningKeypair(): SigningKeypair {
  const kp = nacl.sign.keyPair();
  return {
    publicKeyB64u: bytesToB64u(kp.publicKey),
    secretKeyB64u: bytesToB64u(kp.secretKey),
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/// Sealed box with an explicit ephemeral secret key, so tests can pin
/// the vector. Production callers use sealPairPayload, which generates
/// a fresh ephemeral keypair for every request.
export function sealBoxWithEphemeral(
  message: Uint8Array,
  recipientPk: Uint8Array,
  ephemeralSecretKey: Uint8Array,
): Uint8Array {
  const ephemeral = nacl.box.keyPair.fromSecretKey(ephemeralSecretKey);
  const nonce = blake2b(concat(ephemeral.publicKey, recipientPk), null, 24);
  const shared = nacl.box.before(recipientPk, ephemeral.secretKey);
  const box = nacl.secretbox(message, nonce, shared);
  return concat(ephemeral.publicKey, box);
}

/// Open a sealed box from the recipient's side. Used by tests to prove
/// this construction against the libsodium vector; the app itself only
/// seals (the gateway opens).
export function unsealBoxWithRecipient(
  sealed: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 48) {
    return null;
  }
  const ephemeralPk = sealed.slice(0, 32);
  const box = sealed.slice(32);
  const recipientPk = nacl.box.keyPair.fromSecretKey(recipientSecretKey).publicKey;
  const nonce = blake2b(concat(ephemeralPk, recipientPk), null, 24);
  const shared = nacl.box.before(ephemeralPk, recipientSecretKey);
  return nacl.secretbox.open(box, nonce, shared);
}

export type PairPayload = {
  code: string;
  name: string;
  platform: string;
  sign_key: string;
};

export function sealPairPayload(sealingPkB64u: string, payload: PairPayload): string {
  const recipientPk = b64uToBytes(sealingPkB64u);
  const ephemeral = nacl.box.keyPair();
  const message = new TextEncoder().encode(JSON.stringify(payload));
  const sealed = sealBoxWithEphemeral(message, recipientPk, ephemeral.secretKey);
  return bytesToB64u(sealed);
}
