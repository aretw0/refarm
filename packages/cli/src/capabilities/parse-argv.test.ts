import { describe, expect, it } from "vitest";
import { buildJsonSuccessEnvelope } from "../json-output.js";
import { parseCapabilityArgv } from "./parse-argv.js";
import type { CapabilityDescriptor } from "./types.js";

// Mirrors the extension review arg shape: one required positional, a repeatable
// --grant, a --policy with a default, and the implicit --json.
const REVIEW: CapabilityDescriptor = {
	name: "review",
	summary: "review",
	args: [{ name: "path", required: true }],
	options: [
		{ name: "grant", kind: "string[]", summary: "grant a capability" },
		{
			name: "policy",
			kind: "string",
			summary: "policy mode",
			defaultValue: "fail-fast",
		},
	],
	run: () => buildJsonSuccessEnvelope({ command: "extension", operation: "review" }),
};

describe("parseCapabilityArgv", () => {
	it("parses positional + repeatable option + default + json", () => {
		const input = parseCapabilityArgv(REVIEW, [
			"./p",
			"--grant",
			"storage:v1",
			"--grant",
			"network:v1",
			"--json",
		]);
		expect(input).toEqual({
			args: { path: "./p" },
			options: { grant: ["storage:v1", "network:v1"], policy: "fail-fast" },
			json: true,
		});
	});

	it("applies the declared default when a flag is absent", () => {
		const input = parseCapabilityArgv(REVIEW, ["./p"]);
		expect(input.options.policy).toBe("fail-fast");
		expect(input.options.grant).toEqual([]);
		expect(input.json).toBe(false);
	});

	it("accepts --opt=value form", () => {
		const input = parseCapabilityArgv(REVIEW, ["./p", "--policy=warn+continue"]);
		expect(input.options.policy).toBe("warn+continue");
	});

	it("throws on an unknown option", () => {
		expect(() => parseCapabilityArgv(REVIEW, ["./p", "--frob"])).toThrow(
			"Unknown option: --frob",
		);
	});

	it("throws when a string option is missing its value", () => {
		expect(() => parseCapabilityArgv(REVIEW, ["./p", "--policy"])).toThrow(
			"requires a value",
		);
	});

	it("throws on a missing required positional", () => {
		expect(() => parseCapabilityArgv(REVIEW, ["--json"])).toThrow(
			"Missing required argument: path",
		);
	});

	it("collects a trailing variadic positional", () => {
		const variadic: CapabilityDescriptor = {
			name: "grantall",
			summary: "x",
			args: [{ name: "caps", variadic: true }],
			run: () => buildJsonSuccessEnvelope({ command: "x", operation: "y" }),
		};
		const input = parseCapabilityArgv(variadic, ["a", "b", "c"]);
		expect(input.args.caps).toEqual(["a", "b", "c"]);
	});
});
