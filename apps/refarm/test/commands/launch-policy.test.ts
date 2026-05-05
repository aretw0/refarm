import { describe, expect, it } from "vitest";
import {
	assertLaunchAllowed,
	resolveLaunchMode,
} from "../../src/commands/launch-policy.js";

function makeStatus(overrides?: Partial<any>) {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless",
			capabilities: ["diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: 0,
			critical: 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
		...overrides,
	};
}

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

describe("assertLaunchAllowed", () => {
	it("does not throw when there are no failure diagnostics", () => {
		expect(() =>
			assertLaunchAllowed(makeStatus(), "web runtime"),
		).not.toThrow();
	});

	it("throws when status includes launch-blocking diagnostics", () => {
		const status = makeStatus({ diagnostics: ["runtime:not-ready"] });
		expect(() => assertLaunchAllowed(status, "web runtime")).toThrow(
			/Cannot launch web runtime due status failures: runtime:not-ready/,
		);
	});
});
