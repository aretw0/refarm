/**
 * WHEN THE WORK ITSELF HAS AGED, and nothing said so.
 *
 * MEASURED 2026-08-23: `origin/develop` had not moved since 2026-08-09 while the local branch
 * carried 302 commits. The cost was not the commits. It was that six gates went red across those
 * fourteen days and every one stayed invisible, because the pipeline that would have run them had
 * nothing new to run on — and because a lane stops at its FIRST red step, so six accumulated
 * failures cost six separate discoveries rather than one.
 *
 * This is `node-substrate`'s question one layer out. An installed node says when it has aged
 * relative to the checkout beside it; a branch should say when its work has aged relative to the
 * remote that is the only thing a pipeline can see.
 */

/**
 * The age at which unpushed work is worth a sentence.
 *
 * DERIVED, NOT CHOSEN. This repository's slowest scheduled gates run weekly — Security Audit on
 * Mondays, Release Health on Wednesdays — so work older than seven days has already missed a full
 * cycle of every time-based check there is. Below that, a working branch is simply working, and a
 * line that appears the moment anyone commits is one nobody reads by the second day.
 */
export const BRANCH_DRIFT_DAYS = 7;

/**
 * @typedef {{ ahead: number, upstream: string | null, oldestUnpushedAt: string | null }} BranchDrift
 */

/**
 * PURE. The fact, for a branch whose work has been invisible long enough to matter.
 *
 * SILENT IN FOUR CASES, and each silence is a refusal to claim something unmeasured: nothing
 * ahead, work younger than the threshold, no upstream to have drifted FROM, and an age that could
 * not be read. The last is not "probably fine" — it is "nothing here knows", and rendering it as
 * reassurance is the shape this rule exists to remove.
 *
 * Names no CLI verb; the handoff belongs where every other one is rendered.
 *
 * @param {BranchDrift} drift
 * @param {string} today YYYY-MM-DD, injected so the threshold is testable without waiting a week.
 * @returns {string | null}
 */
export function describeBranchDrift(drift, today) {
	if (!drift || drift.ahead <= 0) return null;
	if (!drift.upstream || !drift.oldestUnpushedAt) return null;
	const days = daysBetween(drift.oldestUnpushedAt, today);
	if (days === null || days < BRANCH_DRIFT_DAYS) return null;
	return (
		`${drift.ahead} commit(s) here have never reached ${drift.upstream}, the oldest ${days} ` +
		"days old. Nothing that runs on the remote has seen any of it, and a gate that goes red in " +
		"work this old is found in a batch rather than on the day it broke."
	);
}

/** PURE. Whole days between two YYYY-MM-DD dates, or null when either cannot be read. */
function daysBetween(from, to) {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return Math.floor((end - start) / 86_400_000);
}
