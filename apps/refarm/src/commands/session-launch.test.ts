import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isSessionReady, isFirstRun } from "./session-launch.js";

describe("isSessionReady", () => {
	it("returns true when both provider and farmhand are ready", () => {
		expect(
			isSessionReady({ providerConfigured: true, farmhandRunning: true }),
		).toBe(true);
	});

	it("returns false when farmhand is not running", () => {
		expect(
			isSessionReady({ providerConfigured: true, farmhandRunning: false }),
		).toBe(false);
	});

	it("returns false when provider is not configured", () => {
		expect(
			isSessionReady({ providerConfigured: false, farmhandRunning: true }),
		).toBe(false);
	});

	it("returns false when neither is ready", () => {
		expect(
			isSessionReady({ providerConfigured: false, farmhandRunning: false }),
		).toBe(false);
	});
});

describe("isFirstRun", () => {
	const originalEnv = process.env.HOME;

	beforeEach(() => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
	});

	afterEach(() => {
		process.env.HOME = originalEnv;
	});

	it("returns true when ~/.refarm does not exist", () => {
		expect(isFirstRun()).toBe(true);
	});
});
