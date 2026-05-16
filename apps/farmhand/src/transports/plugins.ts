import crypto from "node:crypto";
import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { installWasmArtifact, type PluginManifest } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "../filesystem-cache-adapter.js";
import { listInstalledPluginIds, loadInstalledPlugins } from "../installed-plugins.js";
import { LocalExtensionRegistry } from "../local-extensions.js";
import type { PluginUsageTracker } from "../plugin-usage-tracker.js";

export interface PluginReloadTarget {
	registry: {
		register(manifest: PluginManifest, sourceUrl?: string): Promise<string>;
		trust(pluginId: string): Promise<void>;
	};
	plugins: {
		load(manifest: PluginManifest): Promise<unknown>;
	};
}

const RELOAD_STATUS_TTL_MS = 5 * 60 * 1_000;

interface ReloadStatus {
	pending: Set<string>;
	completed: Set<string>;
	failed: Set<string>;
	createdAt: number;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(data ? (JSON.parse(data) as T) : null);
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}

export function createPluginsRouteHandler(
	target: PluginReloadTarget,
	baseDir: string,
	tracker: PluginUsageTracker,
	localExtensions?: LocalExtensionRegistry,
) {
	const reloadStatuses = new Map<string, ReloadStatus>();
	const pendingPluginReloads = new Map<string, Set<string>>();

	function evictStale(): void {
		const now = Date.now();
		for (const [id, status] of reloadStatuses) {
			if (now - status.createdAt > RELOAD_STATUS_TTL_MS) reloadStatuses.delete(id);
		}
	}

	async function performReload(pluginId: string, watchers: Set<string>): Promise<void> {
		try {
			if (localExtensions?.getLoadedIds().includes(pluginId)) {
				await localExtensions.reload(
					target as Parameters<typeof localExtensions.reload>[0],
					pluginId,
				);
			} else {
				await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
			}
			for (const wId of watchers) {
				const s = reloadStatuses.get(wId);
				if (s) {
					s.pending.delete(pluginId);
					s.completed.add(pluginId);
				}
			}
		} catch (err) {
			console.error(
				`[farmhand] Failed to reload plugin "${pluginId}":`,
				err instanceof Error ? err.message : String(err),
			);
			for (const wId of watchers) {
				const s = reloadStatuses.get(wId);
				if (s) {
					s.pending.delete(pluginId);
					s.failed.add(pluginId);
				}
			}
		}
	}

	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

		if (requestUrl.pathname === "/plugins/install") {
			void (async () => {
				try {
					if (req.method !== "POST") {
						json(res, 405, { error: "method not allowed" });
						return;
					}

					const body = await readJsonBody<{
						pluginId?: unknown;
						wasmUrl?: unknown;
						integrity?: unknown;
						manifest?: unknown;
					}>(req);

					const pluginId = typeof body?.pluginId === "string" ? body.pluginId.trim() : null;
					const wasmUrl = typeof body?.wasmUrl === "string" ? body.wasmUrl.trim() : null;
					const integrity = typeof body?.integrity === "string" ? body.integrity.trim() : null;
					const manifest =
						body?.manifest && typeof body.manifest === "object" && !Array.isArray(body.manifest)
							? (body.manifest as PluginManifest)
							: null;

					if (!pluginId) { json(res, 400, { error: "pluginId is required" }); return; }
					if (!wasmUrl) { json(res, 400, { error: "wasmUrl is required" }); return; }
					if (!integrity) { json(res, 400, { error: "integrity is required" }); return; }
					if (!manifest) { json(res, 400, { error: "manifest is required" }); return; }

					const pluginsDir = path.join(baseDir, "plugins");
					const cache = createFilesystemCacheAdapter(pluginsDir);

					const result = await installWasmArtifact(
						{ pluginId, wasmUrl, integrity },
						{ cache },
					);

					const wasmAbsPath = path.join(pluginsDir, pluginId, "plugin.wasm");
					const manifestOnDisk: PluginManifest = {
						...manifest,
						id: pluginId,
						entry: `file://${wasmAbsPath}`,
						integrity,
					};
					const manifestPath = path.join(pluginsDir, pluginId, "plugin.json");
					await fs.mkdir(path.join(pluginsDir, pluginId), { recursive: true });
					await fs.writeFile(manifestPath, JSON.stringify(manifestOnDisk, null, 2), "utf-8");

					await target.registry.register(manifestOnDisk);
					await target.registry.trust(pluginId);
					await target.plugins.load(manifestOnDisk);

					json(res, 200, {
						pluginId: result.pluginId,
						wasmHash: result.wasmHash,
						byteLength: result.byteLength,
						artifactKind: result.artifactKind,
					});
				} catch (error) {
					json(res, 500, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			})();
			return true;
		}

		// GET /plugins/reload/status/:reloadId
		const statusMatch = requestUrl.pathname.match(/^\/plugins\/reload\/status\/([^/]+)$/u);
		if (statusMatch) {
			evictStale();
			const reloadId = statusMatch[1]!;
			const status = reloadStatuses.get(reloadId);
			if (!status) {
				json(res, 404, { error: "not found" });
			} else {
				json(res, 200, {
					reloadId,
					pending: [...status.pending],
					completed: [...status.completed],
					failed: [...status.failed],
				});
			}
			return true;
		}

		if (requestUrl.pathname !== "/plugins/reload") return false;

		void (async () => {
			try {
				if (req.method !== "POST") {
					json(res, 405, { error: "method not allowed" });
					return;
				}

				evictStale();

				const body = await readJsonBody<{ pluginIds?: unknown }>(req);
				const pluginIds =
					Array.isArray(body?.pluginIds) &&
					(body.pluginIds as unknown[]).every((id) => typeof id === "string")
						? (body.pluginIds as string[])
						: [
								...listInstalledPluginIds(baseDir),
								...(localExtensions?.getLoadedIds() ?? []),
							];

				const reloadId = crypto.randomUUID();
				const status: ReloadStatus = {
					pending: new Set(),
					completed: new Set(),
					failed: new Set(),
					createdAt: Date.now(),
				};
				reloadStatuses.set(reloadId, status);

				for (const pluginId of pluginIds) {
					if (tracker.isIdle(pluginId)) {
						try {
							if (localExtensions?.getLoadedIds().includes(pluginId)) {
								await localExtensions.reload(
									target as Parameters<typeof localExtensions.reload>[0],
									pluginId,
								);
							} else {
								await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
							}
							status.completed.add(pluginId);
						} catch (err) {
							console.error(
								`[farmhand] Failed to reload plugin "${pluginId}":`,
								err instanceof Error ? err.message : String(err),
							);
							status.failed.add(pluginId);
						}
					} else {
						status.pending.add(pluginId);
						const existing = pendingPluginReloads.get(pluginId);
						if (existing) {
							existing.add(reloadId);
						} else {
							const watchers = new Set([reloadId]);
							pendingPluginReloads.set(pluginId, watchers);
							tracker.onIdle(pluginId, () => {
								pendingPluginReloads.delete(pluginId);
								void performReload(pluginId, watchers);
							});
						}
					}
				}

				json(res, 200, {
					reloadId,
					reloaded: [...status.completed],
					deferred: [...status.pending],
					skipped: [...status.failed],
				});
			} catch (error) {
				json(res, 500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();

		return true;
	};
}
