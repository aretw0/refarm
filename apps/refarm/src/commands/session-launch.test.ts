import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isSessionReady,
	isRuntimeRunning,
	isFirstRun,
	refarmSearchDirs,
	checkSessionReadiness,
	autoStartRuntime,
	readAutostartMode,
	readTractorEngineMode,
	resolveLaunchRuntime,
	printSessionGuide,
	type LaunchDeps,
} from "./session-launch.js";

let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	stdoutWriteSpy.mockRestore();
	stderrWriteSpy.mockRestore();
	consoleErrorSpy.mockRestore();
});

describe("isSessionReady", () => {
	it("returns true when both provider and farmhand are ready", () => {
		expect(
			isSessionReady({ providerConfigured: true, farmhandRunning: true }),
		).toBe(true);
	});

	it("uses runtimeRunning as the canonical readiness field", () => {
		expect(
			isSessionReady({ providerConfigured: true, runtimeRunning: true }),
		).toBe(true);
		expect(
			isRuntimeRunning({
				providerConfigured: true,
				runtimeRunning: false,
				farmhandRunning: true,
			}),
		).toBe(false);
	});

	it("returns false when the runtime is not running", () => {
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
		delete process.env.REFARM_FARMHAND_AUTOSTART;
		delete process.env.REFARM_RUNTIME_AUTOSTART;
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

	it("returns false when a Silo identity exists", () => {
		const tmpBase = join(tmpdir(), `refarm-test-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(
			join(refarmDir, "identity.json"),
			JSON.stringify({ tokens: { modelProvider: "openai" } }),
		);
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

describe("checkSessionReadiness", () => {
	const originalHome = process.env.HOME;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		cwdSpy.mockRestore();
		vi.unstubAllGlobals();
	});

	it("recognizes MODEL_DEFAULT_PROVIDER as a configured provider", async () => {
		process.env.MODEL_DEFAULT_PROVIDER = "openai";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		await expect(checkSessionReadiness()).resolves.toMatchObject({
			providerConfigured: true,
			runtimeRunning: false,
			farmhandRunning: false,
		});
	});

	it("recognizes a Silo identity as a configured provider", async () => {
		const tmpBase = join(tmpdir(), `refarm-readiness-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(
			join(refarmDir, "identity.json"),
			JSON.stringify({ tokens: { modelProvider: "openai" } }),
		);
		cwdSpy.mockReturnValue(tmpBase);
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		try {
			await expect(checkSessionReadiness()).resolves.toMatchObject({
				providerConfigured: true,
				runtimeRunning: false,
				farmhandRunning: false,
			});
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("recognizes modelProvider in config.json as a configured provider", async () => {
		const tmpBase = join(tmpdir(), `refarm-readiness-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(
			join(refarmDir, "config.json"),
			JSON.stringify({ modelProvider: "openai" }),
		);
		cwdSpy.mockReturnValue(tmpBase);
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

		try {
			await expect(checkSessionReadiness()).resolves.toMatchObject({
				providerConfigured: true,
				runtimeRunning: false,
				farmhandRunning: false,
			});
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});

function makeLaunchDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
	return {
		operator: createScriptedOperatorChannel([true]),
		spawnRuntime: vi.fn(),
		probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		...overrides,
	};
}

describe("autoStartRuntime — mode: ask (default)", () => {
	it("returns true when user confirms and runtime becomes ready", async () => {
		const deps = makeLaunchDeps();
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(true);
		expect(deps.spawnRuntime).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false and does not spawn when user declines", async () => {
		const deps = makeLaunchDeps({ operator: createScriptedOperatorChannel([false]) });
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnRuntime).not.toHaveBeenCalled();
	});

	it("returns false when runtime times out after spawning", async () => {
		const deps = makeLaunchDeps({
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(false);
		expect(deps.spawnRuntime).toHaveBeenCalledOnce();
	});

	it("passes the repo root to spawnRuntime", async () => {
		const deps = makeLaunchDeps();
		await autoStartRuntime("/my/repo", deps);
		expect(deps.spawnRuntime).toHaveBeenCalledWith("/my/repo");
	});

	it("prints the selected runtime engine and start command", async () => {
		const deps = makeLaunchDeps({
			resolveRuntime: vi.fn().mockReturnValue({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		await autoStartRuntime("/fake/root", deps);

		const output = (stdoutWriteSpy.mock.calls as unknown[][])
			.map((call) => String(call[0]))
			.join("");
		expect(output).toContain("Starting Rust Tractor");
		expect(output).toContain("command:");
		expect(output).toContain("tractor");
	});
});

describe("autoStartRuntime — mode: always", () => {
	it("spawns without asking when autostartMode is always", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "always",
			operator: { ask: askSpy },
		});
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(true);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnRuntime).toHaveBeenCalledWith("/fake/root");
	});

	it("returns false when runtime times out even in always mode", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "always",
			operator: { ask: askSpy },
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(false),
		});
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(false);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnRuntime).toHaveBeenCalledOnce();
	});
});

describe("autoStartRuntime — mode: never", () => {
	it("returns false immediately without asking or spawning", async () => {
		const askSpy = vi.fn();
		const deps = makeLaunchDeps({
			autostartMode: "never",
			operator: { ask: askSpy },
		});
		const result = await autoStartRuntime("/fake/root", deps);
		expect(result).toBe(false);
		expect(askSpy).not.toHaveBeenCalled();
		expect(deps.spawnRuntime).not.toHaveBeenCalled();
	});
});

describe("printSessionGuide", () => {
	it("points provider setup failures at model current", () => {
		const tmpBase = join(tmpdir(), `refarm-guide-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({}));
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpBase);

		try {
			printSessionGuide({ providerConfigured: false, farmhandRunning: true });

			const output = (consoleErrorSpy.mock.calls as unknown[][])
				.map((call) => String(call[0]))
				.join("\n");
			expect(output).toContain("refarm sow");
			expect(output).toContain("refarm model current");
			expect(output).toContain("refarm model providers");
		} finally {
			cwdSpy.mockRestore();
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});
});

describe("readAutostartMode", () => {
	const originalHome = process.env.HOME;
	const originalFarmhandAutostart = process.env.REFARM_FARMHAND_AUTOSTART;
	const originalRuntimeAutostart = process.env.REFARM_RUNTIME_AUTOSTART;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		delete process.env.REFARM_FARMHAND_AUTOSTART;
		delete process.env.REFARM_RUNTIME_AUTOSTART;
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		if (originalFarmhandAutostart === undefined) {
			delete process.env.REFARM_FARMHAND_AUTOSTART;
		} else {
			process.env.REFARM_FARMHAND_AUTOSTART = originalFarmhandAutostart;
		}
		if (originalRuntimeAutostart === undefined) {
			delete process.env.REFARM_RUNTIME_AUTOSTART;
		} else {
			process.env.REFARM_RUNTIME_AUTOSTART = originalRuntimeAutostart;
		}
		cwdSpy.mockRestore();
	});

	it("returns 'ask' when no config file exists", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		expect(readAutostartMode()).toBe("ask");
	});

	it("returns the env override when REFARM_RUNTIME_AUTOSTART is set", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		process.env.REFARM_RUNTIME_AUTOSTART = "never";

		expect(readAutostartMode()).toBe("never");
	});

	it("keeps REFARM_FARMHAND_AUTOSTART as a compatibility fallback", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		process.env.REFARM_FARMHAND_AUTOSTART = "never";

		expect(readAutostartMode()).toBe("never");
	});

	it("prefers REFARM_RUNTIME_AUTOSTART over the legacy farmhand env override", () => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		process.env.REFARM_RUNTIME_AUTOSTART = "always";
		process.env.REFARM_FARMHAND_AUTOSTART = "never";

		expect(readAutostartMode()).toBe("always");
	});

	it("lets the env override force ask even when config says always", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "always" }));
		cwdSpy.mockReturnValue(tmpBase);
		process.env.REFARM_RUNTIME_AUTOSTART = "ask";

		try {
			expect(readAutostartMode()).toBe("ask");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
	});

	it("ignores unrecognized env overrides and falls back to config", () => {
		const tmpBase = join(tmpdir(), `refarm-autostart-${Date.now()}`);
		const refarmDir = join(tmpBase, ".refarm");
		mkdirSync(refarmDir, { recursive: true });
		writeFileSync(join(refarmDir, "config.json"), JSON.stringify({ autostart: "never" }));
		cwdSpy.mockReturnValue(tmpBase);
		process.env.REFARM_FARMHAND_AUTOSTART = "sometimes";

		try {
			expect(readAutostartMode()).toBe("never");
		} finally {
			rmSync(tmpBase, { recursive: true, force: true });
		}
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

	it("lets project-local autostart override home preference", () => {
		const homeBase = join(tmpdir(), `refarm-autostart-home-${Date.now()}`);
		const cwdBase = join(tmpdir(), `refarm-autostart-cwd-${Date.now()}`);
		mkdirSync(join(homeBase, ".refarm"), { recursive: true });
		mkdirSync(join(cwdBase, ".refarm"), { recursive: true });
		writeFileSync(
			join(homeBase, ".refarm", "config.json"),
			JSON.stringify({ autostart: "always" }),
		);
		writeFileSync(
			join(cwdBase, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
		);
		process.env.HOME = homeBase;
		cwdSpy.mockReturnValue(cwdBase);

		try {
			expect(readAutostartMode()).toBe("never");
		} finally {
			rmSync(homeBase, { recursive: true, force: true });
			rmSync(cwdBase, { recursive: true, force: true });
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

describe("readTractorEngineMode", () => {
	const originalHome = process.env.HOME;
	const originalTractorEngine = process.env.REFARM_TRACTOR_ENGINE;
	let cwdSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		process.env.HOME = "/tmp/refarm-test-home-nonexistent";
		delete process.env.REFARM_TRACTOR_ENGINE;
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/tmp/refarm-test-cwd-nonexistent");
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		if (originalTractorEngine === undefined) {
			delete process.env.REFARM_TRACTOR_ENGINE;
		} else {
			process.env.REFARM_TRACTOR_ENGINE = originalTractorEngine;
		}
		cwdSpy.mockRestore();
	});

	it("returns auto when no tractor engine preference exists", () => {
		expect(readTractorEngineMode()).toBe("auto");
	});

	it("lets project-local tractor engine override home preference", () => {
		const homeBase = join(tmpdir(), `refarm-tractor-home-${Date.now()}`);
		const cwdBase = join(tmpdir(), `refarm-tractor-cwd-${Date.now()}`);
		mkdirSync(join(homeBase, ".refarm"), { recursive: true });
		mkdirSync(join(cwdBase, ".refarm"), { recursive: true });
		writeFileSync(
			join(homeBase, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "ts" } }),
		);
		writeFileSync(
			join(cwdBase, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "rust" } }),
		);
		process.env.HOME = homeBase;
		cwdSpy.mockReturnValue(cwdBase);

		try {
			expect(readTractorEngineMode()).toBe("rust");
		} finally {
			rmSync(homeBase, { recursive: true, force: true });
			rmSync(cwdBase, { recursive: true, force: true });
		}
	});

	it("lets env tractor engine override persisted preferences", () => {
		const cwdBase = join(tmpdir(), `refarm-tractor-cwd-${Date.now()}`);
		mkdirSync(join(cwdBase, ".refarm"), { recursive: true });
		writeFileSync(
			join(cwdBase, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "rust" } }),
		);
		process.env.REFARM_TRACTOR_ENGINE = "ts";
		cwdSpy.mockReturnValue(cwdBase);

		try {
			expect(readTractorEngineMode()).toBe("ts");
		} finally {
			rmSync(cwdBase, { recursive: true, force: true });
		}
	});
});

