import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isSessionReady,
	isFirstRun,
	refarmSearchDirs,
	autoStartFarmhand,
	readAutostartMode,
	type LaunchDeps,
} from "./session-launch.js";

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

function makeLaunchDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
	return {
		confirm: vi.fn().mockResolvedValue(true),
		spawnFarmhand: vi.fn(),
		probeFarmhandUntilReady: vi.fn().mockResolvedValue(true),
		...overrides,
	};
}

describe("autoStartFarmhand — mode: ask (default)", () => {
	it("returns true when user confirms and farmhand becomes ready", async () => {
		const deps = makeLaunchDeps();
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(true);
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false and does not spawn when user declines", async () => {
		const deps = makeLaunchDeps({ confirm: vi.fn().mockResolvedValue(false) });
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnFarmhand).not.toHaveBeenCalled();
	});

	it("returns false when farmhand times out after spawning", async () => {
		const deps = makeLaunchDeps({
			probeFarmhandUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnFarmhand).toHaveBeenCalledOnce();
	});

	it("passes the repo root to spawnFarmhand", async () => {
		const deps = makeLaunchDeps();
		await autoStartFarmhand("/my/repo", deps);
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/my/repo");
	});
});

describe("autoStartFarmhand — mode: always", () => {
	it("spawns without asking when autostartMode is always", async () => {
		const deps = makeLaunchDeps({ autostartMode: "always" });
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(true);
		expect(deps.confirm).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false when farmhand times out even in always mode", async () => {
		const deps = makeLaunchDeps({
			autostartMode: "always",
			probeFarmhandUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.confirm).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).toHaveBeenCalledOnce();
	});
});

describe("autoStartFarmhand — mode: never", () => {
	it("returns false immediately without asking or spawning", async () => {
		const deps = makeLaunchDeps({ autostartMode: "never" });
		const result = await autoStartFarmhand("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.confirm).not.toHaveBeenCalled();
		expect(deps.spawnFarmhand).not.toHaveBeenCalled();
	});
});

describe("readAutostartMode", () => {
	const originalHome = process.env.HOME;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		cwdSpy.mockRestore();
	});

	it("returns 'ask' when no config file exists", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		expect(readAutostartMode()).toBe("ask");
	});

	it("returns 'always' when config.autostart is always", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "always" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("always");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("returns 'never' when config.autostart is never", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "never" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("never");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("returns 'ask' when config.autostart has an unrecognized value", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "maybe" }));
		cwdSpy.mockReturnValue(tmpBase);

		try {
			expect(readAutostartMode()).toBe("ask");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});
