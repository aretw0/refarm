import { describe, expect, it } from "vitest";

import path from "node:path";
import { evaluateHardeningRatchet, readHardeningBaseline, type HardeningBaseline } from "./baseline.js";
import { findWorkspaceRoot } from "./discover.js";
import { countEntries, type HardeningEntry, type HardeningSignal } from "./types.js";

function entry(id: string, state: HardeningEntry["state"]): HardeningEntry {
	return {
		id,
		packageName: id.split("#")[0]!,
		runner: id.split("#")[1]!,
		declares: "runner",
		source: "packages/x/src/conformance.ts",
		state,
		checks: 3,
		failed: state === "not-yet-hardened" ? 1 : 0,
		detail: [],
		fix: state === "not-yet-hardened" ? "fix it" : null,
		reason: state === "not-applicable" ? "it does not apply" : null,
	};
}

function signalOf(entries: HardeningEntry[]): HardeningSignal {
	return { workspaceRoot: "/nowhere", entries, counts: countEntries(entries) };
}

const baselineOf = (...ids: string[]): HardeningBaseline => ({
	entries: ids.map((id) => ({ id, note: "a debt, with the sentence a person wrote about it" })),
});

describe("the ratchet only turns one way", () => {
	it("passes when the signal is unchanged — a held debt is not a failure", () => {
		const verdict = evaluateHardeningRatchet(
			signalOf([entry("@x/a#runA", "not-yet-hardened"), entry("@x/b#runB", "conformant")]),
			baselineOf("@x/a#runA"),
		);
		expect(verdict.ok).toBe(true);
		expect(verdict.held).toEqual(["@x/a#runA"]);
	});

	it("REJECTS GROWTH: a new not-yet-hardened suite that is not in the baseline is red", () => {
		const verdict = evaluateHardeningRatchet(
			signalOf([entry("@x/a#runA", "not-yet-hardened"), entry("@x/new#runNew", "not-yet-hardened")]),
			baselineOf("@x/a#runA"),
		);
		expect(verdict.ok).toBe(false);
		expect(verdict.regressions.map((item) => item.id)).toEqual(["@x/new#runNew"]);
		expect(verdict.regressions[0]!.fix).toBe("fix it");
	});

	it("REQUIRES REMOVAL: a baselined suite that now passes is red until its entry is deleted", () => {
		// Progress made permanent. Without this, a fix can silently un-happen later and the baseline
		// would quietly absorb it again.
		const fixed = evaluateHardeningRatchet(
			signalOf([entry("@x/a#runA", "conformant")]),
			baselineOf("@x/a#runA"),
		);
		expect(fixed.ok).toBe(false);
		expect(fixed.fixed).toEqual(["@x/a#runA"]);
		// …and once the entry is deleted, green.
		expect(evaluateHardeningRatchet(signalOf([entry("@x/a#runA", "conformant")]), baselineOf()).ok).toBe(
			true,
		);
	});

	it("is red on a baseline entry that names nothing, or that is no longer applicable", () => {
		const stale = evaluateHardeningRatchet(signalOf([]), baselineOf("@x/gone#runGone"));
		expect(stale.ok).toBe(false);
		expect(stale.stale.map((item) => item.id)).toEqual(["@x/gone#runGone"]);

		const notApplicable = evaluateHardeningRatchet(
			signalOf([entry("@x/a#runA", "not-applicable")]),
			baselineOf("@x/a#runA"),
		);
		expect(notApplicable.ok).toBe(false);
		expect(notApplicable.stale[0]!.why).toContain("not-applicable");
	});

	it("is red on an entry with no note — a bare id is what a machine writes", () => {
		const verdict = evaluateHardeningRatchet(signalOf([entry("@x/a#runA", "not-yet-hardened")]), {
			entries: [{ id: "@x/a#runA", note: "   " }],
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.malformed).toEqual(["@x/a#runA"]);
	});

	it("treats a missing baseline as an empty one — every debt then reads as growth", () => {
		const read = readHardeningBaseline("/nonexistent-workspace-root");
		expect(read.present).toBe(false);
		expect(read.baseline.entries).toEqual([]);
		expect(read.error).toBeNull();
	});
});

describe("this repository's own baseline", () => {
	it("is a real file, every entry carries a note, and nothing in it is stale", () => {
		const root = findWorkspaceRoot(path.resolve(__dirname, ".."))!;
		const read = readHardeningBaseline(root);
		expect(read.present).toBe(true);
		expect(read.error).toBeNull();
		// Zero is the destination of a shrinking ratchet, so an empty baseline is valid and healthy.
		expect(Array.isArray(read.baseline.entries)).toBe(true);
		for (const item of read.baseline.entries) {
			expect(item.id).toMatch(/^@[\w.@/-]+#[A-Za-z0-9]+$/);
			// A note long enough to be a reason, not a shrug — the shape the CLI refusal harness uses
			// for its own exclusion list.
			expect(item.note.length).toBeGreaterThan(40);
		}
	});
});
