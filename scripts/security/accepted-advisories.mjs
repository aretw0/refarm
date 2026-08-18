/**
 * ADVISORIES THIS REPOSITORY ACCEPTS, AND UNTIL WHEN.
 *
 * The gate is `pnpm audit --audit-level=moderate --prod` (operator's ruling, 2026-08-11). Four
 * advisories fail it today and none has a reachable fix, so a gate without exceptions would be
 * red on arrival — and a gate red on arrival is a gate an operator learns to bypass.
 *
 * WHAT MAKES THIS DIFFERENT FROM AN ALLOWLIST: every entry carries a DATE. The gate fails when
 * one passes. That is the property the two mechanisms this replaces both lacked, and it is why
 * both went stale unnoticed:
 *
 *   - `pnpm-workspace.yaml`'s postcss pin was written against a boundary that later moved, so the
 *     lockfile resolved INSIDE the vulnerable range with a pin sitting above it looking like a
 *     fix. Nothing re-read it (ISS-086).
 *   - `auditConfig.ignoreGhsas` suppressed a CRITICAL decompress advisory on the stated grounds
 *     that it had no patch. That claim was true — but nothing re-checked it, its own comment said
 *     so, and the entry has no expiry (ISS-087).
 *
 * A justification with no expiry is a claim about the world that stops being verified the moment
 * it is written. These have one.
 *
 * THE OTHER HALF: `suppressed` entries. `pnpm audit` counts an `ignoreGhsas` advisory in
 * `metadata.vulnerabilities` and omits it from `advisories`, so `--audit-level=high` exits 0
 * while printing `critical: 1` in the same JSON. The gate reconciles the counts against this
 * list, so a suppressed advisory nobody declared here fails just as loudly as a new one — the
 * suppression stops being invisible.
 */

/** @typedef {{
 *   ghsa: string,
 *   package: string,
 *   severity: "low" | "moderate" | "high" | "critical",
 *   why: string,
 *   trigger: string,
 *   recheckBy: string,
 *   suppressed?: boolean,
 * }} AcceptedAdvisory */

/** @type {AcceptedAdvisory[]} */
export const ACCEPTED_ADVISORIES = [
	{
		ghsa: "GHSA-8mv7-9c27-98vc",
		package: "astro",
		severity: "moderate",
		why:
			"Patched at 7.0.6, and 7.0.6 BREAKS THE BUILD — measured 2026-08-11 by bisecting: 7.0.4 " +
			"builds 59/59, 7.0.6 and 7.0.9 fail with MISSING_EXPORT because rolldown resolves a " +
			"subpath export to the .d.ts. The repo is pinned at the highest version that builds.",
		trigger:
			"Rolldown's subpath resolution fixed upstream. RE-BISECT the build rather than trusting " +
			"this note — the previous record put the breakage at 7.1 and it starts at 7.0.6.",
		recheckBy: "2026-10-10",
	},
	{
		ghsa: "GHSA-f48w-9m4c-m7f5",
		package: "astro",
		severity: "moderate",
		why: "Same 7.0.6 boundary and the same build failure as GHSA-8mv7-9c27-98vc.",
		trigger: "Same as GHSA-8mv7-9c27-98vc — they lift together.",
		recheckBy: "2026-10-10",
	},
	{
		ghsa: "GHSA-4g3v-8h47-v7g6",
		package: "astro",
		severity: "moderate",
		why:
			"Patched at >=7.0.10, which does not exist: npm publishes 7.0.0-7.0.9, so the fix is the " +
			"7.1 line. That is issue #56's own case — the one the original exclusion was actually " +
			"about, even though it was written as if it covered all of astro.",
		trigger: "The 7.1 line builds this repo's apps. Blocked on the same upstream rolldown fix.",
		recheckBy: "2026-10-10",
	},
	{
		ghsa: "GHSA-h39j-r5qq-r9mm",
		package: "decompress",
		severity: "moderate",
		why:
			"NO PATCH EXISTS. The advisory says `patched >=4.2.2`; the npm registry has 41 versions " +
			"ending at 4.2.1, and `latest` IS 4.2.1. That metadata says which version WOULD carry a " +
			"fix, not that one was published — a distinction that cost two wrong records before it " +
			"was measured (ISS-087). Reach verified the same day: `pnpm why decompress -r` resolves " +
			"exactly one path, decompress <- @bytecodealliance/weval <- componentize-js <- jco, the " +
			"build-time WASM toolchain. It does not reach a shipped artifact.",
		trigger:
			"A published decompress >4.2.1, or jco dropping weval. Check the REGISTRY, not the " +
			"advisory page.",
		recheckBy: "2026-11-09",
	},
	{
		ghsa: "GHSA-mp2f-45pm-3cg9",
		package: "decompress",
		severity: "critical",
		suppressed: true,
		why:
			"The same package, the same range and the same absent patch as GHSA-h39j-r5qq-r9mm, at " +
			"CRITICAL severity. It is in `pnpm-workspace.yaml`'s `auditConfig.ignoreGhsas`, which is " +
			"why `pnpm audit --audit-level=high` exits 0 while reporting `critical: 1` in its own " +
			"metadata. DECLARED HERE so that suppression is not invisible: the gate reconciles the " +
			"severity counts against this list and fails on anything hidden that nobody wrote down.",
		trigger: "Identical to GHSA-h39j-r5qq-r9mm. They lift together, and the ignore entry goes with them.",
		recheckBy: "2026-11-09",
	},
	{
		ghsa: "GHSA-jmr9-qjv8-65gv",
		package: "extract-zip",
		severity: "high",
		why:
			"THE PATCH THE ADVISORY NAMES DOES NOT EXIST. It says `>=2.0.2`; the registry's latest " +
			"published version is 2.0.1 (measured 2026-08-18, `npm view extract-zip versions`). " +
			"Transitive through `@puppeteer/browsers@2.13.2`, which requires `^2.0.1` — so even a " +
			"lockfile override has nothing to resolve to. Browser tooling, not production runtime.",
		trigger:
			"2.0.2 (or later) is actually PUBLISHED. Check the registry, not the advisory page: the " +
			"advisory has named a version that does not exist since it was filed, which is exactly " +
			"the claim a dated acceptance exists to keep re-checking.",
		recheckBy: "2026-11-18",
	},
	{
		ghsa: "GHSA-jwp9-9v96-94mx",
		package: "decompress",
		severity: "moderate",
		why:
			"Same shape as the two decompress entries above and same absent patch, measured freshly: " +
			"the advisory names `>=4.2.2` and the registry's latest published version is 4.2.1 " +
			"(2026-08-18). Transitive through `@bytecodealliance/weval@0.4.1`, which requires " +
			"`^4.2.1`. A build-time WASM optimiser, not a production runtime dependency.",
		trigger:
			"4.2.2 (or later) is published, OR `weval` drops the dependency. It lifts with " +
			"GHSA-h39j-r5qq-r9mm and GHSA-mp2f-45pm-3cg9 — same package, same missing release.",
		recheckBy: "2026-11-18",
	},
];

