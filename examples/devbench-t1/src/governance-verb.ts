import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";

import { runGovernancePoc } from "./governance-poc.js";

/**
 * `governance-poc [--apply]` — run the extensibility-as-risk-decision PoC and report the verifiable
 * artifacts + metrics. This is the FORCING FUNCTION for the T1 writeup: it runs the 2 policy modes
 * × 3 extension behaviours (6 combinations), and produces the policy decisions, sandbox reports,
 * runtime evidence, operational metrics, and the scorecard the writeup cites — so the technical
 * viability is shown from data, not asserted. `--apply` writes the artifacts to disk (a caller
 * injects the writer); without it the verb reports them in the envelope.
 *
 * A LOCAL, SYNTHETIC, self-contained proof — no real/sensitive data, no institutional deployment
 * claimed. It demonstrates viability for an incremental pilot with objective promotion criteria.
 */
export interface GovernanceVerbOptions {
	/** Persist an artifact file (injected by the CLI — a node fs writer). Absent → report-only. */
	writeArtifact?: (relativePath: string, json: string) => void | Promise<void>;
}

export function createGovernancePocCapability(options: GovernanceVerbOptions = {}): CapabilityDescriptor {
	return {
		name: "governance-poc",
		summary: "Run the extensibility-as-risk-decision PoC (policy modes × extensions → artifacts + scorecard)",
		options: [{ name: "apply", kind: "boolean", summary: "Write the artifacts to disk (else report only)" }],
		transports: { http: { path: "/governance/poc" } },
		renderers: { tui: { section: "governance" }, web: { route: "/governance", icon: "shield" }, ide: { command: "dgk.governance-poc" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const result = runGovernancePoc();
			const apply = input.options?.apply === true;

			// The verifiable artifacts the writeup cites, one file per (extension × mode) plus the
			// aggregate scorecard + metrics.
			const artifacts: Array<{ path: string; json: string }> = [];
			for (const c of result.combinations) {
				const stem = `.dgk/governance/${c.extension}.${c.mode}`;
				artifacts.push({ path: `${stem}.policy-decision.json`, json: JSON.stringify(c.policy, null, 2) });
				artifacts.push({ path: `${stem}.sandbox-report.json`, json: JSON.stringify(c.sandbox, null, 2) });
				artifacts.push({ path: `${stem}.runtime-evidence.json`, json: JSON.stringify(c.evidence, null, 2) });
			}
			artifacts.push({ path: ".dgk/governance/scorecard.json", json: JSON.stringify(result.scorecard, null, 2) });
			artifacts.push({ path: ".dgk/governance/metrics.json", json: JSON.stringify(result.metrics, null, 2) });

			let written = 0;
			if (apply && options.writeArtifact) {
				for (const a of artifacts) {
					await options.writeArtifact(a.path, a.json);
					written += 1;
				}
			}

			return buildJsonSuccessEnvelope({
				command: "governance-poc",
				operation: "governance-poc",
				nextCommand: "dgk extension",
				nextCommands: ["dgk extension"],
				extra: {
					combinations: result.combinations.map((c) => ({ extension: c.extension, mode: c.mode, outcome: c.outcome })),
					metrics: result.metrics,
					scorecard: result.scorecard,
					artifactsWritten: written,
					artifactCount: artifacts.length,
					disclaimer: "PoC local, sintética e autocontida — sem dados institucionais sensíveis; viabilidade para piloto incremental, não implantação.",
				},
			});
		},
	};
}
