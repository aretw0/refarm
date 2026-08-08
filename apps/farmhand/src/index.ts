/**
 * Farmhand — Headless Refarm daemon
 *
 * Boots a Tractor instance backed by LoroCRDTStorage (ADR-045) and exposes a
 * WebSocket sync transport on 127.0.0.1:42000 (loopback by default — see
 * FARMHAND_WS_HOST). Studio (browser) connects to ws://localhost:42000 for binary
 * Loro CRDT sync.
 *
 * Reactive behaviors:
 *  - PluginRoute nodes  → load the referenced plugin into this Tractor instance
 *  - FarmhandTask nodes → execute the plugin function, write result back to graph
 */

import { AGENT_CORE_BUNDLE, loadConfigAsync } from "@refarm.dev/config";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import type { IdentityAdapter } from "@refarm.dev/identity-contract-v1";
import type { RuntimeHost, RuntimePluginLoaderTarget } from "@refarm.dev/runtime";
import { SiloCore } from "@refarm.dev/silo";
import { SseStreamTransport } from "@refarm.dev/sse-stream-transport";
import { DEFAULT_BIND_HOST } from "@refarm.dev/std";
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
import { injectConfiguredProvidersEnv } from "./configured-providers-env.js";
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
import { createSiloModelEnvInjector, type OAuthCreds } from "./silo-model-env.js";
import { injectSkillEnv } from "./skill-env.js";
import {
	projectStreamChunk,
	shouldProjectStreamChunk,
	toStreamChunk,
} from "./stream-chunk-mapper.js";
import { StreamRegistry } from "./stream-registry.js";
import { executeTask } from "./task-executor.js";
import { createTaskMemoryBridge } from "./task-memory-bridge.js";
import { WebSocketSyncTransport } from "./transport.js";
import { createControlSurfaceRouteHandler } from "./transports/channels.js";
import { FileTransportAdapter, type TaskExecutorFn } from "./transports/file.js";
import { HttpSidecar } from "./transports/http.js";
import { createPluginsRouteHandler } from "./transports/plugins.js";
import { createSessionsRouteHandler } from "./transports/sessions.js";
import { createTasksRouteHandler } from "./transports/tasks.js";

const FARMHAND_PORT = 42000;
// `undefined` when the operator set nothing, NOT a loopback default. The absence is
// load-bearing: this is the `daemon-ws` surface, and under S5 a value that is always present
// always NARROWS, so substituting `127.0.0.1` here would make `surfaces.daemon-ws` permanently
// inert and silent — the exact defect `refarm web serve`'s `--host` default carried. An absent
// value means "let the declaration decide"; loopback is what an absent DECLARATION resolves to
// (S1). This is an UNAUTHENTICATED CRDT relay — a peer that reaches it reads and writes the
// whole document — so it refuses any declaration it cannot enforce (see transport.ts).
const FARMHAND_WS_HOST = process.env.FARMHAND_WS_HOST?.trim() || undefined;
const FARMHAND_HTTP_PORT = Number(process.env.FARMHAND_HTTP_PORT ?? 42001);
// Bind parity with the Rust daemon's --http-host: loopback unless the operator
// explicitly opens the sidecar to other devices.
const FARMHAND_HTTP_HOST = process.env.FARMHAND_HTTP_HOST?.trim() || DEFAULT_BIND_HOST;
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
			return Array.from(store.values()).filter((r) => (r as { type: string }).type === type);
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
		const pluginManifest =
			manifest as unknown as import("@refarm.dev/plugin-manifest").PluginManifest;
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
		effortId: (node["task:effortId"] as string | undefined) ?? (node["@id"] as string),
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

async function refreshOAuthToken(
	oauthProvider: string,
	creds: OAuthCreds,
): Promise<OAuthCreds | null> {
	const tokenUrl = OAUTH_TOKEN_URLS[oauthProvider];
	const clientId = OAUTH_CLIENT_IDS[oauthProvider];
	if (!tokenUrl || !clientId) return null;
	try {
		const isOpenAI = oauthProvider === "openai-codex";
		const body = isOpenAI
			? new URLSearchParams({
					grant_type: "refresh_token",
					client_id: clientId,
					refresh_token: creds.refresh,
				})
			: JSON.stringify({
					grant_type: "refresh_token",
					client_id: clientId,
					refresh_token: creds.refresh,
				});
		const headers = isOpenAI
			? { "content-type": "application/x-www-form-urlencoded" }
			: { "content-type": "application/json", accept: "application/json" };
		const res = await fetch(tokenUrl, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) return null;
		const d = isOpenAI
			? ((await res.json()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				})
			: (JSON.parse(await res.text()) as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				});
		return {
			access: d.access_token,
			refresh: d.refresh_token,
			expires: Date.now() + d.expires_in * 1000 - 300_000,
		};
	} catch {
		return null;
	}
}

