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
// NOT, on its own, turned into a `refarm doctor` recommendation. `runtime:not-ready`
// (`STATUS_DIAGNOSTICS.runtimeNotReady`, wired in `doctor.ts` from the status contract)
// already answers "is the runtime up and ready" for the operator-facing question that
// matters — reporting `node-not-running` too would be a second name for the same "the node
// is not up" fact in the ORDINARY case both co-occur, the exact double-naming this plan
// exists to end for `context:home-divergence`, just on a different pair of findings.
//
// BUT the two signals are genuinely independent — `runtime:not-ready` is a sidecar HTTP
// probe, `node-not-running` here is a `node.json`/pid read — and they can DISAGREE: a
// descriptor that says nothing is running, beside a sidecar that answered this very doctor
// run's status probe as ready. Neither signal alone reports that: `runtime:not-ready`
// never fires (the probe succeeded), and `node-not-running` alone was just ruled silent
// above. `sidecarReachable` below is that second signal, threaded in from `doctor.ts`'s
// own `status: StatusJson` (`status.runtime.ready`) — the SAME probe result
// `classifyStatusDiagnostics` already reads to decide `runtime:not-ready`, not a second
// HTTP call — and the one case where both are true gets its own finding
// (`sovereign:stale-descriptor`) below the loop. `node-name-doctor.ts` and
// `runtime-freshness-doctor.ts` still make the identical silence call for a bare `null`
// descriptor with no second signal to correlate against, so this does not abandon that
// precedent — it extends it for the one case a second, independent witness exists.
//
// THE BASE/NAMESPACE DIVERGENCE WAS LIVE ON THIS MACHINE when this file was written
// (2026-08-05): the tractor daemon (started by `scripts/tractor-start.sh`, which derives
// `SOVEREIGN_BASE` from `REFARM_HOME`) declared `SOVEREIGN_BASE=/home/s095407044`, while a
// shell with no `SOVEREIGN_BASE` set fell back to this CLI's own cwd — so `base-divergence`
// fired for a real, present reason, not a hypothetical.
//
// ERRATUM (2026-08-06, `docs/superpowers/plans/2026-08-06-two-halves-one-node.md`): the cwd
// fallback described above is gone. `declaredBase()` (`packages/config/src/index.js`) now
// falls back to `dirname(REFARM_HOME)`, then the bare OS home — never `process.cwd()` — so on
// THIS SAME MACHINE, with nothing declared, the CLI and the node now resolve the same base
// (`refarm context` reports `cli base: … (from home)` matching `node base: …`) and this
// specific divergence no longer fires by default. The comparison itself is unchanged and still
// able to fire on demand — `SOVEREIGN_BASE=/tmp/deliberately-wrong refarm context` still
// reports `base-divergence`, naming both sides (see that plan's task-4 report for the
// transcript) — this erratum corrects what was true of this machine's default state, not the
// check having been weakened.
//
// `sovereign:base-divergence` and `sovereign:namespace-divergence` below reuse
// `Divergence.summary` verbatim: `context.ts` already phrases it as "the node declares X, but
// this CLI resolves Y" — naming the node's side explicitly rather than leaving the operator to
// guess which value is whose — and this module only adds the `action`, which states that
// closing the gap (aligning this CLI's env to the node's, or leaving them apart because an
// explicit, deliberate declaration was the point) is the operator's call, never performed
// here.
//
// `node-environment-unknown` is a GAP IN THE CHECKING, not a finding about the node — the
// same distinction `runtime-freshness-doctor.ts` draws for its own `unknown` state ("This is
// a gap in the checking, not a finding about the node — it may be current or it may be hours
// behind, and this cannot tell you which."). `context.ts`'s own summary for this case already
// carries that same "gap in the checking, not agreement" phrasing, so `sovereign:environment-
// unknown` below reuses it rather than inventing new wording that would read as an accusation
// nothing here actually established.
//
// NEVER RESTARTS, NEVER WRITES. Same posture as `context.ts` itself and as
// `runtime-freshness-doctor.ts` before it: this states the fact and names the command an
// operator could choose to run, and stops there. No `action` here performs anything on the
// operator's behalf.
//
// SILENCE WHEN THERE IS NOTHING TO SAY. An empty `divergences` list — the ordinary case for
// a node running exactly what a fresh build produces — yields no recommendation at all, the
// same rule every other doctor finding in this codebase follows.

import { refarmCommand } from "../brand.js";
import { CONTEXT_HOME_DIVERGENCE_DIAGNOSTIC } from "./context-doctor.js";
import type { Divergence } from "./context.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

/**
 * Build the `refarm doctor` findings for the sovereign-state divergences `refarm context`
 * already resolves. PURE — every divergence here was already computed by
 * `buildContextReport` (`./context.ts`); this only decides which ones become a doctor
 * recommendation and how each is phrased.
 *
 * `sidecarReachable` is the one input here that is not itself a `Divergence` —
 * `status.runtime.ready` from the SAME `refarm doctor` run's status probe (see
 * `doctor.ts`'s call site), passed in rather than re-probed, so this stays pure over an
 * already-resolved input exactly like every other doctor finding builder in this codebase.
 * Defaults to `false` — never claim a reachability that was not established — so every call
 * site written before this parameter existed keeps its prior behaviour unchanged.
 */
