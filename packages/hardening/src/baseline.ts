/**
 * THE RATCHET — a baseline that may only shrink.
 *
 * H1 of the design doc: a gate and a signal are different things, and conflating them is why
 * demanding checks never get added. A check that must be green can only be introduced when
 * everything already satisfies it, which in a real codebase means never. So the signal is allowed
 * to be non-zero, and the GATE is that it must not GROW.
 *
 * H2, the direction of travel:
 *   · a not-yet-hardened suite that is NOT in the baseline ⇒ red. That is a regression.
 *   · a baseline entry that now passes ⇒ red, until the entry is DELETED. Progress has to be
 *     recorded, or it can silently un-happen later.
 *   · a baseline entry naming a suite that no longer exists ⇒ red. Stale cover is cover for
 *     nothing.
 *   · the baseline shrinking is the only direction that needs no ceremony.
 *
 * ── NOTHING HERE WRITES THE BASELINE, AND NOTHING ANYWHERE ELSE DOES EITHER ──────────────────
 * "Adding an entry to the baseline must be an explicit, reviewable act — a deliberate edit, never
 * an automatic capture. Auto-capture turns the baseline into a mute button, and a mute button is
 * worse than no check because it looks like coverage."
 *
 * That is enforced structurally, not by discipline: this package has NO write path. It imports
 * `readFileSync` and nothing else from `node:fs`, exports no function that takes a baseline and
 * produces a file, and the CLI declares no option that accepts one. `no-auto-capture.test.ts`
 * asserts all three against the source, so adding a writer — however well-intentioned — fails the
 * suite. Adding an entry means editing `hardening-baseline.json` by hand, in a diff someone reads.
 *
 * Each entry carries a `note`. An entry without one is malformed and the gate says so: a bare id
 * is what a machine would write, and a sentence about why the debt exists is what a person writes.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { HardeningSignal } from "./types.js";

export const HARDENING_BASELINE_FILENAME = "hardening-baseline.json";

export interface HardeningBaselineEntry {
	/** `<package>#<runner>` — the id `collectHardeningSignal` reports. */
	id: string;
	/** Why this debt exists and what would close it. Required: see the header. */
	note: string;
}

export interface HardeningBaseline {
	entries: HardeningBaselineEntry[];
}

export interface BaselineRead {
	path: string;
	present: boolean;
	baseline: HardeningBaseline;
	/** Set when the file exists but could not be read as a baseline. */
	error: string | null;
}

export function readHardeningBaseline(workspaceRoot: string): BaselineRead {
	const file = path.join(workspaceRoot, HARDENING_BASELINE_FILENAME);
	const empty: HardeningBaseline = { entries: [] };
	if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
		return { path: file, present: false, baseline: empty, error: null };
	}
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { entries?: unknown };
		if (!Array.isArray(parsed.entries)) {
			return { path: file, present: true, baseline: empty, error: "`entries` must be an array" };
		}
		const entries: HardeningBaselineEntry[] = [];
		for (const raw of parsed.entries) {
			const entry = raw as { id?: unknown; note?: unknown };
			entries.push({
				id: typeof entry.id === "string" ? entry.id : "",
				note: typeof entry.note === "string" ? entry.note : "",
			});
		}
		return { path: file, present: true, baseline: { entries }, error: null };
	} catch (error) {
		return {
			path: file,
			present: true,
			baseline: empty,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export interface RatchetVerdict {
	ok: boolean;
	/** Not-yet-hardened and not in the baseline: the growth the gate exists to stop. */
	regressions: { id: string; fix: string }[];
	/** In the baseline and now conformant: delete the entry. */
	fixed: string[];
	/** In the baseline and now not-applicable, or naming no discovered suite: delete the entry. */
	stale: { id: string; why: string }[];
	/** In the baseline, still not hardened. The debt, held. */
	held: string[];
	/** Entries a person did not finish writing — a bare id with no note. */
	malformed: string[];
}

export function evaluateHardeningRatchet(
	signal: HardeningSignal,
	baseline: HardeningBaseline,
): RatchetVerdict {
	const byId = new Map(signal.entries.map((entry) => [entry.id, entry]));
	const baselined = new Set(baseline.entries.map((entry) => entry.id));

	const regressions = signal.entries
		.filter((entry) => entry.state === "not-yet-hardened" && !baselined.has(entry.id))
		.map((entry) => ({ id: entry.id, fix: entry.fix ?? "" }));

	const fixed: string[] = [];
	const stale: { id: string; why: string }[] = [];
	const held: string[] = [];
	const malformed: string[] = [];

	for (const entry of baseline.entries) {
		if (!entry.id || !entry.note.trim()) {
			malformed.push(entry.id || "(an entry with no id)");
			continue;
		}
		const current = byId.get(entry.id);
		if (!current) {
			stale.push({ id: entry.id, why: "no suite with this id was discovered" });
			continue;
		}
		if (current.state === "conformant") {
			fixed.push(entry.id);
			continue;
		}
		if (current.state === "not-applicable") {
			stale.push({ id: entry.id, why: `it is now not-applicable — ${current.reason ?? ""}` });
			continue;
		}
		held.push(entry.id);
	}

	return {
		ok:
			regressions.length === 0 && fixed.length === 0 && stale.length === 0 && malformed.length === 0,
		regressions,
		fixed,
		stale,
		held,
		malformed,
	};
}
