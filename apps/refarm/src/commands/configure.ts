import { setGitHubActionsSecret } from "@refarm.dev/cli/github-actions";
import { SiloCore } from "@refarm.dev/silo";
import chalk from "chalk";
import { Command } from "commander";
import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/cli/json-output";

const CONFIGURE_SCHEMA_VERSION = 1;
const MISSING_GITHUB_CREDENTIALS_COMMAND = refarmCommand([
	"sow",
	"--github",
	"--json",
]);
const GH_AUTH_STATUS_COMMAND = "gh auth status";

interface ConfigureGithubOptions {
	json?: boolean;
}

interface ConfigureMapping {
	secretName: string;
	sourceKey: string;
	label: string;
}

const GITHUB_CONFIGURATION_SECRETS: ConfigureMapping[] = [
	{
		secretName: "GITHUB_TOKEN",
		sourceKey: "githubToken",
		label: "GitHub token",
	},
	{
		secretName: "GH_TOKEN",
		sourceKey: "githubToken",
		label: "GitHub token alias",
	},
	{
		secretName: "CLOUDFLARE_API_TOKEN",
		sourceKey: "cloudflareToken",
		label: "Cloudflare API token",
	},
];

function normalizeToken(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function buildMissingCredentialPayload() {
	return buildJsonErrorEnvelope({
		command: "configure",
		operation: "github",
		error: "missing-credentials",
		message: "No credentials found in silo for GitHub configuration.",
		nextAction: MISSING_GITHUB_CREDENTIALS_COMMAND,
		nextActions: [MISSING_GITHUB_CREDENTIALS_COMMAND],
		nextCommand: MISSING_GITHUB_CREDENTIALS_COMMAND,
		nextCommands: [MISSING_GITHUB_CREDENTIALS_COMMAND],
		extra: {
			schemaVersion: CONFIGURE_SCHEMA_VERSION,
			target: "github",
			sources: GITHUB_CONFIGURATION_SECRETS.map((m) => m.secretName),
		},
	});
}

function buildWriteFailurePayload(input: { error: string; message: string }) {
	return buildJsonErrorEnvelope({
		command: "configure",
		operation: "github",
		error: input.error,
		message: input.message,
		nextAction: GH_AUTH_STATUS_COMMAND,
		nextActions: [GH_AUTH_STATUS_COMMAND],
		nextCommand: GH_AUTH_STATUS_COMMAND,
		nextCommands: [GH_AUTH_STATUS_COMMAND],
		extra: {
			schemaVersion: CONFIGURE_SCHEMA_VERSION,
			target: "github",
		},
	});
}

function buildGithubSuccessPayload(input: {
	written: Array<{ secret: string; source: string }>;
	skipped: string[];
}) {
	const nextAction = "gh secret list";
	const nextCommands = [nextAction];
	return buildJsonSuccessEnvelope({
		command: "configure",
		operation: "github",
		nextAction,
		nextCommands,
		extra: {
			schemaVersion: CONFIGURE_SCHEMA_VERSION,
			target: "github",
			written: input.written,
			skipped: input.skipped,
		},
	});
}

function renderMissingCredentialMessage() {
	console.error(chalk.red("No credentials found in silo for GitHub sync."));
	console.error(
		chalk.dim("Run "),
		chalk.cyan("refarm sow --github"),
		chalk.dim(" to store GitHub / Cloudflare credentials."),
	);
}

export const configureCommand = new Command("configure")
	.description(
		"Sync saved silo credentials to deployment targets (operational config, not runtime CLI config)",
	)
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm configure github",
			"  $ refarm configure github --json",
			"",
			"Notes:",
			"  Reads credentials from ~/.refarm/identity.json and writes known secrets via `gh secret set`.",
			"  Requires GitHub CLI authentication for the active repository context.",
		].join("\n"),
	)
	.addCommand(
		new Command("github")
			.description("Sync credentials from Silo to GitHub Actions secrets")
			.option("--json", "Output machine-readable configure result")
			.action(async (opts: ConfigureGithubOptions) => {
				const shouldJson = opts.json === true;
				const silo = new SiloCore();
				const tokens = (await silo.loadTokens()) as Record<string, unknown>;

				const candidates = GITHUB_CONFIGURATION_SECRETS.map((mapping) => ({
					...mapping,
					value: normalizeToken(tokens[mapping.sourceKey]),
				}));
				const writable = candidates.filter((candidate) =>
					Boolean(candidate.value),
				);
				const skipped = candidates
					.filter((candidate) => !candidate.value)
					.map((candidate) => candidate.label);

				if (writable.length === 0) {
					if (shouldJson) {
						printJson(buildMissingCredentialPayload());
						process.exitCode = 1;
						return;
					}
					renderMissingCredentialMessage();
					process.exitCode = 1;
					return;
				}

				const written: Array<{ secret: string; source: string }> = [];
				const seen = new Set<string>();
				for (const candidate of writable) {
					if (seen.has(candidate.secretName)) {
						continue;
					}
					try {
						setGitHubActionsSecret(
							candidate.secretName,
							candidate.value as string,
						);
						written.push({
							secret: candidate.secretName,
							source: candidate.label,
						});
						seen.add(candidate.secretName);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						if (shouldJson) {
							printJson(
								buildWriteFailurePayload({
									error: "github-secret-write-failed",
									message,
								}),
							);
							process.exitCode = 1;
							return;
						}
						console.error(
							chalk.red(
								`\nFailed to write GitHub secret ${candidate.secretName}: ${message}`,
							),
						);
						process.exitCode = 1;
						return;
					}
				}

				if (shouldJson) {
					printJson(
						buildGithubSuccessPayload({
							written,
							skipped,
						}),
					);
					return;
				}

				if (written.length > 0) {
					console.log(chalk.green("\n✓ Wrote GitHub Actions secrets:"));
					for (const item of written) {
						console.log(chalk.green(`  - ${item.secret}`));
					}
					if (skipped.length > 0) {
						console.log(chalk.yellow("\nSkipped (missing in Silo):"));
						for (const missing of skipped) {
							console.log(chalk.yellow(`  - ${missing}`));
						}
					}
					console.log(chalk.dim("\nNext: gh secret list"));
				}
			}),
	);
