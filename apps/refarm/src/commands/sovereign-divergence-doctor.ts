// Sovereign-divergence doctor finding — the plugin-hash mismatch `refarm context` can
// already prove, surfaced in `refarm doctor` — the command this repo's own CLAUDE.md
// tells every agent to run FIRST — which could not see it until this file existed.
//
// Measured on the operator's own machine, 2026-08-05: the running node loads a plugin
// hashing to `22dbabbd…` while a fresh build of the same plugin produces `544ef5b4…`.
// `refarm context` said so the moment Task 3 shipped. `refarm doctor` answered `ok` with
// zero findings about it, because nothing fed that comparison into the command every
// agent is told to run first — the exact silence this file exists to end.
//
// CONSUMES AN ALREADY-RESOLVED LIST. `divergences` is `ContextReport.divergences`
// (`./context.ts`) — every filesystem and process read already happened in
// `resolveContextInput`. This module does none of that itself, exactly like
// `buildRuntimeFreshnessDoctorRecommendations` over `RuntimeFreshness`.
//
// ONE FINDING PER FACT, NOT TWO NAMES FOR ONE. A divergence of kind
// `CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC` (`context:home-divergence`) is `context-doctor.ts`'s
// finding already — reporting it again here under a second pass would be the exact mistake
// `context.ts`'s own header warns against, just moved one file over. It is filtered out,
// not re-announced.
//
// THREE STATES, NEVER TWO. `plugin-hash-unknown` and `built-plugin-unknown` are a GAP in
// the checking — a hash could not be read, or there was nothing built to compare against —
// not a mismatch. Phrasing either as "diverged" would claim a disagreement nothing actually
// established, so they get their own diagnostic (`sovereign:plugin-unknown`), worded as
// unverified rather than wrong. This is the same distinction
// `buildRuntimeFreshnessDoctorRecommendations` draws for its own `unknown` state, applied to
// the other comparison.
//
// D2 IS NOT ONLY THE PLUGIN HASH. The governing design doc
// (`docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md`) commits
// BOTH `refarm context` and `refarm doctor` to report "a sovereign directory exists at a
// path nothing loads" — the exact fact pattern of the incident this whole plan answers
// (four sovereign-dir locations, two stale and loaded by nothing, doctor clean the whole
// time). `unloaded-sovereign-dir` gets its own diagnostic (`sovereign:unloaded-dir`) here,
// phrased as what it is: confusing, not broken. The operator may be keeping an old
// directory deliberately; this never implies the node is misbehaving and never decides for
// them.
//
// A node simply not running (`node-not-running`) is read here from the same list but is
// not turned into a `refarm doctor` recommendation. `runtime:not-ready`
// (`STATUS_DIAGNOSTICS.runtimeNotReady`, wired in `doctor.ts` from the status contract)
// already answers "is the runtime up and ready" for the operator-facing question that
// matters — reporting `node-not-running` too would be a second name for the same "the node
// is not up" fact in the case both actually co-occur, the exact double-naming this plan
// exists to end for `context:home-divergence`, just on a different pair of findings.
// (Checked, not assumed: the two signals are technically independent — `runtime:not-ready`
// is a sidecar HTTP probe, `node-not-running` here is a `node.json`/pid read — so a node
// with a stale/absent descriptor but a reachable sidecar, or vice versa, is a real gap this
// silence does not cover. `node-name-doctor.ts` and `runtime-freshness-doctor.ts` already
// make the identical silence call for a `null` descriptor, for the same reason, so this
// follows established precedent rather than inventing a new one.)
//
// NEVER RESTARTS, NEVER WRITES. Same posture as `context.ts` itself and as
// `runtime-freshness-doctor.ts` before it: this states the fact and names the command an
// operator could choose to run, and stops there. No `action` here performs anything on the
// operator's behalf.
//
// SILENCE WHEN THERE IS NOTHING TO SAY. An empty `divergences` list — the ordinary case for
// a node running exactly what a fresh build produces — yields no recommendation at all, the
// same rule every other doctor finding in this codebase follows.

import { CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC } from "./context-doctor.js";
import type { Divergence } from "./context.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

/**
 * Build the `refarm doctor` findings for the sovereign-state divergences `refarm context`
 * already resolves. PURE — every divergence here was already computed by
 * `buildContextReport` (`./context.ts`); this only decides which ones become a doctor
 * recommendation and how each is phrased.
 */
export function buildSovereignDivergenceDoctorRecommendations(
	divergences: Divergence[],
): RefarmDoctorRecommendation[] {
	const recommendations: RefarmDoctorRecommendation[] = [];

	for (const divergence of divergences) {
		switch (divergence.kind) {
			case "plugin-hash-mismatch":
				recommendations.push({
					diagnostic: "sovereign:plugin-divergence",
					severity: "warning",
					summary: divergence.summary,
					action:
						"Restart the node to load the built plugin. This is deliberately NOT done for " +
						"you: a restart interrupts whatever the node is currently serving, which is the " +
						"operator's call, not a diagnostic's.",
				});
				break;

			case "plugin-hash-unknown":
			case "built-plugin-unknown":
				recommendations.push({
					diagnostic: "sovereign:plugin-unknown",
					severity: "warning",
					summary: `${divergence.summary} This is a gap in the checking, not a finding about ` +
						"the node — it may match the built plugin or it may not, and this cannot tell you which.",
					action:
						"Run `refarm context --json` for the detail behind this gap. Treat the loaded " +
						"plugin as unverified rather than fine until the comparison can actually be made.",
				});
				break;

			// A node not running is a normal state with nothing to compare, not a divergence to
			// warn about — doctor's other checks already speak to whether a node should be up.
			case "node-not-running":
				break;

			// D2 ("which sovereign state is active" design doc) names this exact fact pattern —
			// a sovereign directory nothing loads — as the one BOTH `refarm context` and
			// `refarm doctor` must report. It is confusing, not broken: the operator may be
			// keeping it deliberately (a backup, a prior install) or may want it gone. Either
			// way, nothing here decides for them.
			case "unloaded-sovereign-dir":
				recommendations.push({
					diagnostic: "sovereign:unloaded-dir",
					severity: "warning",
					summary: divergence.summary,
					action:
						"Run `refarm context --json` to see it named alongside the active home, then " +
						"decide, as the operator, whether to remove it or keep it. This is not a sign " +
						"anything is misbehaving, and nothing here removes or alters the directory.",
				});
				break;

			// `context-doctor.ts` already reports this fact under this exact diagnostic name — see
			// this module's header. Reporting it a second time here would be the two-names-for-
			// one-fact mistake `context.ts` was written to end, moved rather than avoided.
			case CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC:
				break;

			default:
				// Exhaustiveness guard: a future `DivergenceKind` member reaches here only if this
				// switch was not updated for it. That is exactly how `unloaded-sovereign-dir`
				// slipped through in the first pass of this file — a case existed, decided
				// silence, and nobody was forced to revisit that decision when D2's requirement
				// came into view. This throws at compile time instead: the type below is `never`
				// only when every literal in `DivergenceKind` has its own case above, so adding a
				// new kind without a case here is a build failure, not a silent gap.
				assertNeverDivergenceKind(divergence.kind);
		}
	}

	return recommendations;
}

function assertNeverDivergenceKind(kind: never): never {
	throw new Error(`sovereign-divergence-doctor: unhandled Divergence kind ${JSON.stringify(kind)}`);
}
