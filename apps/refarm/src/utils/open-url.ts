import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import {
	openHostBrowserUrl,
	type BrowserOpenSpec,
} from "@refarm.dev/cli/browser-open";
import { loadConfig } from "@refarm.dev/config";
import { hasTty, isCI } from "@refarm.dev/root";

type OpenExternalLinksMode = "auto" | "never";

interface RefarmOpenLinkConfig {
	operator?: {
		openExternalLinks?: OpenExternalLinksMode | boolean;
	};
}

export function tryOpenUrl(url: string): void {
	if (!shouldOpenExternalLinks()) return;

	void openHostBrowserUrl(url, { run: runBestEffortOpenCandidate }).catch(() => {
		// best-effort — callers print the URL and manual fallback instructions.
	});
}

export function shouldOpenExternalLinks(): boolean {
	const mode = resolveOpenExternalLinksMode();
	if (mode === "never") return false;
	if (isCI()) return false;
	if (!hasTty()) return false;
	return true;
}

function resolveOpenExternalLinksMode(): OpenExternalLinksMode {
	const envMode = normalizeOpenExternalLinksMode(process.env["REFARM_OPEN_EXTERNAL_LINKS"]);
	if (envMode) return envMode;

	const cliConfigMode = readOperatorCliOpenExternalLinksMode();
	if (cliConfigMode) return cliConfigMode;

	try {
		const config = loadConfig() as RefarmOpenLinkConfig;
		const configured = config.operator?.openExternalLinks;
		if (configured === false) return "never";
		if (configured === true) return "auto";
		return normalizeOpenExternalLinksMode(configured) ?? "auto";
	} catch {
		return "auto";
	}
}

function readOperatorCliOpenExternalLinksMode(): OpenExternalLinksMode | null {
	let resolvedMode: OpenExternalLinksMode | null = null;
	for (const base of [
		path.join(os.homedir(), ".refarm"),
		path.join(process.cwd(), ".refarm"),
	]) {
		const configPath = path.join(base, "config.json");
		if (!fs.existsSync(configPath)) continue;
		try {
			const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RefarmOpenLinkConfig;
			const mode = normalizeOpenExternalLinksMode(config.operator?.openExternalLinks);
			if (mode) resolvedMode = mode;
		} catch {
			// Ignore malformed operator config and keep the best-effort opener path.
		}
	}
	return resolvedMode;
}

function normalizeOpenExternalLinksMode(value: unknown): OpenExternalLinksMode | null {
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

function runBestEffortOpenCandidate(spec: BrowserOpenSpec): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			const child = execFile(
				spec.command,
				spec.args,
				{ timeout: 5000 },
				(error) => {
					if (error) reject(error);
					else resolve();
				},
			);
			child.unref();
		} catch (error) {
			reject(error);
		}
	});
}
