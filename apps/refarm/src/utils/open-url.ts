import {
	openHostBrowserUrl,
	runBestEffortBrowserOpenCandidate,
} from "@refarm.dev/cli/browser-open";
import { loadConfig } from "@refarm.dev/config";
import { hasTty, isCI } from "@refarm.dev/root";
import {
	parseOpenExternalLinksMode,
	resolveCliOpenExternalLinksMode,
	type RefarmOpenLinkConfig,
	type OpenExternalLinksMode,
} from "./open-external-links.js";

export function tryOpenUrl(url: string): void {
	if (!shouldOpenExternalLinks()) return;

	void openHostBrowserUrl(url, { run: runBestEffortBrowserOpenCandidate }).catch(
		() => {
			// best-effort — callers print the URL and manual fallback instructions.
		},
	);
}

export function shouldOpenExternalLinks(): boolean {
	const mode = resolveOpenExternalLinksMode();
	if (mode === "never") return false;
	if (isCI()) return false;
	if (!hasTty()) return false;
	return true;
}

function resolveOpenExternalLinksMode(): OpenExternalLinksMode {
	const cliConfigMode = resolveCliOpenExternalLinksMode();
	if (cliConfigMode) return cliConfigMode.value;

	try {
		const config = loadConfig() as RefarmOpenLinkConfig;
		const configured = config.operator?.openExternalLinks;
		if (configured === false) return "never";
		if (configured === true) return "auto";
		return parseOpenExternalLinksMode(configured) ?? "auto";
	} catch {
		return "auto";
	}
}
