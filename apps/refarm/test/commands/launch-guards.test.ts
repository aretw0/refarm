import { describe, expect, it } from "vitest";
import { assertLaunchGuardOptions } from "../../src/commands/launch-guards.js";

describe("assertLaunchGuardOptions", () => {
	it("rejects --json with --markdown", () => {
		expect(() =>
			assertLaunchGuardOptions({ json: true, markdown: true }),
		).toThrow(/Choose only one output format/);
	});

	it("rejects --launch combined with --json", () => {
		expect(() =>
			assertLaunchGuardOptions({ launch: true, json: true }),
		).toThrow(/cannot be combined/);
	});

	it("rejects --dry-run without --launch", () => {
		expect(() =>
			assertLaunchGuardOptions({ dryRun: true, launch: false }),
		).toThrow(/--dry-run requires --launch/);
	});

	it("rejects custom required flag when --launch is missing", () => {
		expect(() =>
			assertLaunchGuardOptions({
				launch: false,
				requiresLaunch: [{ enabled: true, flag: "--open" }],
			}),
		).toThrow(/--open requires --launch/);
	});

	it("allows valid launch combinations", () => {
		expect(() =>
			assertLaunchGuardOptions({
				launch: true,
				dryRun: true,
				requiresLaunch: [{ enabled: true, flag: "--open" }],
			}),
		).not.toThrow();
	});
});
