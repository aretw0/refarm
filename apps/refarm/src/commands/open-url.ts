import {
	openHostBrowserUrl,
	resolveBrowserOpenCandidates,
	type BrowserOpenResult,
} from "@refarm.dev/cli/browser-open";
import { Command } from "commander";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
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
	json?: boolean;
}

const OPEN_URL_SCHEMA_VERSION = 1;

function openUrlCommandLine(url: string, flags: string[] = []): string {
	return ["refarm", "open-url", JSON.stringify(url), ...flags].join(" ");
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
		.option("--json", "Output machine-readable opener result")
		.addHelpText(
			"after",
			`
Examples:
  $ refarm open-url https://platform.openai.com/auth
  $ refarm open-url https://dash.cloudflare.com --dry-run
  $ refarm open-url https://dash.cloudflare.com --dry-run --json
  $ REFARM_BROWSER_OPEN_COMMAND="custom-open --flag" refarm open-url https://example.test
  $ refarm config set operator.openExternalLinks never

Notes:
  Used by auth and provisioning flows to hand official links from a devcontainer to the host browser.
  --dry-run prints the available opener candidates and does not open a browser.
  REFARM_BROWSER_OPEN_COMMAND appends the URL to an explicit opener command.
  Set operator.openExternalLinks=never to keep flows headless and print URLs instead.
`,
		)
		.action(async (url: string, options: OpenUrlOptions) => {
			if (options.dryRun) {
				const candidates = resolveBrowserOpenCandidates(url);
				if (options.json) {
					const nextAction = candidates.length > 0
						? `refarm open-url ${url}`
						: `open manually: ${url}`;
					const nextCommand = candidates.length > 0
						? openUrlCommandLine(url)
						: openUrlCommandLine(url, ["--dry-run", "--json"]);
					printJson(
						buildJsonSuccessEnvelope({
							command: "open-url",
							operation: "dry-run",
							nextAction,
							nextCommand,
							nextCommands: [nextCommand],
							extra: {
								schemaVersion: OPEN_URL_SCHEMA_VERSION,
								url,
								dryRun: true,
								candidates,
							},
						}),
					);
					return;
				}
				console.log(openDryRunMessage(url));
				for (const candidate of candidates) {
					console.log(`candidate: ${candidate.display}`);
				}
				return;
			}

			if (!options.json) {
				console.log(openStartMessage(url));
			}
			try {
				const result = await resolvedDeps.open(url);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "open-url",
							operation: "open",
							extra: {
								schemaVersion: OPEN_URL_SCHEMA_VERSION,
								url,
								dryRun: false,
								result,
							},
						}),
					);
					return;
				}
				console.log(`Opened via: ${result.candidate.display}`);
			} catch (error) {
				process.exitCode = 1;
				if (options.json) {
					const message = error instanceof Error ? error.message : String(error);
					printJson(
						buildJsonErrorEnvelope({
							command: "open-url",
							operation: "open",
							error: "open-url-failed",
							message,
							nextAction: `open manually: ${url}`,
							nextCommand: openUrlCommandLine(url, ["--dry-run", "--json"]),
							extra: {
								schemaVersion: OPEN_URL_SCHEMA_VERSION,
								url,
								dryRun: false,
							},
						}),
					);
					return;
				}
				console.error(openFailureMessage(error));
				console.error(`Open this URL manually: ${url}`);
			}
		});
}

export const openUrlCommand = createOpenUrlCommand();
