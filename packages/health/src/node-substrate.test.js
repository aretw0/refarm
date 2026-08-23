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

/**
 * ISS-159. An installed node AGES, and until 2026-08-23 nothing said by how much.
 *
 * The operator's node ran `0.1.0-5b4810a9` while his checkout moved ten commits past it, and every
 * surface was silent — `describeSubstrate` returned null for `installed` because that was the goal
 * state and had nothing to explain. Reaching the goal state is not the end of the question: an
 * intentional update cycle needs a trigger, and the trigger is this comparison.
 */
const readsIdentity = (byDirectory) => (directory) => byDirectory[directory] ?? null;

const IDENTITY = {
	label: "0.1.0-5b4810a9",
	version: "0.1.0",
	commit: "5b4810a9",
	checkout: { dirty: false, because: "the checkout matched its commit." },
	installedAt: "2026-08-19T23:26:01.000Z",
};

describe("an installed node says which build it is", () => {
	it("carries the identity its tree recorded, found by walking up from the entrypoint", () => {
		const substrate = readNodeSubstrate(
			"/home/op/.local/lib/refarm/0.1.0-5b4810a9/dist/index.js",
			isDir([]),
			readsIdentity({ "/home/op/.local/lib/refarm/0.1.0-5b4810a9": IDENTITY }),
		);
		expect(substrate.kind).toBe("installed");
		expect(substrate.identity).toEqual(IDENTITY);
	});

	it("is still installed, and silent, when the tree predates identity records", () => {
		// Every tree assembled before 2026-08-23 has no such file, and that is not a fault.
		const substrate = readNodeSubstrate("/usr/local/lib/refarm/index.js", isDir([]), readsIdentity({}));
		expect(substrate).toEqual({ kind: "installed", executes: "/usr/local/lib/refarm/index.js" });
		expect(describeSubstrate(substrate, "f58c6d00")).toBeNull();
	});

	it("says the checkout has moved on, naming both ends", () => {
		const substrate = { kind: "installed", executes: "/x/dist/index.js", identity: IDENTITY };
		const text = describeSubstrate(substrate, "f58c6d00");
		expect(text).toContain("5b4810a9");
		expect(text).toContain("f58c6d00");
	});

	it("SAYS NOTHING when the node already runs what the checkout has", () => {
		// The trap this repository just spent a session removing, in its other direction: a line
		// that is always there is a line nobody reads, and it would bury the one that matters.
		const substrate = { kind: "installed", executes: "/x/dist/index.js", identity: IDENTITY };
		expect(describeSubstrate(substrate, "5b4810a9")).toBeNull();
	});

	it("says a dirty build is described by NO commit, even when the commits match", () => {
		const dirty = {
			...IDENTITY,
			label: "0.1.0-5b4810a9-dirty",
			checkout: { dirty: true, because: "the checkout held 4 uncommitted change(s) this commit does not have." },
		};
		const text = describeSubstrate(
			{ kind: "installed", executes: "/x/dist/index.js", identity: dirty },
			"5b4810a9",
		);
		expect(text).toMatch(/uncommitted|no commit/iu);
		expect(text).toContain("0.1.0-5b4810a9-dirty");
	});

	it("says nothing when there is no checkout to compare against", () => {
		// A node on a phone or a Raspberry Pi has no repository beside it. Silence is the honest
		// answer there — not "up to date", which would be a claim nothing measured.
		const substrate = { kind: "installed", executes: "/x/dist/index.js", identity: IDENTITY };
		expect(describeSubstrate(substrate, null)).toBeNull();
	});

	it("names no CLI verb — the handoff belongs where every other one is rendered", () => {
		const substrate = { kind: "installed", executes: "/x/dist/index.js", identity: IDENTITY };
		expect(describeSubstrate(substrate, "f58c6d00")).not.toMatch(/refarm /u);
	});
});

