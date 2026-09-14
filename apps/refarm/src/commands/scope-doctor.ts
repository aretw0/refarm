// Scope doctor findings — the node answers from one directory, the operator edits another,
// and until now NOTHING said so.
//
// This exists for a failure that cost a whole evening. The runtime was restarted from a
// repository instead of the operator's home, so the daemon resolved declarations against
// that repository — where the same workspace declares something else. A device started a
// declared operation, the node ADMITTED it (the catalog is read from the operator's home)
// and then REFUSED it while running (the workspace came from the daemon's directory). What
// reached the phone was `exit 1` and "the operation promised a result and delivered none".
// Nothing in that message, or in any status output, named a directory.
//
// `SOVEREIGN_BASE` closed the node's half: told once, read identically everywhere. The
// OPERATOR's half is narrower than it used to be: since 2026-08-06 ("two halves, one
// node") `declaredBase()` (`@refarm.dev/config`) no longer falls back to cwd either, so
// the general run of `refarm` commands no longer resolve declarations from wherever the
// operator happens to be standing. What still does, deliberately: `doctor.ts`'s own
// `resolveScopeComparison`, which is what actually builds `operatorConfigPath` and
// `operatorPolicyPath` below — it resolves from a bare `process.cwd()` on purpose, because
// routing it through `declaredBase()` would collapse the operator's half onto the node's
// and hide the exact divergence this file exists to report — and the three
// `resolveRefarmScopeRoot` consumers (operator-attention state,
// `apps/refarm/src/utils/refarm-home.ts`), which try `<cwd>/.refarm` before falling back
// to the OS home. That cwd-rooted answer is still correct where it happens (a developer
// inside a project wants that project's declarations) and it is exactly why the divergence
// must be VISIBLE: this node carries two `auth-policy.json` files that disagree, and the
// only reason anyone knows is that somebody went looking.
//
// So this reports the divergence rather than resolving it. Two shapes, both warnings:
//
//   - `config.json` — the operator reads and writes declarations the running node does not.
//   - `auth-policy.json` — sharper, because it is silent AND destructive-adjacent: rotating
//     a device credential from the wrong directory writes a token the node never reads, the
//     device stops authenticating with nothing naming the cause, and the obvious remedy
//     (rotate again) reproduces it. Meanwhile the credential the operator believes they
//     replaced is still live in the policy that IS read.
//
// NO divergence, or a local file that does not exist, produces NO finding: standing
// somewhere without declarations is the normal case, and a doctor that nags about it trains
// the operator to ignore it — the rule `connection-doctor.ts` states and keeps.
//
// Pure over resolved paths and an injected `exists`, exactly like its neighbour: this never
// touches the filesystem itself, so every test drives it with literals and none can reach
// the operator's real files.

import type { RefarmDoctorRecommendation } from "./doctor.js";

/** What the operator would read or write from where they are standing, beside what the
 *  running node actually uses. Both absolute, both already resolved by the caller. */
export interface ScopeComparison {
	/** `<process.cwd()>/<sovereignDir>/config.json` — the operator's literal standing
	 *  directory, resolved in `doctor.ts`'s `resolveScopeComparison` (deliberately NOT
	 *  `declaredBase()`, which no longer reads cwd and would collapse this onto
	 *  `nodeConfigPath`, hiding the divergence this file exists to report). */
	operatorConfigPath: string;
	/** `<refarmHome>/config.json` — what a node started with this home reads. */
	nodeConfigPath: string;
	operatorPolicyPath: string;
	nodePolicyPath: string;
}

const SCOPE_NEXT_COMMAND = "refarm config spawn-env --json";
const AUTH_NEXT_COMMAND = "refarm auth list --json";

/**
 * The divergences worth telling the operator about, in the order they bite.
 *
 * `exists` is injected rather than imported so this stays pure — and so a test can express
 * "the file is there" without creating one.
 */
export function buildScopeDoctorRecommendations(
	scope: ScopeComparison,
	exists: (filePath: string) => boolean,
): RefarmDoctorRecommendation[] {
	const findings: RefarmDoctorRecommendation[] = [];

	// The credential one first: it is the one whose failure is silent on another device.
	if (scope.operatorPolicyPath !== scope.nodePolicyPath && exists(scope.operatorPolicyPath)) {
		findings.push({
			diagnostic: "scope:auth-policy-divergence",
			severity: "warning",
			summary:
				`This directory has its own auth policy (${scope.operatorPolicyPath}), and it is not ` +
				`the one a node started here reads (${scope.nodePolicyPath}).`,
			action:
				"Enrol and rotate from the node's own directory, or pass --policy explicitly. A " +
				"credential written to the other file authorises nothing, and the device it was " +
				"meant for fails with nothing naming the cause.",
			command: AUTH_NEXT_COMMAND,
		});
	}

	if (scope.operatorConfigPath !== scope.nodeConfigPath && exists(scope.operatorConfigPath)) {
		findings.push({
			diagnostic: "scope:config-divergence",
			severity: "warning",
			summary:
				`This directory declares its own config (${scope.operatorConfigPath}), which is not ` +
				`the one a node started here reads (${scope.nodeConfigPath}).`,
			action:
				"Expect commands run here to answer from this directory's declarations, not the " +
				"node's. Run them from the node's directory when you mean the node.",
			command: SCOPE_NEXT_COMMAND,
		});
	}

	return findings;
}
