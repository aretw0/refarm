import { describe, expect, it } from "vitest";

import { BRANCH_DRIFT_DAYS, describeBranchDrift } from "./branch-drift.js";

/**
 * MEASURED 2026-08-23. `origin/develop` had not moved since 2026-08-09 while the local branch
 * carried 302 commits. Nothing said so, and the consequence was not the commits — it was that six
 * gates went red across those fourteen days and every one of them stayed invisible, because the
 * only pipeline that would have run them had nothing to run on.
 *
 * The same shape as ISS-159 one layer out: an installed node says when it has aged; a branch
 * should say when its work has.
 */
const TODAY = "2026-08-23";

describe("describeBranchDrift", () => {
	it("says nothing when the branch has nothing the remote lacks", () => {
		expect(
			describeBranchDrift({ ahead: 0, upstream: "origin/develop", oldestUnpushedAt: null }, TODAY),
		).toBeNull();
	});

	it("says nothing while the work is younger than the threshold", () => {
		// A slice in progress is the normal state of a working branch, and a line that appears the
		// moment anyone commits is a line nobody reads by the second day.
		expect(
			describeBranchDrift(
				{ ahead: 12, upstream: "origin/develop", oldestUnpushedAt: "2026-08-21" },
				TODAY,
			),
		).toBeNull();
	});

	it("speaks once the oldest unpushed work has outlived a full cycle of the scheduled gates", () => {
		const text = describeBranchDrift(
			{ ahead: 302, upstream: "origin/develop", oldestUnpushedAt: "2026-08-09" },
			TODAY,
		);
		expect(text).toContain("302");
		expect(text).toContain("14");
		expect(text).toContain("origin/develop");
	});

	it("says nothing when there is no upstream to have drifted FROM", () => {
		// A branch nobody has pushed once has no distance to report. Reporting one would be a
		// claim about a remote that was never named.
		expect(
			describeBranchDrift({ ahead: 40, upstream: null, oldestUnpushedAt: "2026-07-01" }, TODAY),
		).toBeNull();
	});

	it("says nothing when the age could not be read, rather than assuming it is fine", () => {
		expect(
			describeBranchDrift({ ahead: 40, upstream: "origin/develop", oldestUnpushedAt: null }, TODAY),
		).toBeNull();
	});

	it("names no CLI verb, so any surface can render it", () => {
		const text = describeBranchDrift(
			{ ahead: 302, upstream: "origin/develop", oldestUnpushedAt: "2026-08-09" },
			TODAY,
		);
		expect(text).not.toMatch(/refarm |git /u);
	});

	it("derives its threshold from the repository's own slowest scheduled gate", () => {
		// Not a taste. Security Audit runs Mondays and Release Health Wednesdays, so work older
		// than seven days has already missed a full cycle of every time-based check this repo has.
		expect(BRANCH_DRIFT_DAYS).toBe(7);
	});
});
