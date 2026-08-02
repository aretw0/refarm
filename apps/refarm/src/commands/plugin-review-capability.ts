import type { CapabilityDescriptor, CapabilityInput } from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import {
	decidePluginPolicy,
	type PluginPolicyDecision,
	type PluginPolicyMode,
} from "@refarm.dev/plugin-manifest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";

const REVIEW_MANIFEST_FILENAMES = ["plugin.json", "ext.json"] as const;

/**
 * Resolve a reviewable plugin manifest from a path. Accepts a manifest file
 * directly, or a directory containing plugin.json / ext.json (a prepared
 * extension the persona points at). Throws with an operator-facing message when
 * nothing is found.
 */
export function loadReviewableManifest(targetPath: string): {
	manifest: unknown;
	manifestPath: string;
} {
	if (!existsSync(targetPath)) {
		throw new Error(`No such path: ${targetPath}`);
	}
	const candidates = targetPath.endsWith(".json")
		? [targetPath]
		: REVIEW_MANIFEST_FILENAMES.map((name) => path.join(targetPath, name));
	const manifestPath = candidates.find((candidate) => existsSync(candidate));
	if (!manifestPath) {
		throw new Error(
			`No plugin.json or ext.json found at ${targetPath}. Point --at a prepared extension directory or manifest file.`,
		);
	}
	try {
		return {
			manifest: JSON.parse(readFileSync(manifestPath, "utf-8")),
			manifestPath,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not parse ${manifestPath}: ${message}`);
	}
}

export interface ExtensionReviewInput {
	targetPath: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
	/** Connection names declared by this host. Omit only for host-agnostic analysis. */
	availableConnections?: string[];
	/**
	 * The command verb this review is projected under — stamped into the envelope's
	 * `command` field and the install handoff. Defaults to `"extension"` so the
	 * legacy `extension review` call-site is byte-identical; `plugin review`
	 * (ADR-086) passes `"plugin"` so the envelope names the verb the operator used.
	 */
	commandName?: string;
}

export type ExtensionReviewReport = JsonSuccessEnvelope<{
	manifestPath: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
	decision: PluginPolicyDecision;
	readyToInstall: boolean;
	deniedCapabilities: string[];
	missingConnections: string[];
}>;

/**
 * Review a prepared extension against a capability grant: run the shared,
 * host-agnostic decidePluginPolicy over the manifest and report whether it is
 * ready to install. Grants are operator-supplied; nothing is installed here.
 */
export function buildExtensionReviewReport(input: ExtensionReviewInput): ExtensionReviewReport {
	const { manifest, manifestPath } = loadReviewableManifest(input.targetPath);
	const decision = decidePluginPolicy(manifest as never, {
		grantedCapabilities: input.grantedCapabilities,
		policyMode: input.policyMode,
		...(input.availableConnections ? { availableConnections: input.availableConnections } : {}),
	});
	const readyToInstall = decision.status === "completed" && decision.manifestValid;
	// The handoff points at installing WHAT WAS REVIEWED (this path, with the same
	// grants), not the bundled set — the review→install loop is closed. When a grant
	// is still missing, the next step is to re-review with it granted. The verb
	// (extension|plugin) is caller-supplied so the handoff names the surface used.
	const commandName = input.commandName ?? "extension";
	const grantFlags = input.grantedCapabilities.map((cap) => `--grant ${cap}`).join(" ");
	const installHandoff = `${commandName} install ${manifestPath}${grantFlags ? ` ${grantFlags}` : ""}`;
	return buildJsonSuccessEnvelope({
		command: commandName,
		operation: "review",
		nextCommands: readyToInstall ? [installHandoff, "resume --json"] : [],
		extra: {
			manifestPath,
			grantedCapabilities: input.grantedCapabilities,
			policyMode: input.policyMode,
			decision,
			readyToInstall,
			deniedCapabilities: decision.missingCapabilities,
			missingConnections: decision.missingConnections,
		},
	});
}

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
	transports: { cli: { group: "extension" } },
	summary:
		"Review a prepared extension against a capability grant (review-first; installs nothing)",
	args: [{ name: "path", required: true }],
	options: [
		{
			name: "grant",
			kind: "string[]",
			summary: "Grant a capability for this review (repeatable); default grants none",
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
			lines.push(`  denied capabilities (not granted): ${deniedCapabilities.join(", ")}`);
		}
		if (report.missingConnections.length > 0) {
			lines.push(`  missing declared connections: ${report.missingConnections.join(", ")}`);
		}
		lines.push(`  ready to install: ${readyToInstall ? "yes" : "no — review required"}`);
		return lines.join("\n");
	},
	exitCode(envelope) {
		if (envelope.ok === false) return 1;
		return (envelope as ExtensionReviewReport).readyToInstall ? 0 : 1;
	},
};
