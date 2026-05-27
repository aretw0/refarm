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

import {
	PI_AGENT_NPM_PACKAGE,
	PI_AGENT_PLUGIN_ID,
	loadConfigAsync,
} from "@refarm.dev/config";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type {
RuntimeHost,
RuntimePluginLoaderTarget,
} from "@refarm.dev/runtime";
import { SiloCore } from "@refarm.dev/silo";
import { SseStreamTransport } from "@refarm.dev/sse-stream-transport";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import { createTaskV1StorageAdapter } from "@refarm.dev/storage-sqlite";
import { createNodeSqliteStorageProvider } from "@refarm.dev/storage-sqlite/node";
import { LoroCRDTStorage, peerIdFromString } from "@refarm.dev/sync-loro";
import { Tractor } from "@refarm.dev/tractor";
import { WsStreamTransport } from "@refarm.dev/ws-stream-transport";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { autoInstallPlugins } from "./auto-install-plugins.js";
import { bundleInstallPlugins, type BundledEntry } from "./bundled-plugins.js";
import { injectConfigEnv } from "./config-env.js";
import { loadInstalledPlugins } from "./installed-plugins.js";
import { LocalExtensionRegistry } from "./local-extensions.js";
import {
	createModelRouteResolver,
	routeForScope,
	routeResolutionEnv,
	scopeForEffortSource,
	withModelRouteEnv,
} from "./model-routes.js";
import { PluginUsageTracker } from "./plugin-usage-tracker.js";
import {
	createSiloModelEnvInjector,
	type OAuthCreds,
} from "./silo-model-env.js";
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
import { createPluginsRouteHandler } from "./transports/plugins.js";
import { createSessionsRouteHandler } from "./transports/sessions.js";
import { createTasksRouteHandler } from "./transports/tasks.js";

