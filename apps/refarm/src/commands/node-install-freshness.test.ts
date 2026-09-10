// apps/refarm/src/commands/node-install-freshness.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { digestTree, freshnessRefusal, readTreeFreshness } from "./node-install-freshness.js";

/**
 * MEASURED 2026-08-25. `refarm node install` reported "installed" and the label
 * `0.1.0-57ff5cc1` while packaging an `apps/refarm/dist/index.js` NINETEEN MINUTES older
 * than `plugin-capability.ts`. The checkout was CLEAN, so ISS-158's `-dirty` marker said
 * nothing: it measures GIT cleanliness, and `dist/` is gitignored.
 */
describe("an install refuses a tree older than the source it claims to carry", () => {
	it("refuses, naming the package and the lag", () => {
		const refusal = freshnessRefusal({
			state: "stale",
			packages: [{ id: "apps/refarm", staleBySeconds: 1142 }],
		});

		expect(refusal).toMatch(/apps\/refarm/u);
		expect(refusal).toMatch(/1142/u);
	});

	it("does not refuse a fresh tree", () => {
		// The negative control. Without it, "always refuse" passes every other test here.
		expect(freshnessRefusal({ state: "fresh", packages: [] })).toBeNull();
	});

	it("refuses when freshness cannot be read, never proceeding on unknown", () => {
		// Fails closed: a tree whose staleness could not be determined is not a fresh tree.
		expect(freshnessRefusal({ state: "unknown", packages: [] })).toMatch(/could not/iu);
	});

	it("reads staleness by CONTENT, so a rebuilt-but-identical dist is fresh", () => {
		// THE SECTION 4 TRAP. Deciding staleness with the same mtime comparison the installer
		// uses would inherit its blind spot. The property is "what ships differs from the
		// source", and a touched-but-unchanged file does not differ.
		const fresh = readTreeFreshness({
			packages: [{ id: "apps/refarm", srcDigest: "abc", distDigest: "abc", staleBySeconds: 900 }],
		});

		expect(fresh.state).toBe("fresh");
	});

	/**
	 * ADDED, NOT IN THE BRIEF VERBATIM — a MEASURED gap found while proving Step 6's mutation.
	 * The four tests above never send mismatched digests through `readTreeFreshness` itself: the
	 * "refuses, naming the package and the lag" test hand-builds a `{ state: "stale" }` value and
	 * never calls `readTreeFreshness`, and the CONTENT test above only feeds it EQUAL digests. So
	 * neutering `readTreeFreshness`'s `srcDigest !== distDigest` filter to `() => false` left all
	 * four green — the guard the brief's Step 6 names was not, in fact, exercised by it. This test
	 * closes that hole: it is the one that actually goes red under that mutation.
	 */
	it("marks a package stale when its digests differ, carrying the lag for the message", () => {
		const stale = readTreeFreshness({
			packages: [{ id: "apps/refarm", srcDigest: "abc", distDigest: "def", staleBySeconds: 1142 }],
		});

		expect(stale.state).toBe("stale");
		expect(stale.packages).toEqual([{ id: "apps/refarm", staleBySeconds: 1142 }]);
	});
});

/**
 * DIRECT `digestTree` COVERAGE OVER REAL DIRECTORIES.
 *
 * Every test above, and every fixture in `node-install.test.ts`, calls `digestTree` (or a
 * hand-fed stand-in string) on BOTH sides of a comparison — as the value that WRITES the stamp
 * and as the value that READS it back. A bug that makes `digestTree` non-recursive, blind to
 * content, or non-deterministic would satisfy every one of those unchanged, because both sides
 * call the same (possibly broken) function. This suite instead builds two REAL directory trees
 * on disk and asserts what `digestTree` reports about them directly — no self-generated stamp
 * on either side of any assertion here.
 */
describe("digestTree", () => {
	function tempDir(name: string): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), `refarm-digest-tree-${name}-`));
	}

	it("digests the same tree identically on repeat reads", () => {
		const dir = tempDir("stable");
		fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");

		expect(digestTree(dir)).toBe(digestTree(dir));
	});

	it("digests differently when a file's CONTENT differs, tree shape held equal", () => {
		const left = tempDir("content-left");
		const right = tempDir("content-right");
		fs.writeFileSync(path.join(left, "a.ts"), "export const a = 1;\n");
		fs.writeFileSync(path.join(right, "a.ts"), "export const a = 2;\n");

		expect(digestTree(left)).not.toBe(digestTree(right));
	});

	it("digests differently when a file's NAME differs, content held equal", () => {
		const left = tempDir("name-left");
		const right = tempDir("name-right");
		fs.writeFileSync(path.join(left, "a.ts"), "export const marker = 1;\n");
		fs.writeFileSync(path.join(right, "b.ts"), "export const marker = 1;\n");

		expect(digestTree(left)).not.toBe(digestTree(right));
	});

	it("is sensitive to a file nested in a subdirectory, proving it recurses", () => {
		const dir = tempDir("nested");
		fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
		const shallow = digestTree(dir);

		fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
		fs.writeFileSync(path.join(dir, "sub", "b.ts"), "export const b = 1;\n");
		const deep = digestTree(dir);

		expect(deep).not.toBe(shallow);
	});
});
