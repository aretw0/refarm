/**
 * @refarm/identity-nostr
 *
 * Nostr identity primitive — key management and decentralised plugin discovery.
 *
 * Usable independently of the Refarm platform.
 *
 * Standards implemented:
 *   - NIP-01  (basic protocol / event structure)
 *   - NIP-07  (browser extension signer interface)
 *   - NIP-89  (recommended application handlers / plugin registry)
 *   - NIP-94  (file metadata — used for WASM plugin distribution)
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

/** A Nostr public key encoded as a hex string. */
export type PublicKeyHex = string;

/** A Nostr secret key encoded as a hex string. */
export type SecretKeyHex = string;

/** A Nostr keypair. */
export interface NostrKeypair {
  publicKey: PublicKeyHex;
  secretKey: SecretKeyHex;
}

/** Minimal Nostr event (NIP-01). */
export interface NostrEvent {
  id: string;
  pubkey: PublicKeyHex;
  created_at: number; // Unix timestamp
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ─── NIP-89 Plugin Handler ────────────────────────────────────────────────────

/**
 * Represents a plugin (application handler) discovered via NIP-89 kind:31990.
 */
export interface PluginHandler {
  /** Nostr event id of the handler announcement. */
  eventId: string;
  /** Author's public key. */
  pubkey: PublicKeyHex;
  /** Human-readable plugin name. */
  name: string;
  /** Short description of the plugin's capability. */
  about: string;
  /**
   * URL to the WASM component binary (distributed as a NIP-94 file event).
   * The kernel fetches this URL and instantiates the WASM component client-side.
   */
  wasmUrl: string;
  /** SHA-256 hash of the WASM binary for integrity verification. */
  wasmHash: string;
  /** Semantic version string. */
  version: string;
  /** Supported data-kind URNs (e.g. "refarm:data:contact"). */
  supportedKinds: string[];
}

// ─── Identity Manager ─────────────────────────────────────────────────────────

/**
 * Manages the user's Nostr identity and orchestrates plugin discovery.
 *
 * In a browser context this delegates signing to NIP-07 (window.nostr) when
 * available, falling back to an in-memory keypair (never persisted in
 * plaintext — wrap with the storage-sqlite primitive's encrypted store).
 */
export class NostrIdentityManager {
  private _keypair: NostrKeypair | null = null;

  /** Load an existing keypair (e.g. decrypted from local storage). */
  loadKeypair(keypair: NostrKeypair): void {
    this._keypair = keypair;
  }

  /**
   * Generate a new random keypair.
   *
   * NOTE: Real implementation should use @noble/secp256k1 or nostr-tools.
   * The stub below returns placeholder values until the crypto dependency is
   * wired up.
   */
  generateKeypair(): NostrKeypair {
    // TODO: replace with real secp256k1 key generation
    //   import { generatePrivateKey, getPublicKey } from 'nostr-tools';
    //   const sk = generatePrivateKey();
    //   return { secretKey: sk, publicKey: getPublicKey(sk) };
    const placeholder = "0".repeat(64);
    this._keypair = { secretKey: placeholder, publicKey: placeholder };
    return this._keypair;
  }

  /** Return the currently loaded public key, or null. */
  get publicKey(): PublicKeyHex | null {
    return this._keypair?.publicKey ?? null;
  }

  // ─── NIP-89 Plugin Discovery ───────────────────────────────────────────────

  /**
   * Fetch plugin handlers from a list of Nostr relays.
   *
   * Kind 31990 events are queried; each event's tags are parsed to extract
   * the WASM URL and integrity hash (distributed as a kind:1063 / NIP-94 ref).
   *
   * @param relays  WebSocket relay URLs to query.
   * @param filter  Optional supported-kind filter.
   */
  async discoverPlugins(
    relays: string[],
    filter?: { supportedKind: string }
  ): Promise<PluginHandler[]> {
    // TODO: implement real relay subscription using nostr-tools SimplePool:
    //
    //   const pool = new SimplePool();
    //   const events = await pool.list(relays, [{ kinds: [31990], '#k': filter ? [filter.supportedKind] : undefined }]);
    //   return events.map(parseHandlerEvent);
    //
    console.info("[identity-nostr] discoverPlugins called", { relays, filter });
    return [];
  }

  /**
   * Publish a NIP-89 handler announcement so others can discover a plugin
   * authored by this identity.
   */
  async publishPluginHandler(
    _handler: Omit<PluginHandler, "eventId" | "pubkey">,
    _relays: string[]
  ): Promise<string> {
    // TODO: build and sign kind:31990 event, then broadcast to relays
    throw new Error("publishPluginHandler: not yet implemented");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verify the SHA-256 hash of a fetched WASM buffer before instantiation.
 * This is a critical security step — never skip it.
 */
export async function verifyWasmIntegrity(
  buffer: ArrayBuffer,
  expectedHex: string
): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const actual = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return actual === expectedHex.toLowerCase();
}

export default NostrIdentityManager;