async function injectSiloModelEnv(): Promise<void> {
	await siloModelEnvInjector.inject();
}

async function main() {
	console.log(`[farmhand] Booting (id=${FARMHAND_ID})...`);
	// The substrate has NO default config-dir name (it reads SOVEREIGN_DIR).
	// Farmhand is a refarm daemon, so it injects ".refarm" before any config read.
	if (!process.env.SOVEREIGN_DIR?.trim()) {
		process.env.SOVEREIGN_DIR = ".refarm";
	}
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
		console.warn(
			"[farmhand] Failed to load config, skipping auto-install:",
			err instanceof Error ? err.message : String(err),
		);
		return {};
	});
	const autoEntries: unknown[] = Array.isArray(config?.plugins?.autoInstall)
		? (config.plugins.autoInstall as unknown[])
		: [];

	const pluginsDir = path.join(farmhandBaseDir, "plugins");
	await mkdir(pluginsDir, { recursive: true });

	// Phase 0: Load local extensions from .refarm/extensions/ (project) and ~/.refarm/extensions/ (global)
	// Loaded first so project-local extensions can override bundled runtime-agent plugins.
	const localExtRegistry = new LocalExtensionRegistry(process.cwd(), os.homedir());
	const localExtSummary = await localExtRegistry.load(runtime);
	if (localExtSummary.loaded > 0 || localExtSummary.skipped > 0) {
		console.log(
			`[farmhand] Local extensions: loaded=${localExtSummary.loaded} skipped=${localExtSummary.skipped}`,
		);
	}

	// Phase 1: Bundled plugins — auto-install from co-located npm packages.
	// The default set IS the agent core-plugin cut (config.AGENT_CORE_BUNDLE): the
	// minimal agent plus the plugins that extend it (today: LSP code-ops). Deriving
	// from the config descriptor — rather than hand-listing here — is what makes
	// AGENT_CORE_BUNDLE.corePlugins the single source of truth; farmhand only maps the
	// descriptor shape to its installer entry (id/package/wasmFile/requiredProvides).
	const defaultBundled: BundledEntry[] = [
		AGENT_CORE_BUNDLE.agent,
		...AGENT_CORE_BUNDLE.corePlugins,
	].map((d) => ({
		id: d.id,
		package: d.npmPackage,
		wasmFile: d.wasmFile,
		requiredProvides: [...d.requiredProvides],
	}));
	const configBundled: BundledEntry[] = Array.isArray(config?.plugins?.bundled)
		? (config.plugins.bundled as BundledEntry[])
		: [];
	const bundledEntries =
		process.env.FARMHAND_SKIP_BUNDLED_INSTALL === "1" ? [] : [...defaultBundled, ...configBundled];
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

	const loadSummary = await loadInstalledPlugins(runtime, farmhandBaseDir);
	if (loadSummary.loaded > 0 || loadSummary.skipped > 0) {
		console.log(
			`[farmhand] Installed plugin scan complete: loaded=${loadSummary.loaded} skipped=${loadSummary.skipped}`,
		);
	}

	// Pack the installed skills' disclosure index into MODEL_SKILLS so the agent's
	// system prompt lists them (progressive disclosure). After the plugin scan, so
	// any pi/skill surface a just-loaded plugin ships is included.
	const skillEnv = injectSkillEnv(pluginsDir);
	if (skillEnv.count > 0) {
		console.log(`[farmhand] Skills disclosed to the agent: ${skillEnv.count}`);
	}

	// ADR-012: tell the guest which providers are configured (names only, no keys) so
	// its routing profiles (cheap/balanced/reliable) can resolve to a real provider.
	const routeEnv = injectConfiguredProvidersEnv();
	if (routeEnv.count > 0) {
		console.log(`[farmhand] Configured providers advertised to the agent: ${routeEnv.count}`);
	}

	const taskDbPath = path.join(farmhandBaseDir, "task-memory.db");
	const taskMemoryAdapter = createTaskV1StorageAdapter({
		provider: createNodeSqliteStorageProvider(taskDbPath),
	});
	const taskMemoryBridge = createTaskMemoryBridge({
		adapter: taskMemoryAdapter,
		actorUrn: `urn:sovereign:farmhand:${FARMHAND_ID}`,
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
				memoryError instanceof Error ? memoryError.message : String(memoryError),
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
				memoryError instanceof Error ? memoryError.message : String(memoryError),
			);
		}

		return {
			status,
			result,
			error,
			meta: {
				modelScope: scope,
				modelProvider: route.provider,
				modelId: route.modelId,
			},
		};
	};

	const pluginTracker = new PluginUsageTracker();
	const fileTransport = new FileTransportAdapter(farmhandBaseDir, taskExecutorFn, {
		onEffortStart: (effortId, pluginIds) => pluginTracker.registerEffort(effortId, pluginIds),
		onEffortEnd: (effortId) => pluginTracker.releaseEffort(effortId),
	});
	const stopFileWatcher = fileTransport.watch();
	console.log(`[farmhand] File transport watching ${farmhandBaseDir}/tasks/`);

	const httpSidecar = new HttpSidecar(
		FARMHAND_HTTP_PORT,
		fileTransport.operations,
		FARMHAND_HTTP_HOST,
	);
	httpSidecar.addRouteHandler(createSessionsRouteHandler(runtime));
	httpSidecar.addRouteHandler(createTasksRouteHandler(taskMemoryAdapter));
	httpSidecar.addRouteHandler(createControlSurfaceRouteHandler(fileTransport));
	httpSidecar.addRouteHandler(
		createPluginsRouteHandler(runtime, farmhandBaseDir, pluginTracker, localExtRegistry),
	);
	await httpSidecar.start();
	console.log(
		`[farmhand] HTTP sidecar listening on http://${FARMHAND_HTTP_HOST}:${FARMHAND_HTTP_PORT}`,
	);

	const streamsDir = path.join(farmhandBaseDir, "streams");
	const fileStreamTransport = new FileStreamTransport(streamsDir);
	const sseStreamTransport = new SseStreamTransport(fileStreamTransport);
	const wsStreamTransport = new WsStreamTransport(httpSidecar.httpServer, fileStreamTransport);
	httpSidecar.addRouteHandler(sseStreamTransport.getRouteHandler());

	const streamRegistry = new StreamRegistry();
	streamRegistry.register(fileStreamTransport);
	streamRegistry.register(sseStreamTransport);
	streamRegistry.register(wsStreamTransport);
	runtime.onNode("StreamChunk", async (node) => {
		const chunk = toStreamChunk(node as Record<string, unknown>);
		// The tractor-ts guest cannot write the final ndjson line (its wasi:filesystem
		// is an inert stub), so the host projects it here. projectStreamChunk mirrors the
		// guest's single-owner rule: the agent-response FINAL keeps the whole answer only
		// on the single-shot path (sequence 0) and is blanked to a pure end-marker when
		// partials already carried the deltas, so the answer is filed exactly once.
		if (shouldProjectStreamChunk(chunk)) {
			streamRegistry.dispatch(projectStreamChunk(chunk));
		}
	});
	console.log("[farmhand] Stream transports registered (File, SSE, WebSocket).");

	// Write initial presence node (goes into LoroDoc, projected to read model)
	await runtime.storeNode({
		"@context": "https://schema.refarm.dev/",
		"@type": "FarmhandPresence",
		"@id": `urn:farmhand:presence:${FARMHAND_ID}`,
		sourcePlugin: FARMHAND_PLUGIN_ID,
		farmhandId: FARMHAND_ID,
		status: "online",
		startedAt: new Date().toISOString(),
		lastHeartbeatAt: new Date().toISOString(),
	});

	console.log("[farmhand] Presence node written.");

	// Start WebSocket transport (binary Uint8Array frames — Loro deltas)
	const transport = new WebSocketSyncTransport(FARMHAND_PORT, FARMHAND_WS_HOST);
	// Print the host it ACTUALLY bound. This line used to say `ws://localhost:42000` while
	// the server bound every interface — a log that actively misreported the exposure, which
	// is worse than no log: an operator reading it concludes the relay is local-only.
	console.log(`[farmhand] WebSocket server listening on ws://${transport.host}:${FARMHAND_PORT}`);

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
				sourcePlugin: FARMHAND_PLUGIN_ID,
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
