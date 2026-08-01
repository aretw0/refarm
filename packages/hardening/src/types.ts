/**
 * THE HARDENING SIGNAL — the vocabulary.
 *
 * `docs/superpowers/specs/2026-07-30-hardening-signal-design.md` H3: a signal that lumps *this
 * contract does not apply here* together with *this has not been hardened yet* is noise, and noise
 * gets ignored. So an entry carries WHICH KIND of answer it is, and the two absent kinds each carry
 * the thing that makes them actionable rather than decorative:
 *
 *   · `not-yet-hardened` carries `fix` — what would make it conformant;
 *   · `not-applicable`   carries `reason` — why the contract does not apply here.
 *
 * An entry may never be `not-applicable` without a reason: that is how "not applicable" stops being
 * a place to hide work.
 */

export type HardeningState = "conformant" | "not-yet-hardened" | "not-applicable";

export interface HardeningEntry {
	/** Stable identity, `<package>#<runner>`. This is what the baseline names, so it must not
	 *  change when a file moves. */
	id: string;
	packageName: string;
	/** The exported entry point, e.g. `runTaskV1Conformance` — or, when `declares` is
	 *  `result-shape`, the result type that has no entry point. */
	runner: string;
	/** What the package declared: an executable `runner`, or only a `result-shape`. */
	declares: "runner" | "result-shape";
	/** Workspace-relative path of the file that DECLARES the runner. */
	source: string;
	state: HardeningState;
	/** Checks the suite actually ran. Zero when it did not run. */
	checks: number;
	/** Checks that failed. */
	failed: number;
	/** Failure lines, normalised across the differing result shapes. */
	detail: string[];
	/** `not-yet-hardened` only: what would fix it. Never null in that state. */
	fix: string | null;
	/** `not-applicable` only: why the contract does not apply. Never null in that state. */
	reason: string | null;
}

export interface HardeningCounts {
	suites: number;
	conformant: number;
	notYetHardened: number;
	notApplicable: number;
	/** Total checks executed across every suite that ran. */
	checks: number;
}

export interface HardeningSignal {
	workspaceRoot: string;
	/** Ordered by package, then by runner. Deliberately NOT ordered by severity: the design doc
	 *  puts scoring and weighting out of this slice rather than pretending to a priority model
	 *  nobody has calibrated. */
	entries: HardeningEntry[];
	counts: HardeningCounts;
}

export function countEntries(entries: readonly HardeningEntry[]): HardeningCounts {
	return {
		suites: entries.length,
		conformant: entries.filter((entry) => entry.state === "conformant").length,
		notYetHardened: entries.filter((entry) => entry.state === "not-yet-hardened").length,
		notApplicable: entries.filter((entry) => entry.state === "not-applicable").length,
		checks: entries.reduce((total, entry) => total + entry.checks, 0),
	};
}
