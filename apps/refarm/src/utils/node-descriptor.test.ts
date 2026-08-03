import { describe, expect, it } from "vitest";

import { NODE_DESCRIPTOR_WIRE, readNodeDescriptor } from "./node-descriptor.js";

const LIVE = () => undefined;
const DEAD = () => {
	throw new Error("ESRCH");
};

function descriptor(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		wire: NODE_DESCRIPTOR_WIRE,
		declarationBase: "/home/op",
		sovereignDir: ".refarm",
		pid: 4242,
		startedAt: "2026-08-03T02:11:04Z",
		...overrides,
	});
}

describe("readNodeDescriptor", () => {
	it("reports the base the RUNNING node resolves against", () => {
		const read = readNodeDescriptor("/home/op/.refarm", {
			readFile: () => descriptor(),
			kill: LIVE,
		});
		expect(read?.declarationBase).toBe("/home/op");
		expect(read?.pid).toBe(4242);
	});

	it("refuses a descriptor whose process is gone", () => {
		// A file outlives its writer. Reporting a dead node's base as the live one would be
		// the same lie the declared-base work exists to remove — introducing it here, in the
		// thing built to expose it, would be perverse.
		expect(readNodeDescriptor("/home/op/.refarm", { readFile: () => descriptor(), kill: DEAD })).toBeNull();
	});

	it("refuses a wire it does not understand rather than guessing at the fields", () => {
		const read = readNodeDescriptor("/home/op/.refarm", {
			readFile: () => descriptor({ wire: "node-descriptor.v2" }),
			kill: LIVE,
		});
		expect(read).toBeNull();
	});

	it("says nothing when the node said nothing, or said it badly", () => {
		// Absent, unreadable and malformed are one answer: this node does not say. The caller
		// then falls back to what it can compute locally, which is what it did before.
		const missing = () => {
			throw new Error("ENOENT");
		};
		expect(readNodeDescriptor("/x", { readFile: missing, kill: LIVE })).toBeNull();
		expect(readNodeDescriptor("/x", { readFile: () => "not json", kill: LIVE })).toBeNull();
		expect(readNodeDescriptor("/x", { readFile: () => "null", kill: LIVE })).toBeNull();
	});

	it("refuses a descriptor missing the fact it exists to carry", () => {
		for (const broken of [{ declarationBase: "" }, { sovereignDir: "" }, { pid: 0 }, { pid: 1.5 }]) {
			expect(
				readNodeDescriptor("/x", { readFile: () => descriptor(broken), kill: LIVE }),
			).toBeNull();
		}
	});
});