const FARMHAND_PORT = 42000;
const FARMHAND_HTTP_PORT = Number(process.env.FARMHAND_HTTP_PORT ?? 42001);
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
	tractor: RuntimePluginLoaderTarget,
	node: Record<string, unknown>,
): Promise<void> {
	const assignedTo = node["plugin:assignedTo"] as string | undefined;
	if (assignedTo && assignedTo !== FARMHAND_ID) return; // not for this daemon

	const manifest = node["plugin:manifest"] as Record<string, unknown> | undefined;
	if (!manifest?.id) {
		console.warn("[farmhand] PluginRoute missing plugin:manifest — skipping");
		return;
	}

	console.log(`[farmhand] PluginRoute: loading plugin "${manifest.id}"`);
	try {
		const pluginManifest = manifest as unknown as import("@refarm.dev/plugin-manifest").PluginManifest;
		await tractor.registry.register(pluginManifest);
		await tractor.registry.trust(pluginManifest.id);
		await tractor.plugins.load(pluginManifest);
		console.log(`[farmhand] Plugin "${pluginManifest.id}" loaded successfully`);
	} catch (e) {
		console.error(
			`[farmhand] Failed to load plugin "${manifest.id}":`,
			e instanceof Error ? e.message : String(e),
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
	tractor: RuntimeHost,
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

const OAUTH_TOKEN_URLS: Record<string, string> = {
	anthropic: "https://platform.claude.com/v1/oauth/token",
	"openai-codex": "https://auth.openai.com/oauth/token",
};
const OAUTH_CLIENT_IDS: Record<string, string> = {
	anthropic: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	"openai-codex": "app_EMoamEEZ73f0CkXaXp7hrann",
};

const silo = new SiloCore();
const modelRouteResolver = createModelRouteResolver({
	loadTokens: () => silo.loadTokens() as Promise<Record<string, unknown>>,
});
const siloModelEnvInjector = createSiloModelEnvInjector({
	store: {
		loadTokens: () => silo.loadTokens() as Promise<Record<string, unknown>>,
		saveTokens: (tokens) => silo.saveTokens(tokens),
	},
	refreshOAuthToken,
});

async function refreshOAuthToken(oauthProvider: string, creds: OAuthCreds): Promise<OAuthCreds | null> {
	const tokenUrl = OAUTH_TOKEN_URLS[oauthProvider];
	const clientId = OAUTH_CLIENT_IDS[oauthProvider];
	if (!tokenUrl || !clientId) return null;
	try {
		const isOpenAI = oauthProvider === "openai-codex";
		const body = isOpenAI
			? new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: creds.refresh })
			: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, refresh_token: creds.refresh });
		const headers = isOpenAI
			? { "content-type": "application/x-www-form-urlencoded" }
			: { "content-type": "application/json", accept: "application/json" };
		const res = await fetch(tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return null;
		const d = isOpenAI
			? (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
			: JSON.parse(await res.text()) as { access_token: string; refresh_token: string; expires_in: number };
		return { access: d.access_token, refresh: d.refresh_token, expires: Date.now() + d.expires_in * 1000 - 300_000 };
	} catch {
		return null;
	}
}

async function injectSiloModelEnv(): Promise<void> {
	await siloModelEnvInjector.inject();
}

async function main() {
	console.log(`[farmhand] Booting (id=${FARMHAND_ID})...`);
	await injectSiloModelEnv();
	await injectConfigEnv();

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
	const runtime = tractor as unknown as RuntimeHost;

	console.log("[farmhand] Tractor booted with Loro CRDT storage.");

	const farmhandBaseDir = process.env.FARMHAND_DATA_DIR ?? path.join(os.homedir(), ".refarm");
	await mkdir(farmhandBaseDir, { recursive: true });

	const config = await loadConfigAsync().catch((err: unknown) => {
		console.warn("[farmhand] Failed to load config, skipping auto-install:", err instanceof Error ? err.message : String(err));
		return {};
	});
	const autoEntries: unknown[] = Array.isArray(config?.plugins?.autoInstall)
		? (config.plugins.autoInstall as unknown[])
		: [];

	const pluginsDir = path.join(farmhandBaseDir, "plugins");
	await mkdir(pluginsDir, { recursive: true });

	// Phase 0: Load local extensions from .refarm/extensions/ (project) and ~/.refarm/extensions/ (global)
	// Loaded first so project-local extensions can override bundled plugins like pi-agent.
	const localExtRegistry = new LocalExtensionRegistry(process.cwd(), os.homedir());
	const localExtSummary = await localExtRegistry.load(runtime);
	if (localExtSummary.loaded > 0 || localExtSummary.skipped > 0) {
		console.log(
			`[farmhand] Local extensions: loaded=${localExtSummary.loaded} skipped=${localExtSummary.skipped}`,
		);
	}

	// Phase 1: Bundled plugins — auto-install from co-located npm packages
	const defaultBundled: BundledEntry[] = [
		{
			id: PI_AGENT_PLUGIN_ID,
			package: PI_AGENT_NPM_PACKAGE,
			wasmFile: "dist/pi_agent.wasm",
		},
	];
	const configBundled: BundledEntry[] = Array.isArray(config?.plugins?.bundled)
		? (config.plugins.bundled as BundledEntry[])
		: [];
	const bundledEntries = process.env.FARMHAND_SKIP_BUNDLED_INSTALL === "1"
		? []
		: [...defaultBundled, ...configBundled];
	const bundledSummary = await bundleInstallPlugins(bundledEntries, pluginsDir);
	console.log(
		`[farmhand] Bundled install: installed=${bundledSummary.installed} cached=${bundledSummary.cached} failed=${bundledSummary.failed}`,
	);

	// Phase 2: Auto-install from URLs (config.plugins.autoInstall)
	if (autoEntries.length > 0) {
		const autoSummary = await autoInstallPlugins(autoEntries, pluginsDir);
		console.log(
			`[farmhand] Auto-install: installed=${autoSummary.installed} cached=${autoSummary.cached} failed=${autoSummary.failed}`,
		);
	}

	const loadSummary = await loadInstalledPlugins(
		runtime,
		farmhandBaseDir,
	);
	if (loadSummary.loaded > 0 || loadSummary.skipped > 0) {
		console.log(
			`[farmhand] Installed plugin scan complete: loaded=${loadSummary.loaded} skipped=${loadSummary.skipped}`,
		);
	}

	const taskDbPath = path.join(farmhandBaseDir, "task-memory.db");
	const taskMemoryAdapter = createTaskV1StorageAdapter({
		provider: createNodeSqliteStorageProvider(taskDbPath),
	});
	const taskMemoryBridge = createTaskMemoryBridge({
		adapter: taskMemoryAdapter,
		actorUrn: `urn:refarm:farmhand:${FARMHAND_ID}`,
	});
	console.log(`[farmhand] Task memory persisted to ${taskDbPath}`);

	const taskExecutorFn: TaskExecutorFn = async (task, effortId, effort) => {
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
			plugins: runtime.plugins,
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

		const scope = scopeForEffortSource(effort.source);
		await injectSiloModelEnv();
		const tokens = await modelRouteResolver.refreshTokens();
		const route = routeForScope(tokens, scope, {
			env: routeResolutionEnv(process.env, siloModelEnvInjector.managedEnvKeys()),
		});
		await withModelRouteEnv(
			route,
			() =>
				executeTask(captureTractor, {
					taskId: task.id,
					effortId,
					pluginId: task.pluginId,
					fn: task.fn,
					args: task.args,
				}),
			{ managedEnvKeys: siloModelEnvInjector.managedEnvKeys() },
		);

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

	const pluginTracker = new PluginUsageTracker();
	const fileTransport = new FileTransportAdapter(
		farmhandBaseDir,
		taskExecutorFn,
		{
			onEffortStart: (effortId, pluginIds) => pluginTracker.registerEffort(effortId, pluginIds),
			onEffortEnd:   (effortId)            => pluginTracker.releaseEffort(effortId),
		},
	);
	const stopFileWatcher = fileTransport.watch();
	console.log(`[farmhand] File transport watching ${farmhandBaseDir}/tasks/`);

	const httpSidecar = new HttpSidecar(FARMHAND_HTTP_PORT, fileTransport);
	httpSidecar.addRouteHandler(createSessionsRouteHandler(runtime));
	httpSidecar.addRouteHandler(createTasksRouteHandler(taskMemoryAdapter));
	httpSidecar.addRouteHandler(createPluginsRouteHandler(runtime, farmhandBaseDir, pluginTracker, localExtRegistry));
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
	runtime.onNode("StreamChunk", async (node) => {
		streamRegistry.dispatch(toStreamChunk(node as Record<string, unknown>));
	});
	console.log(
		"[farmhand] Stream transports registered (File, SSE, WebSocket).",
	);

	// Write initial presence node (goes into LoroDoc, projected to read model)
	await runtime.storeNode({
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
	runtime.onNode("PluginRoute", (node) => handlePluginRoute(runtime, node));
	runtime.onNode("FarmhandTask", (node) => handleFarmhandTask(runtime, node));

	// Periodic heartbeat: refresh FarmhandPresence every 30 seconds
	const heartbeatTimer = setInterval(async () => {
		try {
			await runtime.storeNode({
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
		await runtime.shutdown?.();
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
	process.exitCode = 1;
});
