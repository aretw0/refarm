import { installWasmArtifact } from "@refarm.dev/plugin-manifest";
import { createFilesystemCacheAdapter } from "./filesystem-cache-adapter.js";

export interface AutoInstallEntry {
	id: string;
	url: string;
	integrity: string;
}

export interface AutoInstallSummary {
	installed: number;
	cached: number;
	failed: number;
}

interface LoggerLike {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

function isValidEntry(entry: unknown): entry is AutoInstallEntry {
	if (!entry || typeof entry !== "object") return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e["id"] === "string" &&
		typeof e["url"] === "string" &&
		typeof e["integrity"] === "string"
	);
}

export async function autoInstallPlugins(
	entries: unknown[],
	pluginsDir: string,
	logger: LoggerLike = console,
): Promise<AutoInstallSummary> {
	const summary: AutoInstallSummary = { installed: 0, cached: 0, failed: 0 };
	const cache = createFilesystemCacheAdapter(pluginsDir);

	for (const raw of entries) {
		if (!isValidEntry(raw)) {
			logger.warn("[farmhand] autoInstall: skipping invalid entry", raw);
			summary.failed += 1;
			continue;
		}

		try {
			const result = await installWasmArtifact(
				{ pluginId: raw.id, wasmUrl: raw.url, integrity: raw.integrity },
				{ cache },
			);

			if (result.cached) {
				logger.info(`[farmhand] autoInstall: ${raw.id} already cached`);
				summary.cached += 1;
			} else {
				logger.info(`[farmhand] autoInstall: ${raw.id} installed (${result.byteLength} bytes)`);
				summary.installed += 1;
			}
		} catch (err) {
			logger.warn(
				`[farmhand] autoInstall: failed to install ${raw.id}:`,
				err instanceof Error ? err.message : String(err),
			);
			summary.failed += 1;
		}
	}

	return summary;
}
