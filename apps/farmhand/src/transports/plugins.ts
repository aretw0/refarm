import type http from "node:http";
import type { PluginManifest } from "@refarm.dev/plugin-manifest";
import { loadInstalledPlugins } from "../installed-plugins.js";

export interface PluginReloadTarget {
	registry: {
		register(manifest: PluginManifest, sourceUrl?: string): Promise<string>;
		trust(pluginId: string): Promise<void>;
	};
	plugins: {
		load(manifest: PluginManifest): Promise<unknown>;
	};
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

export function createPluginsRouteHandler(
	target: PluginReloadTarget,
	baseDir: string,
) {
	return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
		const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
		if (requestUrl.pathname !== "/plugins/reload") return false;

		void (async () => {
			try {
				if (req.method !== "POST") {
					json(res, 405, { error: "method not allowed" });
					return;
				}

				const summary = await loadInstalledPlugins(target, baseDir);
				json(res, 200, { reloaded: summary.loaded, skipped: summary.skipped });
			} catch (error) {
				json(res, 500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();

		return true;
	};
}
