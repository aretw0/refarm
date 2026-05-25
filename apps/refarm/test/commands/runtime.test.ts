import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeCommand } from "../../src/commands/runtime.js";
import type { LaunchRuntimeSelection } from "../../src/commands/session-launch.js";

describe("runtime command", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	it("prints runtime engine selection", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "always",
			probeReady: vi.fn().mockResolvedValue(true),
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		await command.parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime");
		expect(output).toContain("configured: auto");
		expect(output).toContain("active:     rust");
		expect(output).toContain("ready:      yes");
		expect(output).toContain("autostart:  always");
		expect(output).toContain("start:      tractor");
		expect(output).toContain("refarm config set tractor.engine auto");
		expect(output).toContain("refarm config set runtime.autostart always");
		logSpy.mockRestore();
	});

	it("documents autostart in command help", () => {
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm config set runtime.autostart always");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("refarm runtime start");
		expect(help).toContain("refarm runtime ensure --wait");
		expect(help).toContain("runtime.autostart controls");
	});

	it("prints status through the explicit status subcommand", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "ask",
			probeReady: vi.fn().mockResolvedValue(true),
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		await command.parseAsync(["status"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime");
		expect(output).toContain("ready:      yes");
		expect(output).toContain("start:      tractor");
		logSpy.mockRestore();
	});

	it("outputs explicit status as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "never",
			probeReady: vi.fn().mockResolvedValue(false),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
		});

		await command.parseAsync(["status", "--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			configuredEngine: "ts",
			activeEngine: "ts",
			ready: false,
			startCommand: "farmhand --background",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
		});
		logSpy.mockRestore();
	});

	it("outputs JSON payload", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const selection: LaunchRuntimeSelection = {
			configuredEngine: "ts",
			activeEngine: "ts",
			reason: "configured-ts",
		};
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "never",
			probeReady: vi.fn().mockResolvedValue(false),
			resolveRuntime: () => selection,
		});

		await command.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
			configuredEngine: "ts",
			activeEngine: "ts",
			autostart: "never",
			reason: "configured-ts",
			ready: false,
			startCommand: "farmhand --background",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
		});
		logSpy.mockRestore();
	});

	it("reports explicit Rust configuration when the binary is missing", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "rust",
			readAutostart: () => "ask",
			resolveRuntime: () => {
				throw new Error("tractor.engine=rust but the Rust tractor binary is not built");
			},
		});

		await command.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			configuredEngine: "rust",
			activeEngine: "unknown",
			autostart: "ask",
			reason: "configured-rust-missing-binary",
			issue: expect.stringContaining("Rust tractor binary is not built"),
			nextCommand: "refarm config set tractor.engine auto",
			nextCommands: [
				"refarm config set tractor.engine auto",
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
		});
		logSpy.mockRestore();
	});

	it("prints the selected runtime start command in dry-run mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime,
		});

		await command.parseAsync(["start", "--dry-run"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith("farmhand --background");
		expect(startRuntime).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs runtime start dry-run as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime,
		});

		await command.parseAsync(["start", "--dry-run", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			dryRun?: boolean;
			command?: { display?: string };
			nextCommand?: string | null;
		};
		expect(payload.dryRun).toBe(true);
		expect(payload.command?.display).toBe("farmhand --background");
		expect(payload.nextCommand).toBeNull();
		expect(startRuntime).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("waits for runtime readiness when requested", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const waitUntilReady = vi.fn().mockResolvedValue(true);
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "always",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
			startRuntime,
			waitUntilReady,
		});

		await command.parseAsync(["start", "--wait"], { from: "user" });

		expect(startRuntime).toHaveBeenCalledOnce();
		expect(waitUntilReady).toHaveBeenCalledOnce();
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Started rust runtime.");
		expect(output).toContain("Runtime ready.");
		logSpy.mockRestore();
	});

	it("does not spawn when ensure finds the runtime already ready", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			probeReady: vi.fn().mockResolvedValue(true),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime,
		});

		await command.parseAsync(["ensure", "--wait", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			nextCommand?: string | null;
		};
		expect(payload.ensured).toBe(true);
		expect(payload.started).toBe(false);
		expect(payload.ready).toBe(true);
		expect(payload.nextCommand).toBeNull();
		expect(startRuntime).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("starts and waits when ensure finds the runtime not ready", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const waitUntilReady = vi.fn().mockResolvedValue(true);
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			probeReady: vi.fn().mockResolvedValue(false),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime,
			waitUntilReady,
		});

		await command.parseAsync(["ensure", "--wait", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			nextCommand?: string | null;
		};
		expect(payload.ensured).toBe(true);
		expect(payload.started).toBe(true);
		expect(payload.ready).toBe(true);
		expect(payload.nextCommand).toBeNull();
		expect(startRuntime).toHaveBeenCalledOnce();
		expect(waitUntilReady).toHaveBeenCalledOnce();
		logSpy.mockRestore();
	});

	it("sets exitCode when ensure cannot make the runtime ready", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const repoRoot = join(tmpdir(), `refarm-runtime-ensure-${Date.now()}`);
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		mkdirSync(join(repoRoot, ".refarm"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts", "farmhand-start.sh"), "");
		writeFileSync(
			join(repoRoot, ".refarm", "ts-runtime-start.log"),
			"MODEL_PROVIDER=openai but OPENAI_API_KEY is not set.\nConfigure keys with: refarm sow\n",
		);
		const command = createRuntimeCommand({
			repoRoot: () => repoRoot,
			readEngine: () => "ts",
			readAutostart: () => "ask",
			probeReady: vi.fn().mockResolvedValue(false),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime: vi.fn(),
			waitUntilReady: vi.fn().mockResolvedValue(false),
		});

		await command.parseAsync(["ensure", "--wait", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			nextCommand?: string | null;
			nextCommands?: string[];
			diagnostics?: { logPath?: string; logTail?: string[] };
		};
		expect(payload.ensured).toBe(false);
		expect(payload.started).toBe(true);
		expect(payload.ready).toBe(false);
		expect(payload.nextCommand).toBe("refarm sow --json");
		expect(payload.nextCommands).toEqual([
			"refarm sow --json",
			"refarm model current --json",
		]);
		expect(payload.diagnostics?.logPath).toBe(
			join(repoRoot, ".refarm", "ts-runtime-start.log"),
		);
		expect(payload.diagnostics?.logTail).toContain(
			"MODEL_PROVIDER=openai but OPENAI_API_KEY is not set.",
		);
		expect(process.exitCode).toBe(1);
		rmSync(repoRoot, { recursive: true, force: true });
		logSpy.mockRestore();
	});

	it("prints startup recovery command when ensure --next-command fails", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const repoRoot = join(tmpdir(), `refarm-runtime-ensure-next-${Date.now()}`);
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		mkdirSync(join(repoRoot, ".refarm"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts", "farmhand-start.sh"), "");
		writeFileSync(
			join(repoRoot, ".refarm", "ts-runtime-start.log"),
			"MODEL_PROVIDER=openai but OPENAI_API_KEY is not set.\n",
		);
		const command = createRuntimeCommand({
			repoRoot: () => repoRoot,
			readEngine: () => "ts",
			readAutostart: () => "ask",
			probeReady: vi.fn().mockResolvedValue(false),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime: vi.fn(),
			waitUntilReady: vi.fn().mockResolvedValue(false),
		});

		await command.parseAsync(["ensure", "--wait", "--next-command"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith("refarm sow --json");
		expect(process.exitCode).toBe(1);
		rmSync(repoRoot, { recursive: true, force: true });
		logSpy.mockRestore();
	});

	it("sets exitCode when runtime wait times out", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "always",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
			startRuntime: vi.fn(),
			waitUntilReady: vi.fn().mockResolvedValue(false),
		});

		await command.parseAsync(["start", "--wait"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Runtime did not become ready"),
		);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports waited readiness in JSON mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
			startRuntime: vi.fn(),
			waitUntilReady: vi.fn().mockResolvedValue(true),
		});

		await command.parseAsync(["start", "--wait", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "{}")) as {
			started?: boolean;
			ready?: boolean;
			nextCommand?: string | null;
		};
		expect(payload.started).toBe(true);
		expect(payload.ready).toBe(true);
		expect(payload.nextCommand).toBeNull();
		logSpy.mockRestore();
	});

	it("starts the selected runtime in the background", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const startRuntime = vi.fn();
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "always",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
			startRuntime,
		});

		await command.parseAsync(["start"], { from: "user" });

		expect(startRuntime).toHaveBeenCalledWith(
			expect.objectContaining({
				engine: "rust",
				command: "tractor",
				display: "tractor",
			}),
		);
		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Started rust runtime.");
		expect(output).toContain("command: tractor");
		logSpy.mockRestore();
	});

	it("reports start failure when the configured runtime is unavailable", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "rust",
			readAutostart: () => "ask",
			resolveRuntime: () => {
				throw new Error("tractor.engine=rust but the Rust tractor binary is not built");
			},
			startRuntime: vi.fn(),
		});

		await command.parseAsync(["start"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Cannot start Refarm runtime"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Rust tractor binary is not built"),
		);
		expect(logSpy).not.toHaveBeenCalled();
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
