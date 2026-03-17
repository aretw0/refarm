/**
 * Farmhand — Headless Refarm daemon
 *
 * Boots a Tractor instance backed by LoroCRDTStorage (ADR-045) and exposes a
 * WebSocket sync transport on port 42000. Studio (browser) connects to
 * ws://localhost:42000 for binary Loro CRDT sync.
 *
 * Reactive behaviors:
 *  - PluginRoute nodes  → load the referenced plugin into this Tractor instance
 *  - FarmhandTask nodes → execute the plugin function, write result back to graph
 */

import os from "node:os";
import path from "node:path";
import { Tractor } from "@refarm.dev/tractor";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { LoroCRDTStorage, peerIdFromString } from "@refarm.dev/sync-loro";
import { WebSocketSyncTransport } from "./transport.js";

const FARMHAND_PORT = 42000;
const FARMHAND_PLUGIN_ID = "farmhand";
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Stable identity for this Farmhand instance. Scoped to hostname. */
const FARMHAND_ID = `farmhand:${os.hostname()}`;

/** Path to persist the plugin registry across restarts. */
const REGISTRY_PATH = path.join(os.homedir(), ".refarm", "registry.json");

/**
 * Minimal in-memory StorageAdapter — serves as the CQRS read model.
 * Future: replace with @refarm.dev/storage-sqlite (Farmhand Phase 2).
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
 */
function createEphemeralIdentity(): IdentityAdapter {
  return { publicKey: undefined };
}

/**
 * Handle an incoming PluginRoute node.
 *
 * A PluginRoute signals "load plugin X on Farmhand Y". The daemon registers
 * the manifest as trusted (skipping cryptographic validation — the manifest
 * arrived over the synced CRDT graph which the daemon already trusts), then
 * loads the plugin into the Tractor instance.
 */
async function handlePluginRoute(tractor: Tractor, node: Record<string, unknown>): Promise<void> {
  const assignedTo = node["plugin:assignedTo"] as string | undefined;
  if (assignedTo && assignedTo !== FARMHAND_ID) return; // not for this daemon

  const manifest = node["plugin:manifest"] as any;
  if (!manifest?.id) {
    console.warn("[farmhand] PluginRoute missing plugin:manifest — skipping");
    return;
  }

  console.log(`[farmhand] PluginRoute: loading plugin "${manifest.id}"`);
  try {
    await tractor.registry.register(manifest);
    await tractor.registry.trust(manifest.id);
    await tractor.plugins.load(manifest);
    console.log(`[farmhand] Plugin "${manifest.id}" loaded successfully`);
  } catch (e: any) {
    console.error(`[farmhand] Failed to load plugin "${manifest.id}":`, e.message);
  }
}

/**
 * Handle an incoming FarmhandTask node.
 *
 * TODO: Implement the task execution and result-writing logic below.
 *
 * A FarmhandTask has:
 *   - "task:assignedTo": string  — farmhand ID to run on (e.g. "farmhand:hostname")
 *   - "task:pluginId":  string  — which plugin to invoke
 *   - "task:function":  string  — the export function to call
 *   - "task:args":      unknown — arguments passed to the function
 *   - "@id":            string  — unique task ID
 *
 * After execution you should write a FarmhandTaskResult node via tractor.storeNode().
 */
async function handleFarmhandTask(
  tractor: Tractor,
  node: Record<string, unknown>
): Promise<void> {
  const assignedTo = node["task:assignedTo"] as string | undefined;
  if (assignedTo && assignedTo !== FARMHAND_ID) return;

  const taskId   = node["@id"] as string;
  const pluginId = node["task:pluginId"] as string;

  const instance = tractor.plugins.get(pluginId);
  if (!instance) {
    console.warn(`[farmhand] FarmhandTask ${taskId}: plugin "${pluginId}" not loaded — dropping task`);
    await tractor.storeNode({
      "@context": "https://schema.refarm.dev/",
      "@type": "FarmhandTaskResult",
      "@id": `urn:farmhand:task:result:${taskId}`,
      "refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
      "task:resultFor": taskId,
      "task:status": "error",
      "task:error": `Plugin "${pluginId}" is not loaded on this Farmhand`,
    });
    return;
  }
}

async function main() {
  console.log(`[farmhand] Booting (id=${FARMHAND_ID})...`);

  // CQRS: LoroDoc is the write model; memoryStorage is the read model.
  // LoroCRDTStorage implements both StorageAdapter and SyncAdapter.
  const readModel = createMemoryStorage();
  const storage = new LoroCRDTStorage(readModel, peerIdFromString(FARMHAND_ID));
  await storage.ensureSchema();

  const tractor = await Tractor.boot({
    namespace: "farmhand",
    storage,
    sync: storage,
    identity: createEphemeralIdentity(),
    logLevel: "info",
    forceGuestMode: true,
  });

  console.log("[farmhand] Tractor booted with Loro CRDT storage.");

  // Write initial presence node (goes into LoroDoc, projected to read model)
  await tractor.storeNode({
    "@context": "https://schema.refarm.dev/",
    "@type": "FarmhandPresence",
    "@id": `urn:farmhand:presence:${FARMHAND_ID}`,
    "refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
    farmhandId: FARMHAND_ID,
    status: "online",
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
  });

  console.log("[farmhand] Presence node written.");

  // Start WebSocket transport (binary Uint8Array frames — Loro deltas)
  const transport = new WebSocketSyncTransport(FARMHAND_PORT);
  console.log(`[farmhand] WebSocket server listening on ws://localhost:${FARMHAND_PORT}`);

  // Wire transport ↔ LoroCRDTStorage (binary Loro sync)
  transport.onMessage((bytes) => void storage.applyUpdate(bytes));
  storage.onUpdate((bytes) => transport.broadcast(bytes));

  // Subscribe to CRDT node changes via the high-level reactive API
  tractor.onNode("PluginRoute", (node) => handlePluginRoute(tractor, node));
  tractor.onNode("FarmhandTask", (node) => handleFarmhandTask(tractor, node));

  // Periodic heartbeat: refresh FarmhandPresence every 30 seconds
  const heartbeatTimer = setInterval(async () => {
    try {
      await tractor.storeNode({
        "@context": "https://schema.refarm.dev/",
        "@type": "FarmhandPresence",
        "@id": `urn:farmhand:presence:${FARMHAND_ID}`,
        "refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
        farmhandId: FARMHAND_ID,
        status: "online",
        lastHeartbeatAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[farmhand] Heartbeat write failed:", e);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown
  async function shutdown() {
    console.log("[farmhand] Shutting down...");
    clearInterval(heartbeatTimer);
    await transport.disconnect();
    await tractor.shutdown?.();
    process.exit(0);
  }

  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT",  () => { void shutdown(); });

  console.log("[farmhand] Ready.");
}

main().catch((err) => {
  console.error("[farmhand] Fatal error:", err);
  process.exit(1);
});
