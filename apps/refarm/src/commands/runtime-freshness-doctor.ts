// Runtime-freshness doctor finding — the node answering you was built before the fixes you
// just made, and until now nothing said so.
//
// Measured on the operator's own machine, 2026-08-04: the tractor daemon started at 11:20
// and the binary beside it was rebuilt at 20:34. Nine hours of repairs — the elapsed_ms
// fix, the rate-catalog injection, the override refusal — landing in a file the running
// process would never read, while `refarm check --next-action --json` answered
// `ok: true, nextAction: null` and mentioned neither stale, nor restart, nor build.
//
// That is Shape 1 from this repo's own instrument design (an instrument reporting success
// it did not earn) in the command CLAUDE.md tells every agent to run FIRST, about the
// process the operator uses every day. The operator's question that evening was whether he
// could use refarm as his agent sovereignly. He already was — `refarm ask` answered through
// his own node and his own subscription. What he could not do was tell that the thing
// answering was the morning's build. A repair that silently stops reaching you is worse
// than no repair, because you lose the ability to tell the two apart.
//
// This is a courtesy TELL of the same shape as `node-name-doctor.ts` and `scope-doctor.ts`:
// unprompted, never a write, never a restart performed on the operator's behalf. Restarting
// a node is an operator decision — it interrupts whatever that node is serving — so this
// states the fact and names the command, and stops there.
//
// THREE STATES, and the third is the reason this module is worth its own file. A verifier
// that cannot check must say so rather than pass: an absent descriptor, a dead pid, an
// artifact that cannot be found, or a platform where a running binary cannot be resolved
// are all `unknown`, and `unknown` is REPORTED, not rounded down to fine. That distinction
// is what `resolveRuntimeFreshness` computes; this module only phrases it.
//
// Pure over an already-resolved freshness result, exactly like its sibling findings — the
// caller does the filesystem work, so every test drives this with a literal.

import type { ArtifactFreshness, RuntimeFreshness } from "../utils/runtime-freshness.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

function describe(artifact: ArtifactFreshness): string {
	const when = artifact.modifiedAt ? `, changed ${artifact.modifiedAt}` : "";
	return `${artifact.artifact} (${artifact.reason}${when})`;
}

/**
 * Build the `refarm doctor` finding for a node running older artifacts than the ones on
 * disk. Pure — the caller resolves freshness (see `../utils/runtime-freshness.ts`).
 *
 * No finding fires when every artifact is `fresh`: a node running exactly what is on disk
 * is the ordinary case and deserves silence, the same rule `node-name-doctor.ts` follows
 * for a node that already declared a name.
 */
export function buildRuntimeFreshnessDoctorRecommendations(
	freshness: RuntimeFreshness | null,
): RefarmDoctorRecommendation[] {
	if (!freshness) return [];
	if (freshness.state === "fresh") return [];

	if (freshness.state === "stale") {
		const stale = freshness.artifacts.filter((a) => a.state === "stale");
		const started = freshness.startedAt ? ` It started ${freshness.startedAt}.` : "";
		return [
			{
				diagnostic: "runtime:stale",
				severity: "warning",
				summary:
					"The running node predates artifacts on disk, so work you dispatch is being " +
					`served by an older build than the one beside it.${started} Stale: ` +
					stale.map(describe).join("; ") +
					". Nothing is broken — the node answers correctly for the version it is running " +
					"— but fixes made since it started are not reaching it.",
				action:
					"Restart the node to pick them up. This is deliberately NOT done for you: a " +
					"restart interrupts whatever that node is currently serving, which is the " +
					"operator's call and not a diagnostic's.",
			},
		];
	}

	const unknown = freshness.artifacts.filter((a) => a.state === "unknown");
	return [
		{
			diagnostic: "runtime:freshness-unknown",
			severity: "warning",
			summary:
				"Whether the running node is up to date could not be established: " +
				unknown.map(describe).join("; ") +
				". This is a gap in the checking, not a finding about the node — it may be current " +
				"or it may be hours behind, and this cannot tell you which.",
			action:
				"Treat it as unverified rather than fine. If the node is not running, start it; if " +
				"it is running and this still cannot see its binary, the artifacts moved or this " +
				"platform does not expose them, and the check needs widening rather than trusting.",
		},
	];
}
