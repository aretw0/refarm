import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSessionReady, isFirstRun, refarmSearchDirs } from "./session-launch.js";

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
	const originalHome = process.env.HOME;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		cwdSpy.mockRestore();
	});

	it("returns true when neither home nor project-local .refarm exist", () => {
		expect(isFirstRun()).toBe(true);
	});

	it("returns false when project-local .refarm/config.json exists", () => {
		const tmpBase = join(tmpdir(), `refarm-test-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ provider: "anthropic" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(isFirstRun()).toBe(false);
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});

describe("refarmSearchDirs", () => {
	it("includes home dir and cwd-based dir", () => {
		const dirs = refarmSearchDirs();
		expect(dirs.some((d) => d.includes(".refarm"))).toBe(true);
		expect(dirs.length).toBeGreaterThanOrEqual(2);
	});
});
