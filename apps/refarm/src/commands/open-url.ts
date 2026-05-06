import { Command } from "commander";
import {
	openHostBrowserUrl,
	resolveBrowserOpenCandidates,
	type BrowserOpenResult,
} from "./browser-open.js";
import {
	openDryRunMessage,
	openFailureMessage,
	openStartMessage,
} from "./launch-feedback.js";

export interface OpenUrlDeps {
	open(url: string): Promise<BrowserOpenResult>;
}

interface OpenUrlOptions {
	dryRun?: boolean;
}

export function createOpenUrlCommand(deps?: Partial<OpenUrlDeps>): Command {
	const resolvedDeps: OpenUrlDeps = {
		open: (url) => openHostBrowserUrl(url),
		...deps,
	};

	return new Command("open-url")
		.description(
			"Open a URL in the host browser with devcontainer-aware fallbacks",
		)
		.argument("<url>", "URL to open")
		.option("--dry-run", "Print opener candidates without executing them")
		.action(async (url: string, options: OpenUrlOptions) => {
			if (options.dryRun) {
				console.log(openDryRunMessage(url));
				for (const candidate of resolveBrowserOpenCandidates(url)) {
					console.log(`candidate: ${candidate.display}`);
				}
				return;
			}

			console.log(openStartMessage(url));
			try {
				const result = await resolvedDeps.open(url);
				console.log(`Opened via: ${result.candidate.display}`);
			} catch (error) {
				process.exitCode = 1;
				console.error(openFailureMessage(error));
				console.error(`Open this URL manually: ${url}`);
			}
		});
}

export const openUrlCommand = createOpenUrlCommand();
