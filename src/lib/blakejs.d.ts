// blakejs ships no TypeScript types. Only the function pairing.ts
// needs is declared here.
declare module 'blakejs' {
  export function blake2b(
    input: Uint8Array,
    key?: Uint8Array | null,
    outlen?: number,
  ): Uint8Array;
}
