import { describe, expect, it } from "vitest";
import {
	assertLaunchAllowed,
	type LaunchRecoveryHints,
	resolveLaunchReadiness,
} from "./launch-policy.js";
import type { StatusJson } from "./status.js";

// ADR-087: the package names no binary; the caller supplies the recovery hints.
// The test supplies refarm's so the asserted messages match the app's behavior.
const HINTS: LaunchRecoveryHints = {
	runtimeNotReadyHint:
		" Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`.",
	doctorNextActionCommand: "refarm doctor --next-action",
	runtimeNotReadyCommands: [
		"refarm runtime ensure --wait --next-command",
		"refarm doctor --next-command",
	],
};

type TestStatus = StatusJson;

function makeStatusBase(): StatusJson {
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

function makeStatus(overrides: Partial<TestStatus> = {}): StatusJson {
	return {
		...makeStatusBase(),
		...overrides,
	};
}

describe("assertLaunchAllowed", () => {
	it("resolves launch readiness and recovery commands without throwing", () => {
		expect(
			resolveLaunchReadiness(
				makeStatus({ diagnostics: ["runtime:not-ready"] }),
				"web runtime",
				HINTS,
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
		expect(() => assertLaunchAllowed(status, "web runtime", HINTS)).toThrow(
			/Cannot launch web runtime due status failures: runtime:not-ready\. Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`\./,
		);
	});

	it("points non-runtime launch failures at doctor", () => {
		const status = makeStatus({ diagnostics: ["trust:critical-present"] });
		expect(() => assertLaunchAllowed(status, "web runtime", HINTS)).toThrow(
			/Cannot launch web runtime due status failures: trust:critical-present\. Run `refarm doctor --next-action` for the next recovery action\./,
		);
	});
});
