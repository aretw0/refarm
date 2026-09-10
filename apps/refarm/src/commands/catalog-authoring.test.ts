import { describe, expect, it } from "vitest";

import { mergePreservingUnowned } from "./catalog-authoring.js";

// ISS-036. `workspace add --replace` rebuilt the entry from the four fields it knows and dropped
// everything else, which on the operator's real node is rcdc5's declared `vpn` and
// `code-boundaries` commands — a block `workspace sync` cannot restore. It appeared in the consent
// diff, so it was never silent; it was merely easy to authorise while reading the fields you came
// to change.
//
// Proven HERE, on the pure plan builder, and not through a CLI round trip: `workspace add` refuses
// to run unattended by design (CLAUDE.md section 8 — consent at the point where it can still be
// interrupted), so a harness driving the real binary cannot exercise it at all. A first attempt at
// one reported "preserved" for a run in which the writer never wrote, and was deleted rather than
// kept.
describe("a writer replaces what it owns and keeps what it was not asked about (ISS-036)", () => {
	const previous = {
		path: "/w",
		kind: "consumer",
		execution: { preferredAdapter: "auto" },
		commands: { vpn: { run: ["echo"] }, "code-boundaries": { run: ["echo"] } },
	};
	const next = { path: "/w", kind: "project", execution: { preferredAdapter: "auto" } };
	const OWNED = ["path", "kind", "execution", "repository"];

	it("keeps a declaration the writer does not own", () => {
		const merged = mergePreservingUnowned(previous, next, OWNED);
		expect(merged.commands).toEqual(previous.commands);
	});

	it("still replaces the keys it does own", () => {
		expect(mergePreservingUnowned(previous, next, OWNED).kind).toBe("project");
	});

	it("removes an owned key the writer did not supply this time", () => {
		const withRepo = { ...previous, repository: { url: "git@old" } };
		expect("repository" in mergePreservingUnowned(withRepo, next, OWNED)).toBe(false);
	});

	it("keeps the previous key ORDER, so a preserved declaration is not relocated in the diff", () => {
		expect(Object.keys(mergePreservingUnowned(previous, next, OWNED))).toEqual(Object.keys(previous));
	});

	it("without ownedKeys it is a full replace, which is right for a wholly-defined entry", () => {
		expect(mergePreservingUnowned(previous, next)).toEqual(next);
	});

	it("a brand-new entry is written as-is", () => {
		expect(mergePreservingUnowned(undefined, next, OWNED)).toEqual(next);
	});
});
