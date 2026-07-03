import type {
	CapabilityDescriptor,
	CapabilityInput,
} from "@refarm.dev/cli/capabilities";
import { buildJsonErrorEnvelope } from "@refarm.dev/cli/json-output";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildExtensionReviewReport,
	type ExtensionReviewReport,
} from "./extension.js";

function parsePolicyMode(value: unknown): "fail-fast" | "warn+continue" {
	if (value === undefined || value === "fail-fast") return "fail-fast";
	if (value === "warn+continue") return "warn+continue";
	throw new Error("--policy must be fail-fast or warn+continue");
}

/**
 * The `extension review` capability, declared once. Its run() is pure over the
 * shared buildExtensionReviewReport builder — it returns an envelope and never
 * touches process.* or the model — so the same descriptor drives the CLI
 * subcommand and the REPL `/review` slash. Exit intent and text rendering live
 * in the surface hooks, not in run().
 */
export const extensionReviewCapability: CapabilityDescriptor = {
	name: "review",
	group: "extension",
	summary:
		"Review a prepared extension against a capability grant (review-first; installs nothing)",
	args: [{ name: "path", required: true }],
	options: [
		{
			name: "grant",
			kind: "string[]",
			summary:
				"Grant a capability for this review (repeatable); default grants none",
		},
		{
			name: "policy",
			kind: "string",
			summary: "Policy mode: fail-fast or warn+continue",
			defaultValue: "fail-fast",
		},
	],
	run(input: CapabilityInput) {
		const targetPath = input.args.path as string;
		try {
			return buildExtensionReviewReport({
				targetPath,
				grantedCapabilities: (input.options.grant as string[]) ?? [],
				policyMode: parsePolicyMode(input.options.policy),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return buildJsonErrorEnvelope({
				command: "extension",
				operation: "review",
				error: "extension_review_failed",
				message,
				nextAction:
					"Run `refarm extension review --help`; point at a prepared extension directory or manifest.",
			});
		}
	},
};

/** CLI surface hooks: human text + exit intent for `extension review`. */
export const extensionReviewHooks: CapabilitySurfaceHooks = {
	renderText(envelope) {
		if (envelope.ok === false) {
			return `Extension review failed: ${(envelope as { message?: string }).message ?? "unknown error"}`;
		}
		const report = envelope as ExtensionReviewReport;
		const { decision, deniedCapabilities, readyToInstall } = report;
		const lines = [
			`Extension review: ${decision.pluginId ?? "unknown"} — ${decision.status} (policy: ${decision.policyMode})`,
		];
		if (!decision.manifestValid) {
			for (const err of decision.manifestErrors) {
				lines.push(`  manifest error: ${err}`);
			}
		}
		if (deniedCapabilities.length > 0) {
			lines.push(
				`  denied capabilities (not granted): ${deniedCapabilities.join(", ")}`,
			);
		}
		lines.push(
			`  ready to install: ${readyToInstall ? "yes" : "no — review required"}`,
		);
		return lines.join("\n");
	},
	exitCode(envelope) {
		if (envelope.ok === false) return 1;
		return (envelope as ExtensionReviewReport).readyToInstall ? 0 : 1;
	},
};
