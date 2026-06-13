import { describe, expect, it } from "vitest";
import {
	assertLaunchGuardOptions,
	resolveLaunchGuardError,
} from "../../src/commands/launch-guards.js";

describe("assertLaunchGuardOptions", () => {
	it("rejects --json with --markdown", () => {
		expect(() =>
			assertLaunchGuardOptions({ json: true, markdown: true }),
		).toThrow(/Choose only one output format/);
	});

	it("rejects --launch combined with --json", () => {
		expect(() =>
			assertLaunchGuardOptions({ launch: true, json: true }),
		).toThrow(/requires --dry-run/);
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

	it("allows machine-readable launch dry-runs", () => {
		expect(() =>
			assertLaunchGuardOptions({
				launch: true,
				dryRun: true,
				json: true,
			}),
		).not.toThrow();
	});
});

describe("resolveLaunchGuardError", () => {
	it("returns structured guard errors without throwing", () => {
		expect(resolveLaunchGuardError({ launch: true, json: true })).toEqual({
			code: "launch-json-requires-dry-run",
			message: "--launch --json requires --dry-run.",
		});
		expect(
			resolveLaunchGuardError({
				requiresLaunch: [{ enabled: true, flag: "--open" }],
			}),
		).toEqual({
			code: "flag-requires-launch",
			message: "--open requires --launch.",
			flag: "--open",
		});
	});

	it("returns null for valid guard combinations", () => {
		expect(resolveLaunchGuardError({ launch: true, dryRun: true, json: true })).toBeNull();
	});
});
