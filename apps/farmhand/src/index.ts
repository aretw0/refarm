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
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import { SseStreamTransport } from "@refarm.dev/sse-stream-transport";
import { createTaskV1StorageAdapter } from "@refarm.dev/storage-sqlite";
import { createNodeSqliteStorageProvider } from "@refarm.dev/storage-sqlite/node";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { LoroCRDTStorage, peerIdFromString } from "@refarm.dev/sync-loro";
import { Tractor } from "@refarm.dev/tractor";
import { WsStreamTransport } from "@refarm.dev/ws-stream-transport";
import { loadInstalledPlugins } from "./installed-plugins.js";
import { toStreamChunk } from "./stream-chunk-mapper.js";
import { StreamRegistry } from "./stream-registry.js";
import { executeTask } from "./task-executor.js";
import { createTaskMemoryBridge } from "./task-memory-bridge.js";
import { WebSocketSyncTransport } from "./transport.js";
import {
	FileTransportAdapter,
	type TaskExecutorFn,
} from "./transports/file.js";
import { HttpSidecar } from "./transports/http.js";
import { createSessionsRouteHandler } from "./transports/sessions.js";

const FARMHAND_PORT = 42000;
const FARMHAND_PLUGIN_ID = "farmhand";
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Stable identity for this Farmhand instance. Scoped to hostname. */
const FARMHAND_ID = `farmhand:${os.hostname()}`;

/**
 * Minimal in-memory StorageAdapter — serves as the CQRS read model.
 * Future: replace with @refarm.dev/storage-sqlite (Farmhand Phase 2).
 */
function createMemoryStorage(): StorageAdapter {
	const store: Map<string, unknown> = new Map();
	return {
		async ensureSchema() {},
		async storeNode(id, type, context, payload, sourcePlugin) {
			store.set(id, {
				id,
				type,
				context,
				payload,
				sourcePlugin,
				updatedAt: new Date().toISOString(),
			});
		},
		async queryNodes(type: string) {
			return Array.from(store.values()).filter(
				(r) => (r as { type: string }).type === type,
			);
		},
		async execute(_sql: string, _args?: unknown) {
			return [];
		},
		async query<T>(_sql: string, _args?: unknown): Promise<T[]> {
			return [];
		},
		async transaction<T>(fn: () => Promise<T>) {
			return fn();
		},
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
async function handlePluginRoute(
	tractor: Tractor,
	node: Record<string, unknown>,
): Promise<void> {
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
		console.error(
			`[farmhand] Failed to load plugin "${manifest.id}":`,
			e.message,
		);
	}
}

/**
 * Handle an incoming FarmhandTask node.
 *
 * Executes the assigned task and writes a FarmhandTaskResult node.
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
	node: Record<string, unknown>,
): Promise<void> {
	const assignedTo = node["task:assignedTo"] as string | undefined;
	if (assignedTo && assignedTo !== FARMHAND_ID) return;

	await executeTask(tractor, {
		taskId: node["@id"] as string,
		effortId:
			(node["task:effortId"] as string | undefined) ?? (node["@id"] as string),
		pluginId: node["task:pluginId"] as string,
		fn: node["task:function"] as string,
		args: node["task:args"],
	});
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

	const farmhandBaseDir = path.join(os.homedir(), ".refarm");
	const loadSummary = await loadInstalledPlugins(
		tractor as any,
		farmhandBaseDir,
	);
	if (loadSummary.loaded > 0 || loadSummary.skipped > 0) {
		console.log(
			`[farmhand] Installed plugin scan complete: loaded=${loadSummary.loaded} skipped=${loadSummary.skipped}`,
		);
	}

	const taskDbPath = path.join(farmhandBaseDir, "task-memory.db");
	const taskMemoryBridge = createTaskMemoryBridge({
		adapter: createTaskV1StorageAdapter({
			provider: createNodeSqliteStorageProvider(taskDbPath),
		}),
		actorUrn: `urn:refarm:farmhand:${FARMHAND_ID}`,
	});
	console.log(`[farmhand] Task memory persisted to ${taskDbPath}`);

	const taskExecutorFn: TaskExecutorFn = async (task, effortId) => {
		let status: "ok" | "error" = "ok";
		let result: unknown;
		let error: string | undefined;

		try {
			await taskMemoryBridge.ensureTask(task, effortId);
		} catch (memoryError) {
			console.warn(
				"[farmhand] task memory ensure failed:",
				memoryError instanceof Error
					? memoryError.message
					: String(memoryError),
			);
		}

		const captureTractor = {
			plugins: tractor.plugins,
			storeNode: async (node: Record<string, unknown>) => {
				status = node["task:status"] as "ok" | "error";
				const rawResult = node["task:result"];
				if (typeof rawResult === "string") {
					try {
						result = JSON.parse(rawResult);
					} catch {
						result = rawResult;
					}
				} else {
					result = rawResult;
				}
				error = node["task:error"] as string | undefined;
			},
		};

		await executeTask(captureTractor as any, {
			taskId: task.id,
			effortId,
			pluginId: task.pluginId,
			fn: task.fn,
			args: task.args,
		});

		try {
			await taskMemoryBridge.recordOutcome(task, effortId, { status, error });
		} catch (memoryError) {
			console.warn(
				"[farmhand] task memory outcome failed:",
				memoryError instanceof Error
					? memoryError.message
					: String(memoryError),
			);
		}

		return { status, result, error };
	};

	const fileTransport = new FileTransportAdapter(
		farmhandBaseDir,
		taskExecutorFn,
	);
	const stopFileWatcher = fileTransport.watch();
	console.log(`[farmhand] File transport watching ${farmhandBaseDir}/tasks/`);

	const httpSidecar = new HttpSidecar(42001, fileTransport);
	httpSidecar.addRouteHandler(createSessionsRouteHandler(tractor));
	await httpSidecar.start();
	console.log("[farmhand] HTTP sidecar listening on http://127.0.0.1:42001");

	const streamsDir = path.join(farmhandBaseDir, "streams");
	const fileStreamTransport = new FileStreamTransport(streamsDir);
	const sseStreamTransport = new SseStreamTransport(fileStreamTransport);
	const wsStreamTransport = new WsStreamTransport(
		httpSidecar.httpServer,
		fileStreamTransport,
	);
	httpSidecar.addRouteHandler(sseStreamTransport.getRouteHandler());

	const streamRegistry = new StreamRegistry();
	streamRegistry.register(fileStreamTransport);
	streamRegistry.register(sseStreamTransport);
	streamRegistry.register(wsStreamTransport);
	tractor.onNode("StreamChunk", async (node) => {
		streamRegistry.dispatch(toStreamChunk(node as Record<string, unknown>));
	});
	console.log(
		"[farmhand] Stream transports registered (File, SSE, WebSocket).",
	);

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
	console.log(
		`[farmhand] WebSocket server listening on ws://localhost:${FARMHAND_PORT}`,
	);

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
		stopFileWatcher();
		await httpSidecar.stop();
		await transport.disconnect();
		await tractor.shutdown?.();
		process.exit(0);
	}

	process.on("SIGTERM", () => {
		void shutdown();
	});
	process.on("SIGINT", () => {
		void shutdown();
	});

	console.log("[farmhand] Ready.");
}

main().catch((err) => {
	console.error("[farmhand] Fatal error:", err);
	process.exit(1);
});
