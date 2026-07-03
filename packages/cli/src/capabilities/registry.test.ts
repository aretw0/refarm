import { describe, expect, it } from "vitest";
import { buildJsonSuccessEnvelope } from "../json-output.js";
import { CapabilityRegistry } from "./registry.js";
import type { CapabilityDescriptor } from "./types.js";

function descriptor(
	name: string,
	overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
	return {
		name,
		summary: `${name} summary`,
		run: () =>
			buildJsonSuccessEnvelope({ command: name, operation: "run" }),
		...overrides,
	};
}

describe("CapabilityRegistry", () => {
	it("registers and looks up by lowercased name", () => {
		const registry = new CapabilityRegistry();
		registry.register(descriptor("Review"));
		expect(registry.has("review")).toBe(true);
		expect(registry.has("REVIEW")).toBe(true);
		expect(registry.get("review")?.name).toBe("Review");
		expect(registry.has("unknown")).toBe(false);
	});

	it("registers and resolves slash aliases to one descriptor", () => {
		const registry = new CapabilityRegistry();
		const check = descriptor("check", {
			transports: { repl: { slashAliases: ["c"] } },
		});
		registry.register(check);
		expect(registry.get("c")).toBe(check);
		expect(registry.list()).toHaveLength(1);
	});

	it("refuses a name that collides with a reserved built-in", () => {
		const registry = new CapabilityRegistry(["model", "reload"]);
		expect(() => registry.register(descriptor("model"))).toThrow(
			"collides with a built-in",
		);
	});

	it("refuses a duplicate registration", () => {
		const registry = new CapabilityRegistry();
		registry.register(descriptor("review"));
		expect(() => registry.register(descriptor("review"))).toThrow(
			"already registered",
		);
	});

	it("refuses when a slash alias collides with a reserved built-in", () => {
		const registry = new CapabilityRegistry(["r"]);
		expect(() =>
			registry.register(
				descriptor("review", {
					transports: { repl: { slashAliases: ["r"] } },
				}),
			),
		).toThrow("collides with a built-in");
	});
});
