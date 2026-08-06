import { describe, expect, it } from "vitest";
import { parseWorkspaceOffer, workspaceOfferPath } from "./workspace-declaration.js";

const COMMAND = { run: ["node", "x.mjs"], description: "d" };

describe("parseWorkspaceOffer", () => {
	it("accepts commands and execution", () => {
		const parsed = parseWorkspaceOffer({ commands: { build: COMMAND } });
		expect("offer" in parsed && parsed.offer.commands.build).toEqual(COMMAND);
	});

	it("REFUSES a workspaces map, naming the correct grammar", () => {
		const parsed = parseWorkspaceOffer({ workspaces: { other: { path: "/x" } } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) {
			expect(parsed.error).toMatch(/workspaces/);
			expect(parsed.error).toMatch(/node/i);
		}
	});

	it("refuses a workspaces map even alongside valid commands — partial acceptance would teach the wrong shape", () => {
		expect("error" in parseWorkspaceOffer({ commands: { build: COMMAND }, workspaces: {} })).toBe(true);
	});

	it("refuses a `path` key — where a workspace IS is the node's to say", () => {
		expect("error" in parseWorkspaceOffer({ path: "/somewhere", commands: {} })).toBe(true);
	});

	it("an empty declaration is valid — a workspace that offers nothing is not an error", () => {
		const parsed = parseWorkspaceOffer({});
		expect("offer" in parsed && parsed.offer.commands).toEqual({});
	});

	it("refuses a non-object", () => {
		expect("error" in parseWorkspaceOffer("nope")).toBe(true);
		expect("error" in parseWorkspaceOffer(null)).toBe(true);
	});
});

describe("workspaceOfferPath", () => {
	it("is workspace.json inside the workspace's sovereign dir, never config.json", () => {
		const p = workspaceOfferPath("/home/op/github/refarm");
		expect(p).toContain("workspace.json");
		expect(p).not.toContain("config.json");
	});
});
