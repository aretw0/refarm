/**
 * `@refarm.dev/hardening` — the hardening signal.
 *
 * Design: `docs/superpowers/specs/2026-07-30-hardening-signal-design.md`.
 * Answered on demand by `refarm hardening` (H4: a signal nobody reads is a log).
 */

export {
	evaluateHardeningRatchet,
	HARDENING_BASELINE_FILENAME,
	readHardeningBaseline,
	type BaselineRead,
	type HardeningBaseline,
	type HardeningBaselineEntry,
	type RatchetVerdict,
} from "./baseline.js";
export { collectHardeningSignal, type CollectOptions } from "./collect.js";
export {
	discoverConformanceSuites,
	findWorkspaceRoot,
	moduleFor,
	workspacePackageGlobs,
	workspacePackages,
	type DiscoveredSuite,
	type WorkspacePackage,
} from "./discover.js";
export { normaliseConformanceResult, type NormalisedResult } from "./normalise.js";
export {
	conventionCandidates,
	packageRootModule,
	resolveSubject,
	type SubjectInvocation,
	type SubjectResolution,
} from "./subjects.js";
export {
	countEntries,
	type HardeningCounts,
	type HardeningEntry,
	type HardeningSignal,
	type HardeningState,
} from "./types.js";
