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

describe("parseWorkspaceOffer — command shape validation", () => {
	it("refuses a missing `run`", () => {
		const parsed = parseWorkspaceOffer({ commands: { "vpn-up-safe": { description: "d" } } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) {
			expect(parsed.error).toMatch(/vpn-up-safe/);
			expect(parsed.error).toMatch(/"run"/);
		}
	});

	it("refuses `run` as a string instead of an array, naming the command", () => {
		const parsed = parseWorkspaceOffer({ commands: { "vpn-up-safe": { run: "node x.mjs" } } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) {
			expect(parsed.error).toMatch(/command "vpn-up-safe"/);
			expect(parsed.error).toMatch(/"run" must be a non-empty array of strings/);
			expect(parsed.error).toMatch(/found "node x\.mjs"/);
		}
	});

	it("refuses an empty `run` array", () => {
		expect("error" in parseWorkspaceOffer({ commands: { build: { run: [] } } })).toBe(true);
	});

	it("refuses a `run` array with a non-string element", () => {
		expect("error" in parseWorkspaceOffer({ commands: { build: { run: ["node", 1] } } })).toBe(true);
	});

	it("refuses an unrecognized key inside a command entry", () => {
		const parsed = parseWorkspaceOffer({ commands: { build: { run: ["node"], bogus: true } } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) expect(parsed.error).toMatch(/"bogus"/);
	});

	it("refuses a non-string `cwd`", () => {
		expect("error" in parseWorkspaceOffer({ commands: { build: { run: ["node"], cwd: 1 } } })).toBe(true);
	});

	it("refuses a non-string `description`", () => {
		expect(
			"error" in parseWorkspaceOffer({ commands: { build: { run: ["node"], description: 1 } } }),
		).toBe(true);
	});

	it("refuses `remote` that is not exactly true", () => {
		expect(
			"error" in parseWorkspaceOffer({ commands: { build: { run: ["node"], remote: "true" } } }),
		).toBe(true);
		expect("error" in parseWorkspaceOffer({ commands: { build: { run: ["node"], remote: 1 } } })).toBe(
			true,
		);
	});

	it('refuses `result` that is not exactly "operation-result.v1"', () => {
		expect(
			"error" in parseWorkspaceOffer({ commands: { build: { run: ["node"], result: "v2" } } }),
		).toBe(true);
	});

	it("refuses an unrecognized key inside `execution`", () => {
		const parsed = parseWorkspaceOffer({ execution: { bogus: "x" } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) expect(parsed.error).toMatch(/"bogus"/);
	});

	it("refuses a non-string `execution.preferredAdapter`", () => {
		expect("error" in parseWorkspaceOffer({ execution: { preferredAdapter: 1 } })).toBe(true);
	});

	it("accepts a fully-formed command with every optional field present", () => {
		const full = {
			run: ["node", "x.mjs"],
			cwd: "scripts",
			description: "d",
			remote: true as const,
			result: "operation-result.v1" as const,
		};
		const parsed = parseWorkspaceOffer({
			commands: { build: full },
			execution: { preferredAdapter: "turbo" },
		});
		expect("offer" in parsed).toBe(true);
		if ("offer" in parsed) {
			expect(parsed.offer.commands.build).toEqual(full);
			expect(parsed.offer.execution).toEqual({ preferredAdapter: "turbo" });
		}
	});
});

describe("workspaceOfferPath", () => {
	it("is workspace.json inside the workspace's sovereign dir, never config.json", () => {
		const p = workspaceOfferPath("/home/op/github/refarm");
		expect(p).toContain("workspace.json");
		expect(p).not.toContain("config.json");
	});
});
