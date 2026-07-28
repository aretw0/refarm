/**
 * `rcdc5-enrich` — rcdc5's enrichment as a capability the refarm runtime DRIVES.
 *
 * rcdc5-enrichment.ts proved rcdc5's real rules run byte-identically on the shared
 * enrichment:v1 engine (parity gate). This is the operate half: a `CapabilityDescriptor` that
 * a capability-host mounts, so `dispatchCapability(this, tokens)` resolves → validates → runs it
 * exactly as the CLI / HTTP / TUI faces do. The verb never re-implements dispatch, arg parsing,
 * validation, or surface projection — the runtime carries all of it; the example is just its
 * decision.
 *
 * Split of responsibility (the sovereign boundary, operationally): refarm decides WHICH tags
 * (this verb, over the generic engine); writing them back into rcdc5's markdown on disk stays
 * rcdc5's storage-substrate job. So this verb reports the decisions (dry-run by default); an
 * `--apply` labels the run as authoritative for a downstream writer to act on.
 */

import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import { enrichRcdc5Artifacts } from "./rcdc5-enrichment.js";

export interface Rcdc5Artifact {
	id: string;
	markdown: string;
}

export interface Rcdc5EnrichCapabilityDeps {
	/**
	 * Load the rcdc5 markdown artifacts to enrich. Injected so the verb is pure and testable and
	 * so rcdc5's actual storage substrate (walking a vault dir) stays outside the generic surface.
	 */
	loadArtifacts: () => ReadonlyArray<Rcdc5Artifact> | Promise<ReadonlyArray<Rcdc5Artifact>>;
}

/** One enriched artifact in the envelope: which tags it now carries + which rule fired. */
interface TaggedArtifact {
	id: string;
	tags: string[];
	ruleId?: string;
}

export function createRcdc5EnrichCapability(deps: Rcdc5EnrichCapabilityDeps): CapabilityDescriptor {
	return {
		name: "rcdc5-enrich",
		summary: "Tag rcdc5 requirements via rcdc5's rules on the shared enrichment:v1 engine",
		options: [
			{
				name: "apply",
				kind: "boolean",
				summary: "Report only by default; --apply labels the decisions as an authoritative run",
			},
		],
		transports: { http: { path: "/rcdc5/enrich" } },
		renderers: { tui: { section: "rcdc5" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const apply = input.options.apply === true;
			const artifacts = await deps.loadArtifacts();
			const result = await enrichRcdc5Artifacts(artifacts, { mode: apply ? "apply" : "dry-run" });
			// One row per artifact that gained tags: the resulting tag list + the rule(s) that fired.
			const tagged: TaggedArtifact[] = result.records
				.filter((record) => record.changes.length > 0)
				.map((record) => {
					const change = record.changes[0];
					return {
						id: record.id,
						tags: (change?.after as string[] | undefined) ?? [],
						...(change?.provenance.ruleId ? { ruleId: change.provenance.ruleId } : {}),
					};
				});
			return buildJsonSuccessEnvelope({
				command: "rcdc5-enrich",
				operation: "enrich",
				extra: {
					mode: result.mode,
					total: result.diagnostics.total,
					enriched: result.diagnostics.enriched,
					skipped: result.diagnostics.skipped,
					tagged,
				},
			});
		},
	};
}
