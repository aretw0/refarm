/**
 * Farmhand — Headless Refarm daemon
 *
 * Boots a Tractor instance and exposes a WebSocket sync transport on port 42000.
 * Studio (browser) connects to ws://localhost:42000 for CRDT sync.
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
import { SyncEngine } from "@refarm.dev/sync-crdt";
import type { CRDTOperation } from "@refarm.dev/sync-crdt";
import { WebSocketSyncTransport } from "./transport.js";

const FARMHAND_PORT = 42000;
const FARMHAND_PLUGIN_ID = "farmhand";
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Stable identity for this Farmhand instance. Scoped to hostname. */
const FARMHAND_ID = `farmhand:${os.hostname()}`;

/** Path to persist the plugin registry across restarts. */
const REGISTRY_PATH = path.join(os.homedir(), ".refarm", "registry.json");

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
 * The result node should include:
 *   - "@type": "FarmhandTaskResult"
 *   - "task:resultFor": <task @id>
 *   - "task:status":    "completed" | "error"
 *   - "task:result":    <function return value>  OR  "task:error": <message>
 *
 * Consider: what should happen if the plugin is not yet loaded when the task arrives?
 *   A) Fail immediately (simple, predictable)
 *   B) Auto-load the plugin on demand (requires plugin:manifest to also be provided)
 *   C) Queue and retry once PluginRoute loads it (complex, but more robust)
 *
 * Implement your chosen strategy in the function body below.
 */
async function handleFarmhandTask(
  tractor: Tractor,
  node: Record<string, unknown>
): Promise<void> {
  const assignedTo = node["task:assignedTo"] as string | undefined;
  if (assignedTo && assignedTo !== FARMHAND_ID) return;

  const taskId     = node["@id"] as string;
  const pluginId   = node["task:pluginId"] as string;
  const fn         = node["task:function"] as string ?? "run";
  const args       = node["task:args"];

  // ── TODO: implement task execution ─────────────────────────────────────────
  // Scaffold: get the plugin instance and call it.
  // Replace this stub with your chosen strategy (A, B, or C above).

  const instance = tractor.plugins.get(pluginId);
  if (!instance) {
    console.warn(`[farmhand] FarmhandTask ${taskId}: plugin "${pluginId}" not loaded — dropping task`);
    // Write a failed result so Studio knows the task was received but not handled
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

  // ── END TODO ────────────────────────────────────────────────────────────────
}

async function main() {
  console.log(`[farmhand] Booting (id=${FARMHAND_ID})...`);

  const tractor = await Tractor.boot({
    namespace: "farmhand",
    storage: createMemoryStorage(),
    identity: createEphemeralIdentity(),
    logLevel: "info",
    forceGuestMode: true,
  });

  console.log("[farmhand] Tractor booted.");

  // Write initial presence node
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

  // Start WebSocket transport
  const transport = new WebSocketSyncTransport(FARMHAND_PORT);
  console.log(`[farmhand] WebSocket server listening on ws://localhost:${FARMHAND_PORT}`);

  // Wire SyncEngine to receive CRDT operations from connected Studio clients
  const engine = new SyncEngine(FARMHAND_ID);
  engine.addTransport(transport);

  engine.onOperation(async (op: CRDTOperation) => {
    const node = op.op as Record<string, unknown>;
    if (!node || typeof node["@type"] !== "string") return;

    const type = node["@type"];

    if (type === "PluginRoute") {
      await handlePluginRoute(tractor, node);
    } else if (type === "FarmhandTask") {
      await handleFarmhandTask(tractor, node);
    }
  });

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
