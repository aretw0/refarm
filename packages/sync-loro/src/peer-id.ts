/**
 * Derive a stable uint64 peer ID from an arbitrary string (hostname, UUID, etc.)
 *
 * Loro requires peer IDs to be uint64-compatible. This function produces a
 * deterministic 64-bit BigInt from a string using a simple hash — sufficient
 * for distributed uniqueness in a personal-scale sovereign graph.
 *
 * For production use, prefer generating a random BigInt once and persisting it
 * alongside the Loro snapshot in the farmhand database.
 */
export function peerIdFromString(input: string): bigint {
  let h1 = 0xdeadbeefn;
  let h2 = 0x41c6ce57n;

  for (let i = 0; i < input.length; i++) {
    const ch = BigInt(input.charCodeAt(i));
    h1 = BigInt.asUintN(32, (h1 ^ ch) * 0x9e3779b9n);
    h2 = BigInt.asUintN(32, (h2 ^ ch) * 0x9e3779b9n);
  }

  // Combine two 32-bit halves into a 64-bit BigInt
  return BigInt.asUintN(64, (h1 << 32n) | h2);
}

/**
 * Generate a random uint64 peer ID.
 * Use this when no stable identifier is available (e.g. ephemeral browser session).
 */
export function randomPeerId(): bigint {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return BigInt.asUintN(64, result);
}