/** PURE. Three states, never two: an entry whose date has passed is EXPIRED (the acceptance
 *  stopped being verified), which is a different fact from an entry that is simply accepted. */
export function classifyAcceptance(entry, today) {
	return entry.recheckBy <= today ? "expired" : "accepted";
}

/**
 * PURE. What a run means, given what the audit reported and what this file accepts.
 *
 * Four findings, and only the first is the one a security gate normally has:
 *   - `unaccepted`  reported and nobody wrote it down. The ordinary failure.
 *   - `expired`     accepted, still reported, and its re-check date has passed. The whole point.
 *   - `stale`       accepted and NO LONGER reported — the exception outlived its advisory and
 *                   must be removed, the same self-expiry the brand guard's allowlist has.
 *   - `hidden`      the severity counts do not add up: `metadata` reports more of some severity
 *                   than `advisories` plus the `suppressed` entries here account for. Something
 *                   is being silenced that nobody declared.
 */
export function judgeAudit({ reported, metadata, accepted = ACCEPTED_ADVISORIES, today }) {
	const acceptedById = new Map(accepted.map((entry) => [entry.ghsa, entry]));
	const reportedIds = new Set(reported.map((advisory) => advisory.ghsa));

	const unaccepted = reported.filter((advisory) => !acceptedById.has(advisory.ghsa));
	const expired = accepted.filter(
		(entry) =>
			classifyAcceptance(entry, today) === "expired" &&
			(entry.suppressed || reportedIds.has(entry.ghsa)),
	);
	const stale = accepted.filter((entry) => !entry.suppressed && !reportedIds.has(entry.ghsa));

	// Counts: what the audit SAW (advisories) plus what this file says is suppressed should equal
	// what the audit COUNTED (metadata). A surplus is something silenced and undeclared.
	const hidden = [];
	const seen = new Map();
	for (const advisory of reported) seen.set(advisory.severity, (seen.get(advisory.severity) ?? 0) + 1);
	for (const entry of accepted) {
		if (entry.suppressed) seen.set(entry.severity, (seen.get(entry.severity) ?? 0) + 1);
	}
	for (const [severity, counted] of Object.entries(metadata ?? {})) {
		if (severity === "info" || counted === 0) continue;
		const accountedFor = seen.get(severity) ?? 0;
		if (counted > accountedFor) {
			hidden.push({ severity, counted, accountedFor });
		}
	}

	return { unaccepted, expired, stale, hidden, ok: !unaccepted.length && !expired.length && !stale.length && !hidden.length };
}
