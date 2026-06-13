import { describe, expect, it } from "vitest";
import {
	resolveLaunchMode,
} from "../../src/commands/launch-policy.js";

describe("resolveLaunchMode", () => {
	it("returns a valid launcher mode when allowed", () => {
		const mode = resolveLaunchMode("preview", ["dev", "preview"] as const);
		expect(mode).toBe("preview");
	});

	it("rejects invalid launcher mode with explicit message", () => {
		expect(() =>
			resolveLaunchMode("invalid", ["watch", "prompt"] as const),
		).toThrow(/Invalid --launcher value/);
	});
});
