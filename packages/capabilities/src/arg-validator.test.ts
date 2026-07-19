import { describe, expect, it } from "vitest";

import { validateCapabilityArgs } from "./arg-validator.js";
import type { CapabilityArgSpec, CapabilityOptionSpec } from "./types.js";

const args: CapabilityArgSpec[] = [
	{ name: "query", required: true, type: "string" },
	{ name: "limit", type: "integer" },
];
const options: CapabilityOptionSpec[] = [
	{ name: "mode", kind: "string", summary: "search mode", enum: ["fast", "deep"] },
	{ name: "verbose", kind: "boolean", summary: "verbose output" },
];
const searchVerb = { args, options };

describe("validateCapabilityArgs — one derived schema, enforced on every surface", () => {
	it("accepts valid input, coercing string form values to the schema types", () => {
		const result = validateCapabilityArgs(searchVerb, { query: "reqs", limit: "5", verbose: "true" });
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("flags a missing required arg by name", () => {
		const result = validateCapabilityArgs(searchVerb, { limit: "5" });
		expect(result.valid).toBe(false);
		expect(result.errors).toContainEqual({ field: "query", message: "is required" });
	});

	it("flags a type mismatch scoped to the field (integer arg given a non-number)", () => {
		const result = validateCapabilityArgs(searchVerb, { query: "x", limit: "not-a-number" });
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.field === "limit" && /integer/.test(e.message))).toBe(true);
	});

	it("flags an out-of-enum value on an option", () => {
		const result = validateCapabilityArgs(searchVerb, { query: "x", mode: "nope" });
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.field === "mode")).toBe(true);
	});

	it("does not mutate the caller's input (coercion runs on a copy)", () => {
		const input: Record<string, unknown> = { query: "x", limit: "5" };
		validateCapabilityArgs(searchVerb, input);
		expect(input.limit).toBe("5"); // still the original string, not coerced to 5
	});

	it("a descriptor with no args/options accepts any input", () => {
		expect(validateCapabilityArgs({}, { anything: "goes" }).valid).toBe(true);
	});
});