describe("resolveLaunchRuntime", () => {
	const originalCargoTargetDir = process.env.CARGO_TARGET_DIR;

	beforeEach(() => {
		delete process.env.CARGO_TARGET_DIR;
	});

	afterEach(() => {
		if (originalCargoTargetDir === undefined) {
			delete process.env.CARGO_TARGET_DIR;
		} else {
			process.env.CARGO_TARGET_DIR = originalCargoTargetDir;
		}
	});

	it("uses TS when explicitly configured", () => {
		expect(resolveLaunchRuntime("/fake/root", "ts")).toMatchObject({
			activeEngine: "ts",
			reason: "configured-ts",
		});
	});

	it("uses TS in auto mode when the Rust tractor binary is absent", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-no-rust-${Date.now()}`);
		mkdirSync(repoRoot, { recursive: true });

		try {
			expect(resolveLaunchRuntime(repoRoot, "auto")).toMatchObject({
				activeEngine: "ts",
				reason: "auto-ts-fallback",
			});
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("uses Rust in auto mode when the Rust tractor binary exists", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-rust-${Date.now()}`);
		const binDir = join(repoRoot, "packages", "tractor", "target", "release");
		mkdirSync(binDir, { recursive: true });
		writeFileSync(join(binDir, process.platform === "win32" ? "tractor.exe" : "tractor"), "");

		try {
			expect(resolveLaunchRuntime(repoRoot, "auto")).toMatchObject({
				activeEngine: "rust",
				reason: "auto-rust-available",
			});
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("fails early when Rust is explicitly configured but the binary is absent", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-rust-missing-${Date.now()}`);
		mkdirSync(repoRoot, { recursive: true });

		try {
			expect(() => resolveLaunchRuntime(repoRoot, "rust")).toThrow(
				/tractor\.engine=rust but the Rust tractor binary is not built/,
			);
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
