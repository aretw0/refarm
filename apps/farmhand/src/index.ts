/**
 * Farmhand — Headless Refarm daemon
 *
 * Boots a Tractor instance and exposes a WebSocket sync transport on port 42000.
 * Studio (browser) connects to ws://localhost:42000 for CRDT sync.
 */

import { Tractor } from "@refarm.dev/tractor";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { WebSocketSyncTransport } from "./transport.js";

const FARMHAND_PORT = 42000;
const FARMHAND_PLUGIN_ID = "farmhand";

/**
 * Minimal in-memory StorageAdapter for the Farmhand MVP.
 * Future: replace with @refarm.dev/storage-sqlite once Node.js SQLite adapter is ready.
 */
function createMemoryStorage(): StorageAdapter {
  const store: Map<string, unknown> = new Map();
  return {
    async ensureSchema() {},
    async storeNode(id, type, context, payload, sourcePlugin) {
      store.set(id, { id, type, context, payload, sourcePlugin, updatedAt: new Date().toISOString() });
    },
    async queryNodes(type: string) {
      return Array.from(store.values()).filter((r) => (r as { type: string }).type === type);
    },
    async execute(_sql: string, _args?: unknown) { return []; },
    async query<T>(_sql: string, _args?: unknown): Promise<T[]> { return []; },
    async transaction<T>(fn: () => Promise<T>) { return fn(); },
    async close() {},
  };
}

/**
 * Minimal no-op IdentityAdapter for the Farmhand MVP.
 * Allows Tractor to boot without a real identity backend.
 */
function createEphemeralIdentity(): IdentityAdapter {
  return {
    publicKey: undefined,
  };
}

async function main() {
  console.log("[farmhand] Booting...");

  // 1. Boot Tractor with in-memory storage and ephemeral identity
  const tractor = await Tractor.boot({
    namespace: "farmhand",
    storage: createMemoryStorage(),
    identity: createEphemeralIdentity(),
    logLevel: "info",
    // Use guest mode so Tractor generates an ephemeral keypair for signing
    forceGuestMode: true,
  });

  console.log("[farmhand] Tractor booted.");

  // 2. Write FarmhandPresence node
  await tractor.storeNode({
    "@context": "https://schema.refarm.dev/",
    "@type": "FarmhandPresence",
    "@id": `urn:farmhand:presence:${Date.now()}`,
    "refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
    status: "online",
    startedAt: new Date().toISOString(),
  });

  console.log("[farmhand] Presence node written.");

  // 3. Start WebSocket sync transport
  const transport = new WebSocketSyncTransport(FARMHAND_PORT);
  console.log(`[farmhand] WebSocket server listening on ws://localhost:${FARMHAND_PORT}`);

  // 4. Handle graceful shutdown
  async function shutdown() {
    console.log("[farmhand] Shutting down...");
    await transport.disconnect();
    await tractor.shutdown();
    process.exit(0);
  }

  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });

  console.log("[farmhand] Ready.");
}

main().catch((err) => {
  console.error("[farmhand] Fatal error:", err);
  process.exit(1);
});
