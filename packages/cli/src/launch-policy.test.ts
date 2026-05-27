import { describe, expect, it } from "vitest";
import {
	assertLaunchAllowed,
	REFARM_RUNTIME_STATUS_COMMAND,
	RUNTIME_STATUS_COMMAND,
	resolveLaunchReadiness,
} from "./launch-policy.js";
import type { RefarmStatusJson } from "./status.js";

type TestStatus = RefarmStatusJson;

function makeStatusBase(): RefarmStatusJson {
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
	};
}

function makeStatus(overrides: Partial<TestStatus> = {}): RefarmStatusJson {
	return {
		...makeStatusBase(),
		...overrides,
	};
}

describe("assertLaunchAllowed", () => {
	it("keeps Refarm command aliases compatible with agnostic names", () => {
		expect(REFARM_RUNTIME_STATUS_COMMAND).toBe(RUNTIME_STATUS_COMMAND);
	});

	it("resolves launch readiness and recovery commands without throwing", () => {
		expect(
			resolveLaunchReadiness(
				makeStatus({ diagnostics: ["runtime:not-ready"] }),
				"web runtime",
			),
		).toMatchObject({
			readyToExecute: false,
			failures: ["runtime:not-ready"],
			recoveryCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
		});
	});

	it("does not throw when there are no failure diagnostics", () => {
		expect(() =>
			assertLaunchAllowed(makeStatus(), "web runtime"),
		).not.toThrow();
	});

	it("throws when status includes launch-blocking diagnostics", () => {
		const status = makeStatus({ diagnostics: ["runtime:not-ready"] });
		expect(() => assertLaunchAllowed(status, "web runtime")).toThrow(
			/Cannot launch web runtime due status failures: runtime:not-ready\. Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`\./,
		);
	});

	it("points non-runtime launch failures at doctor", () => {
		const status = makeStatus({ diagnostics: ["trust:critical-present"] });
		expect(() => assertLaunchAllowed(status, "web runtime")).toThrow(
			/Cannot launch web runtime due status failures: trust:critical-present\. Run `refarm doctor --next-action` for the next recovery action\./,
		);
	});
});
