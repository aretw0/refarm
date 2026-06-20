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
		expect(output).toContain("sidecar:    http://127.0.0.1:42001");
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
			command: "runtime",
			operation: "status",
			ok: false,
			configuredEngine: "ts",
			activeEngine: "ts",
			ready: false,
			sidecarUrl: "http://127.0.0.1:42001",
			sidecarUrlSource: "default",
			startCommand: "farmhand --background",
			nextAction: "refarm runtime ensure --wait --next-command",
			nextActions: ["refarm runtime ensure --wait --next-command"],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
		});
		logSpy.mockRestore();
	});

	it("outputs runtime sidecar probe diagnostics as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			readAutostart: () => "ask",
			readSidecarUrl: () => ({
				value: "http://127.0.0.1:52001",
				source: "/workspace/.refarm/config.json",
			}),
			probeReadiness: vi.fn().mockResolvedValue({
				url: "http://127.0.0.1:52001/efforts/summary",
				ready: false,
				error: "connect ECONNREFUSED 127.0.0.1:52001",
			}),
			resolveRuntime: () => ({
				configuredEngine: "ts",
				activeEngine: "ts",
				reason: "configured-ts",
			}),
		});

		await command.parseAsync(["status", "--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			command: "runtime",
			operation: "status",
			ok: false,
			sidecarUrl: "http://127.0.0.1:52001",
			sidecarUrlSource: "/workspace/.refarm/config.json",
			sidecarProbe: {
				url: "http://127.0.0.1:52001/efforts/summary",
				ready: false,
				error: "connect ECONNREFUSED 127.0.0.1:52001",
			},
			ready: false,
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
			command: "runtime",
			operation: "status",
			configuredEngine: "ts",
			activeEngine: "ts",
			autostart: "never",
			reason: "configured-ts",
			sidecarUrl: "http://127.0.0.1:42001",
			sidecarUrlSource: "default",
			ready: false,
			startCommand: "farmhand --background",
			ok: false,
			nextAction: "refarm runtime ensure --wait --next-command",
			nextActions: ["refarm runtime ensure --wait --next-command"],
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

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			command: "runtime",
			operation: "status",
			ok: false,
			configuredEngine: "rust",
			activeEngine: "unknown",
			autostart: "ask",
			reason: "configured-rust-missing-binary",
			sidecarUrl: "http://127.0.0.1:42001",
			sidecarUrlSource: "default",
			issue: expect.stringContaining("Rust tractor binary is not built"),
			nextAction: "refarm config set tractor.engine auto",
			nextActions: ["refarm config set tractor.engine auto"],
			nextCommand: "refarm config set tractor.engine auto",
		});
		expect(payload.nextCommands).toEqual([
			"refarm config set tractor.engine auto",
			"refarm runtime ensure --wait --next-command",
			"refarm doctor --next-command",
		]);
		logSpy.mockRestore();
	});

	it("sets exitCode when runtime start --json has no launch command", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "rust",
			readAutostart: () => "ask",
			resolveRuntime: () => {
				throw new Error("tractor.engine=rust but the Rust tractor binary is not built");
			},
		});

		await command.parseAsync(["start", "--json"], { from: "user" });

		const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({
			command: "runtime",
			operation: "start",
			ok: false,
			configuredEngine: "rust",
			activeEngine: "unknown",
			started: false,
			nextCommand: "refarm config set tractor.engine auto",
		});
		expect(payload.nextCommands).toEqual([
			"refarm config set tractor.engine auto",
			"refarm runtime ensure --wait --next-command",
			"refarm doctor --next-command",
		]);
		expect(process.exitCode).toBe(1);
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
			command?: string;
			operation?: string;
			ok?: boolean;
			dryRun?: boolean;
			launchCommand?: { display?: string };
			nextAction?: string | null;
			nextCommand?: string | null;
		};
		expect(payload.command).toBe("runtime");
		expect(payload.operation).toBe("start");
		expect(payload.ok).toBe(true);
		expect(payload.dryRun).toBe(true);
		expect(payload.launchCommand?.display).toBe("farmhand --background");
		expect(payload.nextAction).toBeNull();
		expect(payload.nextCommand).toBeNull();
		expect(startRuntime).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("stops the runtime through the runtime command", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const stopRuntime = vi.fn().mockReturnValue({
			ok: true,
			stopped: true,
			pid: 123,
			pidFile: "/repo/.refarm/tractor.pid",
		});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
			stopRuntime,
		});

		await command.parseAsync(["stop", "--json"], { from: "user" });

		expect(stopRuntime).toHaveBeenCalledWith("/repo");
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "runtime",
			operation: "stop",
			ok: true,
			stopped: true,
			pid: 123,
			nextCommand: null,
		});
		logSpy.mockRestore();
	});

	it("stops all known runtime pid files through the runtime command", async () => {
		const root = join(tmpdir(), `refarm-runtime-stop-${Date.now()}`);
		mkdirSync(join(root, ".refarm"), { recursive: true });
		writeFileSync(join(root, ".refarm", "tractor.pid"), "111");
		writeFileSync(join(root, ".refarm", "farmhand.pid"), "222");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
		const command = createRuntimeCommand({
			repoRoot: () => root,
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		try {
			await command.parseAsync(["stop", "--json"], { from: "user" });

			expect(killSpy).toHaveBeenCalledWith(111, 0);
			expect(killSpy).toHaveBeenCalledWith(111, "SIGTERM");
			expect(killSpy).toHaveBeenCalledWith(222, 0);
			expect(killSpy).toHaveBeenCalledWith(222, "SIGTERM");
			expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
				command: "runtime",
				operation: "stop",
				ok: true,
				stopped: true,
				targets: [
					{ name: "tractor", stopped: true, pid: 111 },
					{ name: "farmhand", stopped: true, pid: 222 },
				],
			});
		} finally {
			killSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("stops orphaned default-port tractor processes launched from this checkout", async () => {
		const root = join(tmpdir(), `refarm-runtime-stop-${Date.now()}`);
		const procRoot = join(tmpdir(), `refarm-proc-${Date.now()}`);
		mkdirSync(join(root, ".refarm"), { recursive: true });
		mkdirSync(join(procRoot, "111"), { recursive: true });
		mkdirSync(join(procRoot, "333"), { recursive: true });
		writeFileSync(join(root, ".refarm", "tractor.pid"), "111");
		writeFileSync(
			join(procRoot, "111", "cmdline"),
			["/home/vscode/.npm-global/bin/codex", "resume"].join("\0"),
		);
		writeFileSync(
			join(procRoot, "333", "cmdline"),
			[
				join(root, ".cache", "cargo-target", "release", "tractor"),
				"--plugin",
				join(root, ".refarm", "plugins", "@refarm", "pi-agent", "plugin.wasm"),
				"--http-host",
				"0.0.0.0",
				"--refarm-dir",
				join(tmpdir(), "refarm-agent-mock", ".refarm"),
			].join("\0"),
		);
		const previousProcRoot = process.env.REFARM_PROC_ROOT;
		process.env.REFARM_PROC_ROOT = procRoot;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
		const command = createRuntimeCommand({
			repoRoot: () => root,
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		try {
			await command.parseAsync(["stop", "--json"], { from: "user" });

			expect(killSpy).toHaveBeenCalledWith(111, 0);
			expect(killSpy).not.toHaveBeenCalledWith(111, "SIGTERM");
			expect(killSpy).toHaveBeenCalledWith(333, 0);
			expect(killSpy).toHaveBeenCalledWith(333, "SIGTERM");
			expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
				command: "runtime",
				operation: "stop",
				ok: true,
				stopped: true,
				targets: [
					{
						name: "tractor",
						stopped: false,
						alreadyStopped: true,
						pid: 111,
						source: "pid-file",
					},
					{ name: "farmhand", stopped: false, source: "pid-file" },
					{
						name: "tractor",
						stopped: true,
						pid: 333,
						source: "process-scan",
						orphan: true,
					},
				],
			});
		} finally {
			if (previousProcRoot === undefined) {
				delete process.env.REFARM_PROC_ROOT;
			} else {
				process.env.REFARM_PROC_ROOT = previousProcRoot;
			}
			killSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(root, { recursive: true, force: true });
			rmSync(procRoot, { recursive: true, force: true });
		}
	});

	it("stops default-port tractor processes discovered from socket ownership", async () => {
		const root = join(tmpdir(), `refarm-runtime-stop-${Date.now()}`);
		mkdirSync(join(root, ".refarm"), { recursive: true });
		const previousProcRoot = process.env.REFARM_PROC_ROOT;
		const previousSsOutput = process.env.REFARM_SS_OUTPUT;
		process.env.REFARM_PROC_ROOT = join(tmpdir(), `refarm-empty-proc-${Date.now()}`);
		process.env.REFARM_SS_OUTPUT = [
			"State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess",
			'LISTEN 0 4096 0.0.0.0:42001 0.0.0.0:* users:(("tractor",pid=444,fd=16))',
			'LISTEN 0 4096 0.0.0.0:42000 0.0.0.0:* users:(("tractor",pid=444,fd=17))',
		].join("\n");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
		const command = createRuntimeCommand({
			repoRoot: () => root,
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		try {
			await command.parseAsync(["stop", "--json"], { from: "user" });

			expect(killSpy).toHaveBeenCalledWith(444, 0);
			expect(killSpy).toHaveBeenCalledWith(444, "SIGTERM");
			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
			expect(payload).toMatchObject({
				command: "runtime",
				operation: "stop",
				ok: true,
				stopped: true,
			});
			expect(payload.targets).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "tractor",
						stopped: true,
						pid: 444,
						source: "port-scan",
						orphan: true,
					}),
				]),
			);
		} finally {
			if (previousProcRoot === undefined) {
				delete process.env.REFARM_PROC_ROOT;
			} else {
				process.env.REFARM_PROC_ROOT = previousProcRoot;
			}
			if (previousSsOutput === undefined) {
				delete process.env.REFARM_SS_OUTPUT;
			} else {
				process.env.REFARM_SS_OUTPUT = previousSsOutput;
			}
			killSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("restarts the runtime through stop and selected start command", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const stopRuntime = vi.fn().mockReturnValue({
			ok: true,
			stopped: true,
			pid: 123,
			pidFile: "/repo/.refarm/tractor.pid",
		});
		const startRuntime = vi.fn();
		const waitUntilReady = vi.fn().mockResolvedValue(true);
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			readAutostart: () => "ask",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
			stopRuntime,
			startRuntime,
			waitUntilReady,
		});

		await command.parseAsync(["restart", "--wait", "--json"], { from: "user" });

		expect(stopRuntime).toHaveBeenCalledWith("/repo");
		expect(startRuntime).toHaveBeenCalledOnce();
		expect(waitUntilReady).toHaveBeenCalledOnce();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "runtime",
			operation: "restart",
			ok: true,
			stop: {
				stopped: true,
				pid: 123,
			},
			started: true,
			ready: true,
		});
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
			command?: string;
			operation?: string;
			ok?: boolean;
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			nextAction?: string | null;
			nextCommand?: string | null;
		};
		expect(payload.command).toBe("runtime");
		expect(payload.operation).toBe("ensure");
		expect(payload.ok).toBe(true);
		expect(payload.ensured).toBe(true);
		expect(payload.started).toBe(false);
		expect(payload.ready).toBe(true);
		expect(payload.nextAction).toBe("refarm resume --json");
		expect(payload.nextCommand).toBe("refarm resume --json");
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
			command?: string;
			operation?: string;
			ok?: boolean;
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			nextAction?: string | null;
			nextCommand?: string | null;
		};
		expect(payload.command).toBe("runtime");
		expect(payload.operation).toBe("ensure");
		expect(payload.ok).toBe(true);
		expect(payload.ensured).toBe(true);
		expect(payload.started).toBe(true);
		expect(payload.ready).toBe(true);
		expect(payload.nextAction).toBe("refarm resume --json");
		expect(payload.nextCommand).toBe("refarm resume --json");
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
			command?: string;
			operation?: string;
			ok?: boolean;
			ensured?: boolean;
			started?: boolean;
			ready?: boolean;
			handoffs?: {
				interactive?: string;
				inspectCurrent?: string;
				inspectProviders?: string;
				localNoKeyModel?: string;
				openExternalLinks?: string;
			};
			nextCommand?: string | null;
			nextCommands?: string[];
			recommendations?: {
				diagnostic?: string;
				command?: string;
				severity?: string;
			}[];
			diagnostics?: { logPath?: string; logTail?: string[] };
			nextAction?: string | null;
			nextActions?: string[];
		};
		expect(payload.command).toBe("runtime");
		expect(payload.operation).toBe("ensure");
		expect(payload.ok).toBe(false);
		expect(payload.ensured).toBe(false);
		expect(payload.started).toBe(true);
		expect(payload.ready).toBe(false);
		expect(payload.nextAction).toBe(
			"Inspect credential handoffs and configure a usable model route.",
		);
		expect(payload.nextActions).toEqual([
			"Inspect credential handoffs and configure a usable model route.",
		]);
		expect(payload.nextCommand).toBe("refarm sow");
		expect(payload.nextCommands).toEqual([
			"refarm sow",
			"refarm model current --json",
			"refarm model providers --json",
			"refarm sow --json",
			"refarm sow --model ollama/llama3.2 --json",
			"refarm config get operator.openExternalLinks --json",
		]);
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "model-credentials-missing",
				severity: "failure",
				command: "refarm sow",
			}),
		]);
		expect(payload.handoffs).toEqual({
			interactive: "refarm sow",
			inspectCurrent: "refarm model current --json",
			inspectProviders: "refarm model providers --json",
			localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
			openExternalLinks: "refarm config get operator.openExternalLinks --json",
		});
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

	it("points to launch dry-run diagnostics when ensure times out with an empty startup log", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const repoRoot = join(tmpdir(), `refarm-runtime-empty-log-${Date.now()}`);
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		mkdirSync(join(repoRoot, ".refarm"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts", "farmhand-start.sh"), "");
		writeFileSync(join(repoRoot, ".refarm", "ts-runtime-start.log"), "");
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
			command?: string;
			operation?: string;
			ok?: boolean;
			ready?: boolean;
			nextAction?: string | null;
			nextCommand?: string | null;
			nextCommands?: string[];
			recommendations?: {
				diagnostic?: string;
				command?: string;
				severity?: string;
			}[];
			diagnostics?: { logPath?: string; logTail?: string[] };
		};
		expect(payload.command).toBe("runtime");
		expect(payload.operation).toBe("ensure");
		expect(payload.ok).toBe(false);
		expect(payload.ready).toBe(false);
		expect(payload.nextAction).toBe(
			"Inspect the resolved runtime launch command before retrying readiness recovery.",
		);
		expect(payload.nextCommand).toBe("refarm runtime start --dry-run --json");
		expect(payload.nextCommands).toEqual([
			"refarm runtime start --dry-run --json",
			"refarm runtime status",
			"refarm doctor --next-command",
		]);
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "runtime-start-no-readiness",
				severity: "failure",
				command: "refarm runtime start --dry-run --json",
			}),
		]);
		expect(payload.diagnostics).toEqual({
			logPath: join(repoRoot, ".refarm", "ts-runtime-start.log"),
		});
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

		expect(logSpy).toHaveBeenCalledWith("refarm sow");
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
		expect(payload.nextCommand).toBe("refarm resume --json");
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