export function buildSovereignDivergenceDoctorRecommendations(
	divergences: Divergence[] | null,
	sidecarReachable = false,
): RefarmDoctorRecommendation[] {
	// ISS-030. THREE STATES, and the third is the one this used to lose. `null` means the
	// comparison THREW — `resolveSovereignDivergences()` swallows the error deliberately so a
	// doctor run never crashes over a comparison it could not make — and doctor.ts flattened that
	// to `[]` with `?? []`, so "I could not look" and "I looked and found nothing" printed the same
	// clean report. This is the umbrella over every other sovereign finding, which is exactly why
	// it is worth saying out loud rather than defaulting to silence.
	if (divergences === null) {
		return [
			{
				diagnostic: "sovereign:divergence-unknown",
				severity: "warning",
				summary:
					"The sovereign-state comparison could not be made, so no divergence was ruled in OR out.",
				action:
					"Run `refarm context --json` to see the comparison directly and what stopped it. This is not a report that the node is healthy — it is a report that the check did not run.",
				// Through the handoff helper, never a literal: the binary's name comes from the
				// environment (ADR-087 — a white-label build supplies it), which is what
				// `process-boundary.test.ts` guards. This site was the guard's only live offender.
				command: refarmCommand(["context", "--json"]),
			},
		];
	}
	const recommendations: RefarmDoctorRecommendation[] = [];
	// Set inside the `node-not-running` case below; read after the loop to correlate against
	// `sidecarReachable` — see this module's header for why that correlation, not
	// `node-not-running` alone, is what earns a finding.
	let nodeNotRunning = false;

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
			// warn about ON ITS OWN — doctor's other checks (`runtime:not-ready`) already speak
			// to whether a node should be up. Recorded here and correlated with
			// `sidecarReachable` AFTER the loop (see below) for the one combination neither
			// signal alone reports — this module's header explains why that is not the same as
			// `runtime:not-ready`'s ordinary case.
			case "node-not-running":
				nodeNotRunning = true;
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

			// `refarm context` (`./context.ts`, 2026-08-06 "the node answers for itself") finds
			// the running node's own declared base/namespace disagreeing with this CLI's — see
			// this module's header for why the summary is reused verbatim and the `action`
			// never picks a side.
			case "base-divergence":
				recommendations.push({
					diagnostic: "sovereign:base-divergence",
					severity: "warning",
					summary: divergence.summary,
					action:
						"Run `refarm context --json` to see the node's declared base and this CLI's " +
						"side by side, then decide, as the operator, whether to set this CLI's " +
						"SOVEREIGN_BASE to match the node's or leave them apart — standing outside " +
						"the node's own directory while pointing at it can be intentional, and " +
						"nothing here changes either value.",
				});
				break;

			case "namespace-divergence":
				recommendations.push({
					diagnostic: "sovereign:namespace-divergence",
					severity: "warning",
					summary: divergence.summary,
					action:
						"Run `refarm context --json` to see the node's declared namespace and this " +
						"CLI's side by side, then decide, as the operator, whether to set this CLI's " +
						"REFARM_NAMESPACE to match the node's or leave them apart — this may be " +
						"intentional, and nothing here changes either value.",
				});
				break;

			// A running node whose environ could not be read — a GAP in the checking, not a
			// claim the node and CLI disagree. See this module's header for why the summary
			// (already phrased by `context.ts` as "a gap in the checking, not agreement") is
			// reused rather than rewritten.
			case "node-environment-unknown":
				recommendations.push({
					diagnostic: "sovereign:environment-unknown",
					severity: "warning",
					summary: divergence.summary,
					action:
						"Run `refarm context --json` for the detail behind this gap. Treat the node's " +
						"base and namespace as unverified rather than matching until its environment " +
						"can actually be read.",
				});
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

	// The fourth follow-up this plan named (see this module's header): `node-not-running`
	// and `runtime:not-ready` agree in the ordinary case, which is why `node-not-running`
	// alone stayed silent above. The one case that ordinary silence does NOT cover is this
	// correlation — a descriptor saying nothing is running, beside a sidecar that answered
	// THIS SAME doctor run's status probe as ready. Checked here, once, after the loop,
	// rather than inside the `node-not-running` case, because it depends on a second signal
	// the loop over `divergences` alone does not carry.
	if (nodeNotRunning && sidecarReachable) {
		recommendations.push({
			diagnostic: "sovereign:stale-descriptor",
			severity: "warning",
			summary:
				"The node descriptor (node.json / pid) says no node is running, but the runtime " +
				"sidecar answered this doctor run's status probe as ready — the two signals " +
				"disagree. Either a node exited without cleaning up its own descriptor, or a " +
				"different process is now answering at the same runtime endpoint.",
			action:
				"Run `refarm context --json` to see the descriptor and the runtime endpoint " +
				"together, then decide, as the operator, whether to restart the node cleanly or " +
				"investigate what is actually answering there. Nothing here restarts anything or " +
				"removes the descriptor for you.",
		});
	}

	return recommendations;
}

function assertNeverDivergenceKind(kind: never): never {
	throw new Error(`sovereign-divergence-doctor: unhandled Divergence kind ${JSON.stringify(kind)}`);
}
