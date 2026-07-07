import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
	CapabilityInput,
} from "@refarm.dev/cli/capabilities";

import { type CapabilitySurfaceHooks } from "./capability-commander.js";
import { buildDiagnosticNextActionPayload } from "./diagnostic-recommendations.js";
import {
	applySuggestedHealthPolicy,
	type HealthPolicyApplicationReport,
	type HealthPolicySuggestionReport,
	type HealthReport,
	runHealthAudit,
	runHealthPolicySuggestion,
} from "./health.js";
import {
	formatHealthPolicyApplicationSummary,
	formatHealthPolicySuggestionSummary,
	formatHealthPolicySummary,
	formatHealthSummary,
} from "./health-output.js";
import {
	type HealthPolicyReport,
	resolveHealthPolicyReport,
} from "./health-policy.js";

/**
 * `health` as a CapabilityGroup — the tri-surface (CLI + REPL slash + HTTP)
 * projection of the deterministic project audit, replacing the hand-written
 * commander Command.
 *
 * The former state machine is decomposed into HONEST sub-actions instead of a
 * flag switch with a 3-way mutual-exclusion guard:
 *   - audit (default) — carries the output-modifier options.
 *   - policy / suggest-policy / apply-policy — the three policy modes, now
 *     structurally exclusive (you cannot pass two sub-verbs), so the guard is
 *     gone.
 * Each action delegates to its existing exported function; the envelope those
 * functions return is unchanged, so the JSON contract is byte-stable.
 */
export function createHealthCapabilityGroup(): CapabilityGroup {
	const audit: CapabilityDescriptor = {
		name: "audit",
		summary: "Run deterministic project diagnostics",
		options: [
			{
				name: "next-action",
				kind: "boolean",
				summary: "Print only the first blocking recovery action",
			},
			{
				name: "next-command",
				kind: "boolean",
				summary: "Print only the first executable recovery command",
			},
		],
		async run(input): Promise<CapabilityEnvelope> {
			const report = await runHealthAudit();
			// Reduced payload for --next-action / --next-command: the SAME shape the
			// legacy emitHealthNextActionJson produced. It carries `ok`, so the
			// projector's default exitCode (ok===false → 1) still fires — which is
			// exactly the honest signal a diagnostic command should give the shell.
			if (input.options["next-action"] || input.options["next-command"]) {
				return buildDiagnosticNextActionPayload({
					ok: report.ok,
					nextActions: report.nextActions,
					nextCommands: report.nextCommands,
				}) as unknown as CapabilityEnvelope;
			}
			return report as unknown as CapabilityEnvelope;
		},
	};

	const policy: CapabilityDescriptor = {
		name: "policy",
		summary: "Print the resolved health policy and exit",
		run(): CapabilityEnvelope {
			return resolveHealthPolicyReport() as unknown as CapabilityEnvelope;
		},
	};

	const suggestPolicy: CapabilityDescriptor = {
		name: "suggest-policy",
		summary: "Suggest a reviewed health policy from current diagnostics",
		async run(): Promise<CapabilityEnvelope> {
			return (await runHealthPolicySuggestion()) as unknown as CapabilityEnvelope;
		},
	};

	const applyPolicy: CapabilityDescriptor = {
		name: "apply-policy",
		summary: "Apply the suggested health policy to .refarm/config.json",
		async run(): Promise<CapabilityEnvelope> {
			return (await applySuggestedHealthPolicy()) as unknown as CapabilityEnvelope;
		},
	};

	return {
		name: "health",
		summary: "Run deterministic diagnostics on the project",
		actions: {
			audit,
			policy,
			"suggest-policy": suggestPolicy,
			"apply-policy": applyPolicy,
		},
		defaultAction: "audit",
		transports: {
			cli: {},
			repl: {},
			// apply-policy mutates .refarm/config.json, so the group is POST-shaped.
			http: { method: "POST", path: "/health" },
			// The default action (`audit`) is read-only diagnostics — a safe agent
			// tool: it widens REACH (the agent can self-diagnose the project) without
			// POWER (no mutation). The web-surface agent projector reads this.
			agent: { tool: true, toolName: "health_audit" },
		},
		renderers: { tui: { section: "diagnostics" } },
	};
}

/**
 * Per-sub-action surface hooks: each renders the human summary the legacy command
 * printed, from the envelope, via the pure format* helpers. Exit intent is left
 * to the projector default (ok===false → 1) — the envelope's own `ok` is the
 * honest signal, so no custom exitCode hook is needed.
 */
export function healthCapabilityHooks(subVerb: string): CapabilitySurfaceHooks {
	switch (subVerb) {
		case "audit":
			return {
				renderText: (envelope, input?: CapabilityInput) => {
					// Reduced-payload path: audit.run returned {ok, nextAction(s),
					// nextCommand(s)} only. Print the single line, as the legacy
					// console.log(report.nextCommands[0] / nextActions[0]) did.
					if (input?.options["next-command"]) {
						const e = envelope as unknown as { nextCommands: string[] };
						return e.nextCommands[0] ?? "";
					}
					if (input?.options["next-action"]) {
						const e = envelope as unknown as { nextActions: string[] };
						return e.nextActions[0] ?? "";
					}
					return formatHealthSummary(envelope as unknown as HealthReport);
				},
			};
		case "policy":
			return {
				renderText: (envelope) =>
					formatHealthPolicySummary(
						envelope as unknown as HealthPolicyReport,
					),
			};
		case "suggest-policy":
			return {
				renderText: (envelope) =>
					formatHealthPolicySuggestionSummary(
						envelope as unknown as HealthPolicySuggestionReport,
					),
			};
		case "apply-policy":
			return {
				renderText: (envelope) =>
					formatHealthPolicyApplicationSummary(
						envelope as unknown as HealthPolicyApplicationReport,
					),
			};
		default:
			return {};
	}
}
