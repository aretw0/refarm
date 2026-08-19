import { describe, expect, it } from "vitest";

import { describeSubstrate, readNodeSubstrate } from "./node-substrate.js";

/**
 * MEASURED 2026-08-19, chasing why a node did not come back after a reboot:
 *
 *   systemd unit → ~/.local/bin/refarm → ~/github/refarm/apps/refarm/dist/index.js
 *
 * The operator's supervised services execute the development repo's build output, and the unit
 * names a path under `~/.local/bin`, so nothing about it looks that way. A build rewrites what
 * runs; a branch switch changes it silently; and a backup restores a node with no code.
 *
 * Running the working tree is the fastest loop and is not the defect. The defect is that nothing
 * SAYS the two are the same thing.
 */
const isDir = (paths) => (candidate) => paths.includes(candidate);

describe("readNodeSubstrate", () => {
	it("names a WORKING TREE when the executed code sits inside a git repository", () => {
		const substrate = readNodeSubstrate(
			"/home/op/github/refarm/apps/refarm/dist/index.js",
			isDir(["/home/op/github/refarm/.git"]),
		);
		expect(substrate).toEqual({
			kind: "working-tree",
			executes: "/home/op/github/refarm/apps/refarm/dist/index.js",
			repository: "/home/op/github/refarm",
		});
	});

	it("names an INSTALLED substrate when no git tree encloses it", () => {
		expect(readNodeSubstrate("/usr/local/lib/refarm/index.js", isDir([]))).toEqual({
			kind: "installed",
			executes: "/usr/local/lib/refarm/index.js",
		});
	});

	it("finds the repository even when the code is many directories deep", () => {
		const substrate = readNodeSubstrate(
			"/home/op/src/farm/a/b/c/d/index.js",
			isDir(["/home/op/src/farm/.git"]),
		);
		expect(substrate.kind).toBe("working-tree");
		expect(substrate.repository).toBe("/home/op/src/farm");
	});

	it("says UNKNOWN rather than guessing when the process cannot name its own code", () => {
		// A node that cannot say what it runs must not report `installed` — that is the reassuring
		// answer, and it would be reassuring about something nothing measured.
		expect(readNodeSubstrate(undefined, isDir([])).kind).toBe("unknown");
		expect(readNodeSubstrate("   ", isDir([])).kind).toBe("unknown");
	});

	it("stops at the filesystem root instead of walking forever", () => {
		expect(readNodeSubstrate("/index.js", isDir([])).kind).toBe("installed");
	});
});

describe("describeSubstrate", () => {
	it("says nothing for an installed node, which needs no explanation", () => {
		expect(describeSubstrate({ kind: "installed", executes: "/usr/local/lib/refarm/index.js" })).toBeNull();
	});

	it("names the repository and what depends on it staying there", () => {
		const text = describeSubstrate({
			kind: "working-tree",
			executes: "/home/op/github/refarm/apps/refarm/dist/index.js",
			repository: "/home/op/github/refarm",
		});
		expect(text).toContain("/home/op/github/refarm");
		// The three consequences an operator can act on, not a vague warning.
		expect(text).toMatch(/build/iu);
		expect(text).toMatch(/branch/iu);
		expect(text).toMatch(/backup|restore/iu);
	});

	it("says an unknown substrate is unknown, and does not call it a fault", () => {
		expect(describeSubstrate({ kind: "unknown" })).toMatch(/could not/iu);
	});

	it("names no CLI verb, so any surface can render it", () => {
		const text = describeSubstrate({
			kind: "working-tree",
			executes: "/x/apps/refarm/dist/index.js",
			repository: "/x",
		});
		expect(text).not.toMatch(/refarm /u);
	});
});
