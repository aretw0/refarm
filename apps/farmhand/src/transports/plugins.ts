import crypto from "node:crypto";
import type http from "node:http";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { listInstalledPluginIds, loadInstalledPlugins } from "../installed-plugins.js";
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
			await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
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
						: listInstalledPluginIds(baseDir);

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
							await loadInstalledPlugins(target, baseDir, { pluginFilter: [pluginId] });
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
