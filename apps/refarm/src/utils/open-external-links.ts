import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type OpenExternalLinksMode = "auto" | "never";

export interface RefarmOpenLinkConfig {
	operator?: {
		openExternalLinks?: OpenExternalLinksMode | boolean;
	};
}

export interface OpenExternalLinksDeps {
	cwd?: string;
	home?: string;
	env?: Record<string, string | undefined>;
}

export function parseOpenExternalLinksMode(value: unknown): OpenExternalLinksMode | null {
	if (value === false) return "never";
	if (value === true) return "auto";
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "never") {
		return "never";
	}
	if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "auto") {
		return "auto";
	}
	return null;
}

export function resolveCliOpenExternalLinksMode(
	deps: OpenExternalLinksDeps = {},
): { value: OpenExternalLinksMode; source: string } | null {
	const env = deps.env ?? process.env;
	const envMode = parseOpenExternalLinksMode(env.REFARM_OPEN_EXTERNAL_LINKS);
	if (envMode) return { value: envMode, source: "env:REFARM_OPEN_EXTERNAL_LINKS" };

	const home = deps.home ?? os.homedir();
	const cwd = deps.cwd ?? process.cwd();
	let resolved: { value: OpenExternalLinksMode; source: string } | null = null;
	for (const filePath of [
		path.join(home, ".refarm", "config.json"),
		path.join(cwd, ".refarm", "config.json"),
	]) {
		if (!fs.existsSync(filePath)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RefarmOpenLinkConfig;
			const mode = parseOpenExternalLinksMode(config.operator?.openExternalLinks);
			if (mode) resolved = { value: mode, source: filePath };
		} catch {
			// Ignore malformed operator config and keep searching.
		}
	}
	return resolved;
}
